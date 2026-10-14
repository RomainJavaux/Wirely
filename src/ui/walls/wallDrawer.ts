import { addItem, setCeiling } from '../../core/actions';
import type { Store } from '../../core/store';
import { getSymbol } from '../../domain/catalog';
import { circuitInfo } from '../../domain/link/links';
import { roomsOf } from '../../domain/plan/metrics';
import { getRoomKind } from '../../domain/plan/roomKinds';
import type { Room, SymbolItem } from '../../domain/types';
import { runWallChecks } from '../../domain/walls/checks';
import {
  faceLabel,
  faceLengthCm,
  faceOfSymbol,
  moveAlongFace,
  roomFaces,
  symbolsOnFace,
  type WallFace,
} from '../../domain/walls/faces';
import { effectiveHeight, isCeilingKind, mountingOf } from '../../domain/walls/mounting';
import { placeOnFace } from '../../domain/walls/snap';
import { GLYPH_ATTRS } from '../../render/items';
import { renderElevation, type ElevationScene } from '../../render/walls/elevationSvg';
import { esc } from '../../util/escape';
import { isTyping, qs } from '../dom';

/** Types d'appareils proposés en pose rapide sur un mur. */
const QUICK_KINDS = ['prise', 'inter', 'va', 'poussoir', 'rj45', 'tv', 'prise_s', 'applique', 'thermo', 'fenetre', 'porte'];
const STEP = 5;

const snap = (v: number, step = STEP): number => Math.round(v / step) * step;
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

interface Current {
  room: Room;
  face: WallFace;
  faces: WallFace[];
}

/**
 * Tiroir des murs : sous le plan, le mur de la pièce sélectionnée vu de l'intérieur, à l'échelle.
 * On y place les prises, interrupteurs… à la position et à la hauteur voulues ; la sélection est
 * partagée avec le plan (le panneau de droite règle l'appareil sélectionné).
 *
 * Le plan reste la source de vérité : déplacer un appareil ici met à jour sa position sur le plan.
 */
export class WallDrawer {
  private zoom = 1;
  private needFit = true;
  private armed: string | null = null;
  private drag: { id: number; moved: boolean } | null = null;
  private scene: ElevationScene | null = null;
  private lastFaceKey = '';
  private lastSelection: number | null | undefined = undefined;
  private hovered = false;

  private readonly drawer = qs<HTMLElement>('#wallDrawer');
  private readonly toggle = qs<HTMLButtonElement>('#wallsToggle');
  private readonly host = qs<HTMLElement>('#wallsHost');
  private readonly scroll = qs<HTMLElement>('#wallsScroll');
  private readonly faces = qs<HTMLElement>('#wallsFaces');
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
    new ResizeObserver(() => {
      if (this.isOpen()) this.render();
    }).observe(this.scroll);
  }

  private isOpen(): boolean {
    const { wallsOpen, mode } = this.store.state;
    return wallsOpen && mode === 'plan';
  }

  // ---------------------------------------------------------------- état courant

  private current(): Current | null {
    const { store } = this;
    const { doc } = store.state;
    const rooms = roomsOf(doc.items).sort((a, b) => a.y - b.y || a.x - b.x);
    if (rooms.length === 0) return null;

    // La sélection du plan commande le mur affiché, mais seulement quand elle change : un clic sur
    // l'onglet d'un autre mur ne doit pas être annulé au rendu suivant.
    const { selection } = store.state;
    if (selection !== this.lastSelection) {
      this.lastSelection = selection;
      const sel = store.getItem(selection);
      if (sel?.type === 'symbol') {
        const found = faceOfSymbol(doc, sel);
        if (found) store.state.wallFace = { roomId: found.room.id, key: found.face.key };
      } else if (sel?.type === 'room') {
        if (store.state.wallFace?.roomId !== sel.id) {
          const first = roomFaces(sel)[0];
          if (first) store.state.wallFace = { roomId: sel.id, key: first.key };
        }
      }
    }

    const wanted = store.state.wallFace;
    const room = rooms.find((r) => r.id === wanted?.roomId) ?? rooms[0];
    if (!room) return null;
    const faces = roomFaces(room);
    const face = faces.find((f) => f.key === wanted?.key) ?? faces[0];
    return face ? { room, face, faces } : null;
  }

  private selectFace(room: Room, face: WallFace): void {
    this.store.change((s) => {
      s.wallFace = { roomId: room.id, key: face.key };
    });
  }

  // ---------------------------------------------------------------- barre d'outils et palette

  private buildPalette(): void {
    this.palette.innerHTML =
      `<span class="muted">Poser sur ce mur :</span>` +
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
    });
  }

  private bindToolbar(): void {
    const { store } = this;
    this.toggle.onclick = () => store.change((s) => (s.wallsOpen = !s.wallsOpen));
    qs<HTMLButtonElement>('#wClose').onclick = () => store.change((s) => (s.wallsOpen = false));
    this.ceilingEl.onchange = () => setCeiling(store, Number(this.ceilingEl.value));
    qs<HTMLButtonElement>('#wZoomIn').onclick = () => this.setZoom(this.zoom * 1.2);
    qs<HTMLButtonElement>('#wZoomOut').onclick = () => this.setZoom(this.zoom / 1.2);
    qs<HTMLButtonElement>('#wFit').onclick = () => {
      this.needFit = true;
      this.render();
    };
    this.faces.addEventListener('click', (e) => {
      const key = (e.target as Element).closest<HTMLElement>('[data-face]')?.dataset.face;
      const cur = this.current();
      if (!key || !cur) return;
      const face = cur.faces.find((f) => f.key === key);
      if (face) this.selectFace(cur.room, face);
    });
  }

  private setZoom(z: number): void {
    this.zoom = clamp(z, 0.3, 2.5);
    this.render();
  }

  // ---------------------------------------------------------------- interactions

  /** Position du pointeur sur le mur, en cm. */
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
    this.drawer.addEventListener('pointerenter', () => (this.hovered = true));
    this.drawer.addEventListener('pointerleave', () => (this.hovered = false));

    this.host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.isOpen()) return;
      const hit = (e.target as Element).closest('[data-id]');
      // Un appareil existant garde la priorité : on le sélectionne et on peut le glisser.
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
      if (!this.isOpen()) return;
      const cur = this.current();
      const p = this.pointer(e);
      if (this.drag && cur && p) {
        this.drag.moved = true;
        this.applyDrag(cur, this.drag.id, p);
      } else if (this.armed && p && this.scene) {
        const inside = p.u >= 0 && p.u <= this.scene.lengthCm && p.v >= 0 && p.v <= this.scene.ceilingCm;
        this.hint.textContent = inside
          ? `${getSymbol(this.armed)?.name ?? this.armed} : à ${Math.round(snap(p.u))} cm du coin gauche, hauteur ${Math.round(snap(p.v))} cm. Cliquez pour poser.`
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
    const p = placeOnFace(doc, cur.face, uCm, kind);
    const height =
      mount.where === 'opening'
        ? kind === 'fenetre'
          ? clamp(snap(vCm - mount.h / 2), 0, doc.ceiling - mount.h)
          : null
        : clamp(snap(vCm), 0, doc.ceiling);

    addItem(this.store, { type: 'symbol', kind, x: p.x, y: p.y, rot: p.rot, label: '', breaker: null, board: null, height });
  }

  private bindKeyboard(): void {
    const { store } = this;
    // En phase de capture : quand le pointeur est sur le tiroir, les flèches déplacent l'appareil le
    // long du mur, et non sur le plan.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen() || isTyping()) return;
        if (e.key === 'Escape' && this.armed) {
          this.armed = null;
          e.stopImmediatePropagation();
          this.render();
          return;
        }
        if (!this.hovered) return;
        const item = store.selectedItem;
        if (item?.type !== 'symbol') return;
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
        e.stopImmediatePropagation();
        this.nudge(cur, item, m[0], m[1]);
      },
      true,
    );
  }

  private nudge(cur: Current, item: SymbolItem, du: number, dv: number): void {
    const { store } = this;
    const { doc } = store.state;
    const placed = symbolsOnFace(doc, cur.face).find((p) => p.item.id === item.id);
    if (!placed) return;
    const [x, y] = moveAlongFace(doc, cur.face, item, placed.u + du);
    const fixed = item.kind === 'porte' || isCeilingKind(item.kind);
    const height = fixed ? item.height : clamp(effectiveHeight(item) + dv, 0, doc.ceiling);
    store.updateItem({ ...item, x, y, height });
    store.commit();
  }

  // ---------------------------------------------------------------- rendu

  private render(): void {
    const { store } = this;
    const open = this.isOpen();
    this.drawer.hidden = !open;
    this.toggle.classList.toggle('active', open);
    this.toggle.textContent = open ? '▤ Murs ▾' : '▤ Murs ▴';
    if (!open) return;

    const { doc, selection, activeCircuit } = store.state;
    const cur = this.current();

    if (!cur) {
      this.faces.innerHTML = '';
      this.host.innerHTML = `<div class="walls-empty"><b>Aucune pièce</b><p>Ajoutez une pièce : chacun de ses murs pourra être détaillé ici.</p></div>`;
      this.title.textContent = 'Murs';
      this.scene = null;
      return;
    }

    const faceKey = `${cur.room.id}:${cur.face.key}`;
    if (faceKey !== this.lastFaceKey) {
      this.lastFaceKey = faceKey;
      this.needFit = true;
    }

    this.ceilingEl.value = String(doc.ceiling);
    this.palette.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.classList.toggle('active', b.dataset.kind === this.armed));

    const roomName = cur.room.label.trim() || getRoomKind(cur.room.kind).name;
    this.title.textContent = roomName;
    this.faces.innerHTML = cur.faces
      .map((f) => {
        const n = symbolsOnFace(doc, f).filter((p) => p.mounting.where !== 'opening').length;
        const len = (faceLengthCm(doc, f) / 100).toFixed(1).replace('.', ',');
        const label = faceLabel(f, cur.faces).replace('Mur ', '');
        return `<button type="button" data-face="${f.key}" class="${f.key === cur.face.key ? 'active' : ''}">${esc(label)} <small>${len} m</small>${n ? `<b>${n}</b>` : ''}</button>`;
      })
      .join('');

    const scene = renderElevation(doc, cur.room, cur.face, {
      interactive: true,
      selectedId: selection,
      circuits: circuitInfo(doc),
      activeCircuit,
    });
    this.scene = scene;

    if (this.needFit) {
      this.needFit = false;
      const availW = (this.scroll.clientWidth || 900) - 24;
      const availH = (this.scroll.clientHeight || 260) - 24;
      this.zoom = clamp(Math.min(availW / scene.width, availH / scene.height), 0.3, 1.6);
    }
    this.host.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" ` +
      `width="${Math.round(scene.width * this.zoom)}" height="${Math.round(scene.height * this.zoom)}" ` +
      `style="cursor:${this.armed ? 'crosshair' : 'default'}">${scene.svg}</svg>`;

    const checks = runWallChecks(doc, cur.room, cur.face);
    this.hint.textContent = this.armed
      ? `Cliquez sur le mur pour poser « ${getSymbol(this.armed)?.name ?? this.armed} » (Échap pour annuler).`
      : checks[0]
        ? `${checks[0].severity === 'warn' ? '⚠' : 'ℹ'} ${checks[0].message}`
        : 'Cliquez un appareil pour le régler, glissez-le sur le mur ; ← ↑ → ↓ pour le déplacer au centimètre (Maj : 10 cm).';
  }
}
