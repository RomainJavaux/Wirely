import { addItem, deleteSelection, setCeiling } from '../../core/actions';
import { showItemOnPlan } from '../../core/links';
import type { Store } from '../../core/store';
import { getSymbol } from '../../domain/catalog';
import { circuitInfo } from '../../domain/link/links';
import { roomsOf } from '../../domain/plan/metrics';
import { roomContains } from '../../domain/plan/rooms';
import { getRoomKind } from '../../domain/plan/roomKinds';
import type { Room, SymbolItem } from '../../domain/types';
import { runWallChecks } from '../../domain/walls/checks';
import {
  cmToUnits,
  faceLabel,
  faceLengthCm,
  moveAlongFace,
  pointOnFace,
  roomFaces,
  symbolsOnFace,
  type WallFace,
} from '../../domain/walls/faces';
import { effectiveHeight, isCeilingKind, mountingOf } from '../../domain/walls/mounting';
import { renderElevation, type ElevationScene } from '../../render/walls/elevationSvg';
import { GLYPH_ATTRS } from '../../render/items';
import { esc } from '../../util/escape';
import { bindBreakerField, breakerFieldHtml } from '../breakerField';
import { isTyping, qs } from '../dom';

/** Types d'appareils proposés en pose rapide sur un mur. */
const QUICK_KINDS = ['prise', 'inter', 'va', 'poussoir', 'rj45', 'tv', 'prise_s', 'applique', 'thermo', 'fenetre', 'porte'];
const HEIGHTS = [5, 30, 110, 120, 150, 190];
const STEP = 5;

const snap = (v: number, step = STEP): number => Math.round(v / step) * step;
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

interface Current {
  room: Room;
  face: WallFace;
  faces: WallFace[];
}

/**
 * Éditeur de murs : la vue de face d'un mur, à l'échelle, où l'on place chaque prise, interrupteur…
 * à la position et à la hauteur voulues. Le plan reste la source de vérité : déplacer un appareil sur
 * le mur met à jour sa position sur le plan et sa hauteur de pose.
 */
export class WallWorkspace {
  private zoom = 1;
  private needFit = true;
  private armed: string | null = null;
  private drag: { id: number; moved: boolean } | null = null;
  private scene: ElevationScene | null = null;
  private lastFaceKey = '';
  private sideKey = '';

  private readonly host = qs<HTMLElement>('#wallsHost');
  private readonly scroll = qs<HTMLElement>('#wallsScroll');
  private readonly list = qs<HTMLElement>('#wallsList');
  private readonly side = qs<HTMLElement>('#wallsSide');
  private readonly palette = qs<HTMLElement>('#wallsPalette');
  private readonly hint = qs<HTMLElement>('#wallsHint');
  private readonly title = qs<HTMLElement>('#wallsTitle');
  private readonly ceilingEl = qs<HTMLInputElement>('#wCeiling');

  constructor(private readonly store: Store) {
    this.buildPalette();
    this.bindToolbar();
    this.bindCanvas();
    this.bindKeyboard();
    store.subscribe(() => this.render());
    window.addEventListener('resize', () => this.render());
  }

  // ---------------------------------------------------------------- état courant

  private current(): Current | null {
    const { doc, wallFace } = this.store.state;
    const rooms = roomsOf(doc.items).sort((a, b) => a.y - b.y || a.x - b.x);
    const room = rooms.find((r) => r.id === wallFace?.roomId) ?? rooms[0];
    if (!room) return null;
    const faces = roomFaces(room);
    const face = faces.find((f) => f.key === wallFace?.key) ?? faces[0];
    return face ? { room, face, faces } : null;
  }

  private selectFace(room: Room, face: WallFace): void {
    this.store.change((s) => {
      s.wallFace = { roomId: room.id, key: face.key };
    });
  }

  /** Face suivante ou précédente, en parcourant les pièces dans l'ordre du plan. */
  private step(delta: number): void {
    const { doc } = this.store.state;
    const cur = this.current();
    if (!cur) return;
    const all = roomsOf(doc.items)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .flatMap((room) => roomFaces(room).map((face) => ({ room, face })));
    const i = all.findIndex((e) => e.room.id === cur.room.id && e.face.key === cur.face.key);
    const next = all[(i + delta + all.length) % all.length];
    if (next) this.selectFace(next.room, next.face);
  }

  // ---------------------------------------------------------------- barre d'outils et palette

  private buildPalette(): void {
    this.palette.innerHTML =
      `<span class="muted">Poser :</span>` +
      QUICK_KINDS.map((kind) => {
        const def = getSymbol(kind);
        if (!def) return '';
        return `<button type="button" class="qk" data-kind="${kind}" title="${esc(def.name)}">
          <svg viewBox="${def.viewBox ?? '-18 -18 36 36'}" ${GLYPH_ATTRS}>${def.svg}</svg><span>${esc(def.name)}</span></button>`;
      }).join('');
    this.palette.addEventListener('click', (e) => {
      const kind = (e.target as Element).closest<HTMLElement>('[data-kind]')?.dataset.kind;
      if (!kind) return;
      this.armed = this.armed === kind ? null : kind;
      this.store.change((s) => (s.selection = null));
      this.render();
    });
  }

  private bindToolbar(): void {
    qs<HTMLButtonElement>('#wPrev').onclick = () => this.step(-1);
    qs<HTMLButtonElement>('#wNext').onclick = () => this.step(1);
    this.ceilingEl.onchange = () => setCeiling(this.store, Number(this.ceilingEl.value));
    qs<HTMLButtonElement>('#wZoomIn').onclick = () => this.setZoom(this.zoom * 1.2);
    qs<HTMLButtonElement>('#wZoomOut').onclick = () => this.setZoom(this.zoom / 1.2);
    qs<HTMLButtonElement>('#wFit').onclick = () => {
      this.needFit = true;
      this.render();
    };
  }

  private setZoom(z: number): void {
    this.zoom = clamp(z, 0.4, 2.5);
    this.render();
  }

  // ---------------------------------------------------------------- interactions

  /** Position du pointeur sur le mur, en cm (null si hors du dessin). */
  private pointer(e: { clientX: number; clientY: number }): { u: number; v: number } | null {
    const svg = this.host.querySelector('svg');
    if (!svg || !this.scene) return null;
    const r = svg.getBoundingClientRect();
    if (r.width === 0) return null;
    const k = this.scene.width / r.width;
    return this.scene.toCm((e.clientX - r.left) * k, (e.clientY - r.top) * k);
  }

  private bindCanvas(): void {
    const { store } = this;

    this.host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || store.state.mode !== 'walls') return;
      const hit = (e.target as Element).closest('[data-id]');

      // Un appareil existant garde la priorité : on le sélectionne et on peut le glisser, même
      // quand un type est armé pour la pose.
      if (hit) {
        const id = Number(hit.getAttribute('data-id'));
        store.change((s) => (s.selection = id));
        this.drag = { id, moved: false };
        e.preventDefault();
        return;
      }
      if (this.armed) {
        const p = this.pointer(e);
        if (p) this.place(this.armed, p.u, p.v);
        return;
      }
      store.change((s) => (s.selection = null));
    });

    window.addEventListener('pointermove', (e) => {
      if (store.state.mode !== 'walls') return;
      const cur = this.current();
      const p = this.pointer(e);
      if (this.drag && cur && p) {
        this.drag.moved = true;
        this.applyDrag(cur, this.drag.id, p);
      } else if (this.armed && p && this.scene) {
        const inside = p.u >= 0 && p.u <= this.scene.lengthCm && p.v >= 0 && p.v <= this.scene.ceilingCm;
        this.hint.textContent = inside
          ? `${getSymbol(this.armed)?.name ?? this.armed} : à ${Math.round(snap(p.u))} cm du coin gauche, hauteur ${Math.round(snap(p.v))} cm — cliquez pour poser.`
          : 'Cliquez sur le mur pour poser.';
      }
    });

    window.addEventListener('pointerup', () => {
      const d = this.drag;
      this.drag = null;
      if (d?.moved) store.commit();
    });
  }

  private applyDrag(cur: Current, id: number, p: { u: number; v: number }): void {
    const { store } = this;
    const item = store.getItem(id);
    if (item?.type !== 'symbol') return;
    const { doc } = store.state;
    const mount = mountingOf(item.kind);
    const L = faceLengthCm(doc, cur.face);
    const u = clamp(snap(p.u), 0, L);

    let height: number | null = item.height;
    if (mount.where === 'opening') {
      if (item.kind === 'fenetre') height = clamp(snap(p.v - mount.h / 2), 0, doc.ceiling - mount.h);
    } else {
      height = clamp(snap(p.v), 0, doc.ceiling);
    }
    const [x, y] = moveAlongFace(doc, cur.face, item, u);
    store.updateItem({ ...item, x, y, height });
  }

  /** Pose un nouvel appareil sur le mur affiché, au point cliqué. */
  private place(kind: string, uCm: number, vCm: number): void {
    const cur = this.current();
    if (!cur) return;
    const { doc } = this.store.state;
    const L = faceLengthCm(doc, cur.face);
    if (uCm < 0 || uCm > L || vCm < 0 || vCm > doc.ceiling) return;

    const mount = mountingOf(kind);
    const [x, y] = pointOnFace(cur.face, cmToUnits(doc.scale, clamp(snap(uCm), 0, L)));
    const height =
      mount.where === 'opening'
        ? kind === 'fenetre'
          ? clamp(snap(vCm - mount.h / 2), 0, doc.ceiling - mount.h)
          : null
        : clamp(snap(vCm), 0, doc.ceiling);

    addItem(this.store, { type: 'symbol', kind, x, y, rot: 0, label: '', breaker: null, board: null, height });
  }

  private bindKeyboard(): void {
    const { store } = this;
    window.addEventListener('keydown', (e) => {
      if (store.state.mode !== 'walls' || isTyping()) return;
      if (e.key === 'Escape') {
        this.armed = null;
        store.change((s) => (s.selection = null));
        return;
      }
      const item = store.selectedItem;
      if (item?.type !== 'symbol') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection(store);
        return;
      }
      const cur = this.current();
      if (!cur) return;
      const n = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-n, 0],
        ArrowRight: [n, 0],
        ArrowUp: [0, n],
        ArrowDown: [0, -n],
      };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      this.nudge(cur, item, m[0], m[1]);
    });
  }

  private nudge(cur: Current, item: SymbolItem, du: number, dv: number): void {
    const { store } = this;
    const { doc } = store.state;
    const placed = symbolsOnFace(doc, cur.face).find((p) => p.item.id === item.id);
    if (!placed) return;
    const [x, y] = moveAlongFace(doc, cur.face, item, placed.u + du);
    // Une porte reste au sol et un appareil de plafond n'a pas de hauteur de mur.
    const fixed = item.kind === 'porte' || isCeilingKind(item.kind);
    const height = fixed ? item.height : clamp(effectiveHeight(item) + dv, 0, doc.ceiling);
    store.updateItem({ ...item, x, y, height });
    store.commit();
  }

  // ---------------------------------------------------------------- rendu

  private render(): void {
    const { store } = this;
    if (store.state.mode !== 'walls') return;
    const { doc, selection, activeCircuit } = store.state;
    const cur = this.current();

    if (!cur) {
      this.list.innerHTML = '';
      this.host.innerHTML = `<div class="walls-empty"><h2>Aucune pièce</h2><p>Dessinez d'abord une pièce sur le plan : chacun de ses murs pourra ensuite être détaillé ici.</p></div>`;
      this.side.innerHTML = '';
      this.title.textContent = '';
      return;
    }

    const faceKey = `${cur.room.id}:${cur.face.key}`;
    if (faceKey !== this.lastFaceKey) {
      this.lastFaceKey = faceKey;
      this.needFit = true;
    }

    this.ceilingEl.value = String(doc.ceiling);
    this.palette.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.classList.toggle('active', b.dataset.kind === this.armed));
    this.renderList(cur);

    const scene = renderElevation(doc, cur.room, cur.face, {
      interactive: true,
      selectedId: selection,
      circuits: circuitInfo(doc),
      activeCircuit,
    });
    this.scene = scene;

    if (this.needFit) {
      this.needFit = false;
      // marges du conteneur (2 × 20 px) et de la carte (2 × 6 px), plus une marge de sécurité
      const avail = (this.scroll.clientWidth || 900) - 40 - 12 - 4;
      this.zoom = clamp(avail / scene.width, 0.5, 1.6);
    }
    this.host.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" ` +
      `width="${Math.round(scene.width * this.zoom)}" height="${Math.round(scene.height * this.zoom)}" ` +
      `style="cursor:${this.armed ? 'crosshair' : 'default'}">${scene.svg}</svg>`;

    this.title.textContent = `${cur.room.label.trim() || getRoomKind(cur.room.kind).name} · ${faceLabel(cur.face, cur.faces)}`;
    this.hint.textContent = this.armed
      ? `Cliquez sur le mur pour poser « ${getSymbol(this.armed)?.name ?? this.armed} » (Échap pour annuler).`
      : 'Cliquez un appareil pour le régler, glissez-le sur le mur ; ← ↑ → ↓ pour le déplacer au centimètre (Maj : 10 cm).';

    const key = `${faceKey}:${selection}:${store.revision}`;
    if (key !== this.sideKey) {
      this.sideKey = key;
      this.renderSide(cur, scene);
    } else {
      this.syncSide(scene);
    }
  }

  /** Pendant un glisser : met à jour les champs de position sans reconstruire le panneau. */
  private syncSide(scene: ElevationScene): void {
    const sel = scene.placements.find((p) => p.item.id === this.store.state.selection);
    if (!sel) return;
    const set = (id: string, value: number): void => {
      const el = this.side.querySelector<HTMLInputElement>(id);
      if (el && document.activeElement !== el) el.value = String(Math.round(value));
    };
    set('#wU', sel.u);
    set('#wUr', scene.lengthCm - sel.u);
    set('#wV', sel.v);
  }

  private renderList(cur: Current): void {
    const { doc } = this.store.state;
    const rooms = roomsOf(doc.items).sort((a, b) => a.y - b.y || a.x - b.x);
    this.list.innerHTML = rooms
      .map((room) => {
        const faces = roomFaces(room);
        const kind = getRoomKind(room.kind);
        const ceilingCount = doc.items.filter(
          (i) => i.type === 'symbol' && isCeilingKind(i.kind) && roomContains(room, i.x, i.y),
        ).length;
        const buttons = faces
          .map((face) => {
            const n = symbolsOnFace(doc, face).filter((p) => p.mounting.where !== 'opening').length;
            const active = room.id === cur.room.id && face.key === cur.face.key;
            const len = (faceLengthCm(doc, face) / 100).toFixed(2).replace('.', ',');
            return `<button type="button" class="face${active ? ' active' : ''}" data-room="${room.id}" data-face="${face.key}">
              <span>${esc(faceLabel(face, faces))}</span><small>${len} m</small><b>${n}</b></button>`;
          })
          .join('');
        return `<details class="room" ${room.id === cur.room.id ? 'open' : ''}>
          <summary><i style="background:${kind.color}"></i><span>${esc(room.label.trim() || kind.name)}</span>
            ${ceilingCount ? `<small title="Appareils de plafond">☀ ${ceilingCount}</small>` : ''}</summary>
          <div class="faces">${buttons}</div></details>`;
      })
      .join('');

    this.list.querySelectorAll<HTMLElement>('[data-face]').forEach((b) => {
      b.onclick = () => {
        const room = rooms.find((r) => r.id === Number(b.dataset.room));
        const face = room ? roomFaces(room).find((f) => f.key === b.dataset.face) : undefined;
        if (room && face) this.selectFace(room, face);
      };
    });
  }

  private renderSide(cur: Current, scene: ElevationScene): void {
    const { store } = this;
    const { doc, selection } = store.state;
    const sel = scene.placements.find((p) => p.item.id === selection);

    if (!sel) {
      const rows = scene.placements
        .map((p) => {
          const name = getSymbol(p.item.kind)?.name ?? p.item.kind;
          const opening = p.mounting.where === 'opening';
          return `<tr data-item="${p.item.id}"><td>${esc(name)}${p.item.label.trim() ? ` <small>« ${esc(p.item.label.trim())} »</small>` : ''}</td>
            <td>${Math.round(p.u)}</td><td>${opening ? `allège ${Math.round(p.v)}` : Math.round(p.v)}</td></tr>`;
        })
        .join('');
      const checks = runWallChecks(doc, cur.room, cur.face);
      this.side.innerHTML = `
        <h3>${esc(faceLabel(cur.face, cur.faces))}</h3>
        <p class="muted">${(scene.lengthCm / 100).toFixed(2).replace('.', ',')} m de long · ${(doc.ceiling / 100).toFixed(2).replace('.', ',')} m sous plafond.
        Le haut du plan est le nord ; le mur est vu de l'intérieur de la pièce.</p>
        ${
          rows
            ? `<table class="items-table"><thead><tr><th>Appareil</th><th>Position (cm)</th><th>Hauteur (cm)</th></tr></thead><tbody>${rows}</tbody></table>`
            : '<p class="muted">Aucun appareil sur ce mur. Choisissez un type dans la barre au-dessus du dessin, puis cliquez sur le mur.</p>'
        }
        ${checks.length ? `<h3>Contrôles <small>(indicatifs)</small></h3><ul class="checks">${checks.map((c) => `<li class="chk ${c.severity}" data-item="${c.itemId}">${c.severity === 'warn' ? '⚠️' : 'ℹ️'} <span>${esc(c.message)}</span></li>`).join('')}</ul>` : ''}`;
      this.side.querySelectorAll<HTMLElement>('[data-item]').forEach((el) => {
        el.onclick = () => store.change((s) => (s.selection = Number(el.dataset.item)));
      });
      return;
    }

    const item = sel.item;
    const def = getSymbol(item.kind);
    const opening = sel.mounting.where === 'opening';
    const L = scene.lengthCm;
    this.side.innerHTML = `
      <h3>${esc(def?.name ?? item.kind)}</h3>
      <label class="f" for="wLabel">Nom / repère</label>
      <input type="text" id="wLabel" value="${esc(item.label)}" placeholder="ex. Plan de travail">
      <div class="two">
        <div><label class="f" for="wU">Du coin gauche (cm)</label><input type="number" id="wU" step="1" min="0" max="${Math.round(L)}" value="${Math.round(sel.u)}"></div>
        <div><label class="f" for="wUr">Du coin droit (cm)</label><input type="number" id="wUr" step="1" min="0" max="${Math.round(L)}" value="${Math.round(L - sel.u)}"></div>
      </div>
      ${
        item.kind === 'porte'
          ? ''
          : `<label class="f" for="wV">${opening ? 'Hauteur d’allège (cm)' : 'Hauteur depuis le sol (cm)'}</label>
             <input type="number" id="wV" list="wHeights" step="1" min="0" max="${doc.ceiling}" value="${Math.round(sel.v)}">
             <datalist id="wHeights">${HEIGHTS.map((h) => `<option value="${h}">`).join('')}</datalist>`
      }
      ${opening ? '' : breakerFieldHtml(store, item.breaker, 'w')}
      <div class="row">
        <button type="button" id="wPlan" title="Voir cet appareil sur le plan">Plan ↗</button>
        <button type="button" id="wBack">Retour au mur</button>
        <button type="button" id="wDel" class="danger">Supprimer</button>
      </div>`;

    const get = <T extends HTMLElement>(id: string): T | null => this.side.querySelector<T>(id);
    const live = (patch: Partial<SymbolItem>) => {
      const cur2 = store.getItem(item.id);
      if (cur2?.type === 'symbol') store.updateItem({ ...cur2, ...patch });
    };

    const label = get<HTMLInputElement>('#wLabel');
    if (label) {
      label.oninput = () => live({ label: label.value });
      label.onchange = () => store.commit();
    }

    const moveTo = (uCm: number) => {
      const cur2 = store.getItem(item.id);
      if (cur2?.type !== 'symbol') return;
      const [x, y] = moveAlongFace(doc, cur.face, cur2, uCm);
      store.updateItem({ ...cur2, x, y });
      store.commit();
    };
    const uIn = get<HTMLInputElement>('#wU');
    if (uIn) uIn.onchange = () => Number.isFinite(Number(uIn.value)) && moveTo(Number(uIn.value));
    const urIn = get<HTMLInputElement>('#wUr');
    if (urIn) urIn.onchange = () => Number.isFinite(Number(urIn.value)) && moveTo(L - Number(urIn.value));

    const vIn = get<HTMLInputElement>('#wV');
    if (vIn) {
      vIn.onchange = () => {
        const v = Number(vIn.value);
        if (!Number.isFinite(v)) return;
        live({ height: clamp(Math.round(v), 0, doc.ceiling) });
        store.commit();
      };
    }

    bindBreakerField(
      this.side,
      store,
      item.id,
      () => {
        this.sideKey = '';
        this.render();
      },
      'w',
    );
    get('#wPlan')?.addEventListener('click', () => showItemOnPlan(store, item.id));
    get('#wBack')?.addEventListener('click', () => store.change((s) => (s.selection = null)));
    get('#wDel')?.addEventListener('click', () => deleteSelection(store));
  }
}
