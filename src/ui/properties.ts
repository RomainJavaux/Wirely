import { deleteSelection, detachRoomPart, duplicateSelection, rotateSelection, startMerge } from '../core/actions';
import {
  assignBreaker,
  createLinkedBoard,
  linkSymbolToBoard,
  openBoard,
  showItemIn3D,
  showWall,
} from '../core/links';
import { equipRoom } from '../core/planActions';
import type { Store } from '../core/store';
import { WIRE_TYPES, WIRE_TYPE_IDS, getSymbol } from '../domain/catalog';
import { suggestCircuit } from '../domain/link/autoCircuits';
import { circuitLinks, circuitOptions, circuitTitle, isElectrical } from '../domain/link/links';
import { fmtArea, fmtLength, fmtMeters, polylineLength, roomAt, roomsOf, roomStats, toMeters, wireLengthM } from '../domain/plan/metrics';
import { metersToRoomUnits } from '../domain/plan/layout';
import { roomNeeds } from '../domain/plan/needs';
import { ROOM_KINDS, ROOM_KIND_IDS, getRoomKind } from '../domain/plan/roomKinds';
import type { Item, RoomKind, SymbolItem, WireTypeId } from '../domain/types';
import {
  faceLabel,
  faceLengthCm,
  faceOfSymbol,
  moveAlongFace,
  roomFaces,
  symbolsOnFace,
} from '../domain/walls/faces';
import { effectiveHeight, isCeilingKind, mountingOf } from '../domain/walls/mounting';
import { snapToWall } from '../domain/walls/snap';
import { esc } from '../util/escape';
import { bindBreakerField, breakerFieldHtml } from './breakerField';
import { qs } from './dom';
import { bindProject, projectHtml } from './projectPanel';

const TITLES: Record<Item['type'], string> = {
  room: 'Pièce',
  wall: 'Mur',
  wire: 'Câble',
  symbol: 'Symbole',
  text: 'Texte',
};

/** Hauteurs de pose courantes (cm), proposées en suggestion. */
const HEIGHTS = [5, 30, 110, 120, 150, 190, 220];

const SHORTCUTS = `
  <details class="more">
    <summary>Raccourcis clavier</summary>
    <p class="muted">
      <kbd>V</kbd> sélection · <kbd>G</kbd> pièce · <kbd>W</kbd> mur · <kbd>L</kbd> câble · <kbd>T</kbd> texte<br>
      <kbd>R</kbd> pivoter · <kbd>Suppr</kbd> effacer · <kbd>Ctrl</kbd>+<kbd>D</kbd> dupliquer<br>
      <kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> déplacer (<kbd>Maj</kbd> : 1 carreau)<br>
      <kbd>Échap</kbd> annuler · <kbd>Entrée</kbd> terminer un tracé<br>
      Molette : zoom · glisser le fond ou <kbd>Espace</kbd> : déplacer la vue
    </p>
  </details>`;

/** Panneau de droite : le projet (rien de sélectionné), ou l'élément sélectionné. */
export class PropertiesPanel {
  private readonly el = qs<HTMLElement>('#props');
  private key = '';

  constructor(private readonly store: Store) {
    store.subscribe(() => this.render());
    this.render();
  }

  focusLabel(): void {
    this.el.querySelector<HTMLInputElement>('#pLabel')?.focus();
  }

  /**
   * Le panneau n'est reconstruit que si la sélection ou une étape d'historique change :
   * la saisie en cours (changements transitoires) ne perd donc pas le focus.
   */
  private render(): void {
    if (this.store.state.mode !== 'plan') return;
    const { selection } = this.store.state;
    const key = `${selection}:${this.store.revision}`;
    if (key === this.key) return;
    this.key = key;

    const item = this.store.selectedItem;
    if (!item) {
      this.el.innerHTML = projectHtml(this.store) + SHORTCUTS;
      bindProject(this.el, this.store);
      return;
    }
    this.el.innerHTML = this.form(item);
    this.bindForm(item.id);
  }

  // ---------------------------------------------------------------- formulaire

  /** Pour un symbole « tableau » : tableau représenté, ouverture et création. */
  private boardField(boardId: number | null): string {
    const { doc } = this.store.state;
    const linked = doc.boards.find((b) => b.id === boardId);
    const circuits = linked ? circuitOptions({ boards: [linked] }).length : 0;
    const wired = linked
      ? [...new Set(linked.devices.map((d) => d.id))].filter((id) => circuitLinks(doc, id).symbols.length + circuitLinks(doc, id).wires.length > 0).length
      : 0;
    return `<label class="f" for="pBoard">Tableau représenté</label>
      <select id="pBoard">
        <option value="">— aucun —</option>
        ${doc.boards
          .map((b) => `<option value="${b.id}"${b.id === boardId ? ' selected' : ''}>${esc(b.name)}${b.location ? ` · ${esc(b.location)}` : ''}</option>`)
          .join('')}
      </select>
      <div class="row">
        <button type="button" id="pOpenBoard"${linked ? '' : ' disabled'}>Ouvrir le tableau ↗</button>
        <button type="button" id="pNewBoard">Créer un tableau</button>
      </div>
      ${linked ? `<p class="muted"><b>${circuits}</b> circuit${circuits > 1 ? 's' : ''}, dont <b>${wired}</b> raccordé${wired > 1 ? 's' : ''} à des appareils du plan.</p>` : ''}`;
  }

  /** Circuit suggéré pour un appareil qui n'est raccordé à rien. */
  private suggestion(item: SymbolItem): string {
    const { doc } = this.store.state;
    if (item.breaker !== null || !isElectrical(item) || doc.boards.length === 0) return '';
    const s = suggestCircuit(doc, item);
    if (!s) {
      return '<p class="muted">Aucun circuit existant ne convient : « Raccorder automatiquement » (panneau Projet) en crée un.</p>';
    }
    const o = circuitOptions(doc).find((x) => x.id === s.deviceId);
    if (!o) return '';
    return `<div class="suggest"><span>Suggestion : <b>${esc(circuitTitle(doc, o))}</b><small>${esc(s.reason)}</small></span>
      <button type="button" id="pSuggest">Raccorder</button></div>`;
  }

  /** Position d'un appareil sur son mur : distances au coin et hauteur, modifiables. */
  private positionSection(item: SymbolItem): string {
    const { doc } = this.store.state;
    const mount = mountingOf(item.kind);
    const room = roomAt(roomsOf(doc.items), item.x, item.y);
    const roomName = room ? esc(room.label.trim() || getRoomKind(room.kind).name) : '';

    if (isCeilingKind(item.kind)) {
      return `<h3>Position</h3><p class="muted">Au plafond${roomName ? ` · <b>${roomName}</b>` : ''}. Visible dans la vue 3D.</p>`;
    }

    const found = faceOfSymbol(doc, item);
    if (!found) {
      return `<h3>Position</h3>
        <p class="muted">${roomName ? `Dans <b>${roomName}</b>, ` : ''}pas posé sur un mur.</p>
        <div class="row"><button type="button" id="pSnap">Accrocher au mur le plus proche</button></div>`;
    }

    const placed = symbolsOnFace(doc, found.face).find((p) => p.item.id === item.id);
    const length = Math.round(faceLengthCm(doc, found.face));
    const u = Math.round(placed?.u ?? 0);
    const opening = mount.where === 'opening';
    const label = faceLabel(found.face, roomFaces(found.room));
    const name = esc(found.room.label.trim() || getRoomKind(found.room.kind).name);
    const heightField =
      item.kind === 'porte'
        ? ''
        : `<label class="f" for="pHeight">${opening ? 'Hauteur d’allège (cm)' : 'Hauteur depuis le sol (cm)'}</label>
           <input type="number" id="pHeight" list="heightList" min="0" max="${doc.ceiling}" step="5" value="${item.height ?? ''}" placeholder="${Math.round(effectiveHeight(item))} (usuelle)">
           <datalist id="heightList">${HEIGHTS.map((n) => `<option value="${n}">`).join('')}</datalist>`;
    return `<h3>Sur le mur</h3>
      <p class="muted">${esc(label)} · <b>${name}</b> · ${(length / 100).toFixed(2).replace('.', ',')} m</p>
      <div class="two">
        <div><label class="f" for="pU">Du coin gauche (cm)</label><input type="number" id="pU" min="0" max="${length}" step="5" value="${u}"></div>
        <div><label class="f" for="pUr">Du coin droit (cm)</label><input type="number" id="pUr" min="0" max="${length}" step="5" value="${length - u}"></div>
      </div>
      ${heightField}`;
  }

  /** Pour une pièce : équipement conseillé et ce qui manque, avec l'ajout en un clic. */
  private needsSection(roomId: number): string {
    const report = roomNeeds(this.store.state.doc, roomId);
    if (!report) return '';
    if (report.required === 0) {
      return `<h3>Équipement conseillé</h3><p class="muted">Choisissez un type de pièce pour obtenir l’équipement conseillé (prises, lumières, commandes).</p>`;
    }
    const rows = report.needs
      .map((n) => {
        const ok = n.missing === 0;
        const extra = n.have > n.min ? ` <small>(+${n.have - n.min})</small>` : '';
        return `<li class="need ${ok ? 'ok' : 'bad'}">
          <span>${esc(n.label)}</span><b>${n.have} / ${n.min}${extra}</b>
          ${ok ? '<i>✓</i>' : `<button type="button" data-need="${n.kind}">+ ${n.missing}</button>`}
        </li>`;
      })
      .join('');
    return `<h3>Équipement conseillé <small>(indicatif)</small></h3>
      <ul class="needs">${rows}</ul>
      <div class="row"><button type="button" id="pEquip" class="${report.complete ? '' : 'primary'}"${report.complete ? ' disabled' : ''}>${
        report.complete ? '✓ Pièce équipée' : `Équiper la pièce (${report.missing} point${report.missing > 1 ? 's' : ''})`
      }</button></div>`;
  }

  /** Pour une pièce : un bouton par mur, avec sa longueur. */
  private roomWalls(id: number): string {
    const { doc } = this.store.state;
    const room = this.store.getItem(id);
    if (room?.type !== 'room') return '';
    const faces = roomFaces(room);
    return `<h3>Murs</h3>
      <div class="row wallbtns">${faces
        .map(
          (f) =>
            `<button type="button" data-face="${f.key}">${esc(faceLabel(f, faces))} <small>${(faceLengthCm(doc, f) / 100).toFixed(2).replace('.', ',')} m</small></button>`,
        )
        .join('')}</div>
      <p class="muted">Pour régler la position et la hauteur de chaque appareil.</p>`;
  }

  private form(item: Item): string {
    const { doc } = this.store.state;
    const title = item.type === 'symbol' ? (getSymbol(item.kind)?.name ?? 'Symbole') : TITLES[item.type];
    let h = `<h3>${esc(title)}</h3>`;

    if (item.type === 'room') {
      const stats = roomStats(doc).find((s) => s.room.id === item.id);
      const kind = getRoomKind(item.kind);
      const w = toMeters(doc.scale, item.w);
      const d = toMeters(doc.scale, item.h);
      const merged = item.parts.length > 0;
      const others = roomsOf(doc.items).length > 1;
      const partsHtml = merged
        ? `<p class="muted">Pièce composée de <b>${item.parts.length + 1}</b> parties. Les dimensions ci-dessus sont celles du rectangle principal ; glissez la poignée de chaque partie pour l'ajuster.</p>
           <ul class="parts">${item.parts
             .map(
               (q, i) =>
                 `<li><span>Partie ${i + 2} · ${fmtMeters(toMeters(doc.scale, q.w))} × ${fmtMeters(toMeters(doc.scale, q.h))}</span><button type="button" data-detach="${i}">Détacher</button></li>`,
             )
             .join('')}</ul>`
        : '';
      h += `<label class="f" for="pLabel">Nom</label>
        <input type="text" id="pLabel" value="${esc(item.label)}" placeholder="${esc(kind.name)}">
        <label class="f">Type de pièce</label>
        <div class="chips">${ROOM_KIND_IDS.map(
          (id) =>
            `<button type="button" class="chip${id === item.kind ? ' active' : ''}" data-kind="${id}"><i style="background:${ROOM_KINDS[id].color}"></i>${esc(ROOM_KINDS[id].name)}</button>`,
        ).join('')}</div>
        <div class="two">
          <div><label class="f" for="pW">Largeur (m)</label><input type="number" id="pW" min="0.5" step="0.1" value="${w.toFixed(2)}"></div>
          <div><label class="f" for="pD">Profondeur (m)</label><input type="number" id="pD" min="0.5" step="0.1" value="${d.toFixed(2)}"></div>
        </div>
        <p class="muted">Surface${merged ? ' totale' : ''} : <b>${fmtArea(stats?.area ?? w * d)}</b></p>
        ${partsHtml}
        <div class="row"><button type="button" id="pMerge"${others ? '' : ' disabled'} title="Cliquez ensuite sur la pièce à fusionner dans celle-ci">Fusionner avec une autre pièce…</button></div>`;
      h += this.needsSection(item.id);
    }

    if (item.type === 'symbol') {
      h += `<label class="f" for="pLabel">Nom / repère</label>
        <input type="text" id="pLabel" value="${esc(item.label)}" placeholder="ex. Prise plan de travail">`;
      if (isElectrical(item)) h += breakerFieldHtml(this.store, item.breaker) + this.suggestion(item);
      if (item.kind === 'tableau') h += this.boardField(item.board);
      h += this.positionSection(item);
    }

    if (item.type === 'wire') {
      const options = WIRE_TYPE_IDS.map(
        (id) => `<option value="${id}"${id === item.wtype ? ' selected' : ''}>${esc(WIRE_TYPES[id].name)}</option>`,
      ).join('');
      h += `<label class="f" for="pWire">Type de câble</label><select id="pWire">${options}</select>
        ${breakerFieldHtml(this.store, item.breaker)}
        <p class="muted">Longueur : <b>${fmtLength(wireLengthM(doc, item))}</b></p>`;
    }

    if (item.type === 'wall') {
      const len = toMeters(doc.scale, polylineLength(item.points));
      h += `<p class="muted">Longueur : <b>${fmtMeters(len)}</b> · ${item.points.length - 1} segment${item.points.length > 2 ? 's' : ''}.<br>Glissez les points blancs pour ajuster le tracé.</p>`;
    }

    if (item.type === 'text') {
      h += `<label class="f" for="pText">Texte</label><input type="text" id="pText" value="${esc(item.text)}">`;
    }

    h += `<div class="row">
      ${item.type === 'symbol' ? '<button id="pRotL" title="Pivoter à gauche">⟲</button><button id="pRot" title="Pivoter à droite (R)">⟳</button>' : ''}
      <button id="pDup">Dupliquer</button>
      <button id="pDel" class="danger">Supprimer</button>
    </div>`;
    if (item.type === 'symbol') {
      h += `<div class="row">
        <button type="button" id="pWall"${isCeilingKind(item.kind) ? ' disabled' : ''} title="Afficher le mur sous le plan">Voir le mur ↗</button>
        <button type="button" id="p3d" title="Voir dans la vue 3D">3D ↗</button>
      </div>`;
    }
    if (item.type === 'room') h += this.roomWalls(item.id);
    return h;
  }

  private bindForm(id: number): void {
    const { store } = this;
    const edit = (patch: (item: Item) => Item) => {
      const current = store.getItem(id);
      if (current) store.updateItem(patch(current));
    };
    const $ = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel);

    const text = (sel: string, apply: (item: Item, v: string) => Item) => {
      const input = $<HTMLInputElement>(sel);
      if (!input) return;
      input.oninput = () => edit((i) => apply(i, input.value));
      input.onchange = () => store.commit();
    };
    text('#pLabel', (i, v) => (i.type === 'room' || i.type === 'symbol' ? { ...i, label: v } : i));
    text('#pText', (i, v) => (i.type === 'text' ? { ...i, text: v } : i));

    // Disjoncteur : saisie dans la liste ; une valeur inconnue est annulée.
    bindBreakerField(this.el, store, id, () => {
      this.key = ''; // saisie inconnue : on reconstruit le panneau avec la valeur actuelle
      this.render();
    });

    // Symbole « tableau » : lien vers un tableau.
    const boardSel = $<HTMLSelectElement>('#pBoard');
    if (boardSel) boardSel.onchange = () => linkSymbolToBoard(store, id, boardSel.value ? Number(boardSel.value) : null);

    // Position sur le mur : distances au coin et hauteur.
    const symbolNow = (): SymbolItem | null => {
      const it = store.getItem(id);
      return it?.type === 'symbol' ? it : null;
    };
    const moveTo = (uCm: number): void => {
      const it = symbolNow();
      if (!it || !Number.isFinite(uCm)) return;
      const found = faceOfSymbol(store.state.doc, it);
      if (!found) return;
      const [x, y] = moveAlongFace(store.state.doc, found.face, it, uCm);
      store.updateItem({ ...it, x, y });
      store.commit();
    };
    const u = $<HTMLInputElement>('#pU');
    if (u) u.onchange = () => moveTo(Number(u.value));
    const ur = $<HTMLInputElement>('#pUr');
    if (ur) {
      ur.onchange = () => {
        const it = symbolNow();
        const found = it ? faceOfSymbol(store.state.doc, it) : null;
        if (found) moveTo(faceLengthCm(store.state.doc, found.face) - Number(ur.value));
      };
    }

    const height = $<HTMLInputElement>('#pHeight');
    if (height) {
      height.oninput = () =>
        edit((i) => {
          if (i.type !== 'symbol') return i;
          const n = Number(height.value);
          return { ...i, height: height.value === '' || !Number.isFinite(n) ? null : Math.min(store.state.doc.ceiling, Math.max(0, Math.round(n))) };
        });
      height.onchange = () => store.commit();
    }

    const wire = $<HTMLSelectElement>('#pWire');
    if (wire) {
      wire.onchange = () => {
        edit((i) => (i.type === 'wire' ? { ...i, wtype: wire.value as WireTypeId } : i));
        store.commit();
      };
    }

    this.el.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => {
      b.onclick = () => {
        edit((i) => (i.type === 'room' ? { ...i, kind: b.dataset.kind as RoomKind } : i));
        store.commit();
      };
    });

    const dimension = (sel: string, field: 'w' | 'h') => {
      const input = $<HTMLInputElement>(sel);
      if (!input) return;
      input.onchange = () => {
        const meters = Number(input.value);
        if (!Number.isFinite(meters) || meters <= 0) return;
        const units = metersToRoomUnits(store.state.doc.scale, meters);
        edit((i) => (i.type === 'room' ? { ...i, [field]: units } : i));
        store.commit();
      };
    };
    dimension('#pW', 'w');
    dimension('#pD', 'h');

    const on = (sel: string, fn: () => void) => {
      const b = $<HTMLButtonElement>(sel);
      if (b) b.onclick = fn;
    };
    on('#pMerge', () => startMerge(store));
    on('#pEquip', () => equipRoom(store, id));
    this.el.querySelectorAll<HTMLButtonElement>('[data-need]').forEach((b) => {
      b.onclick = () => equipRoom(store, id, b.dataset.need);
    });
    on('#pSuggest', () => {
      const it = symbolNow();
      const s = it ? suggestCircuit(store.state.doc, it) : null;
      if (s) assignBreaker(store, id, s.deviceId);
    });
    on('#pSnap', () => {
      const it = symbolNow();
      if (!it) return;
      const snap = snapToWall(store.state.doc, it.x, it.y, it.kind, 400);
      if (!snap) return;
      store.updateItem({ ...it, x: snap.x, y: snap.y, rot: snap.rot });
      store.commit();
    });
    on('#pWall', () => {
      const it = symbolNow();
      const found = it ? faceOfSymbol(store.state.doc, it) : null;
      if (found) showWall(store, found.room.id, found.face.key, id);
      else store.change((s) => (s.wallsOpen = true));
    });
    on('#p3d', () => showItemIn3D(store, id));
    on('#pOpenBoard', () => {
      const it = store.getItem(id);
      if (it?.type === 'symbol' && it.board !== null) openBoard(store, it.board);
    });
    on('#pNewBoard', () => createLinkedBoard(store, id));
    this.el.querySelectorAll<HTMLButtonElement>('[data-face]').forEach((b) => {
      b.onclick = () => showWall(store, id, b.dataset.face as string);
    });
    this.el.querySelectorAll<HTMLButtonElement>('[data-detach]').forEach((b) => {
      b.onclick = () => detachRoomPart(store, id, Number(b.dataset.detach));
    });
    on('#pRot', () => rotateSelection(store));
    on('#pRotL', () => rotateSelection(store, -90));
    on('#pDup', () => duplicateSelection(store));
    on('#pDel', () => deleteSelection(store));
  }
}
