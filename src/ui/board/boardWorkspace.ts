import {
  addDevice,
  compactBoard,
  createBoard,
  deleteActiveBoard,
  duplicateDevice,
  moveDevice,
  patchBoard,
  removeDevice,
  setCols,
  setRows,
} from '../../core/boardActions';
import type { Store } from '../../core/store';
import { getDeviceDef } from '../../domain/board/catalog';
import { MAX_COLS, MIN_COLS, canPlace, createDevice, deviceWidth, lastUsedRow, minCols } from '../../domain/board/layout';
import type { Board, Device } from '../../domain/board/types';
import { linkSymbolToBoard, showItemOnPlan } from '../../core/links';
import { linkBadges, matchingDevices, symbolOfBoard, tableauSymbols } from '../../domain/link/links';
import { roomAt, roomsOf } from '../../domain/plan/metrics';
import { getRoomKind } from '../../domain/plan/roomKinds';
import { boardWidth, deviceBox, renderBoard, slotFromPoint, type Ghost } from '../../render/board/boardSvg';
import { renderUnifilaire } from '../../render/board/unifilaire';
import { esc } from '../../util/escape';
import { isTyping, qs } from '../dom';
import { DevicePalette } from './devicePalette';
import { BoardSidePanel } from './sidePanel';

/** Largeurs de tableau courantes, proposées dans la liste. */
const COL_PRESETS = [13, 18, 24, 36];
const CUSTOM = 'custom';

type Gesture =
  | { kind: 'palette'; deviceKind: string; startX: number; startY: number; dragging: boolean; wasArmed: boolean }
  | { kind: 'move'; id: number; startX: number; startY: number; dragging: boolean };

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.8;

/** Éditeur du tableau électrique : palette, face avant interactive, unifilaire et panneau de réglages. */
export class BoardWorkspace {
  private zoom = 1;
  private needFit = true;
  private lastBoardId: number | null = null;
  private view: 'front' | 'uni' = 'front';
  private ghost: Ghost | null = null;
  private dragId: number | null = null;
  private gesture: Gesture | null = null;
  private natural = { w: 1, h: 1 };
  private lastFocusSeq = 0;

  private readonly host = qs<HTMLElement>('#boardHost');
  private readonly scroll = qs<HTMLElement>('#boardScroll');
  private readonly select = qs<HTMLSelectElement>('#bSelect');
  private readonly nameEl = qs<HTMLInputElement>('#bName');
  private readonly locEl = qs<HTMLInputElement>('#bLoc');
  private readonly supplyEl = qs<HTMLSelectElement>('#bSupply');
  private readonly presetEl = qs<HTMLSelectElement>('#bColsPreset');
  private readonly colsEl = qs<HTMLInputElement>('#bCols');
  /** Vrai quand l'utilisateur a choisi « Personnalisé… » : le champ libre est affiché. */
  private customCols = false;

  constructor(private readonly store: Store) {
    new DevicePalette(qs('#boardPalette'), store, (kind, e) => this.onPalettePointerDown(kind, e));
    new BoardSidePanel(qs('#boardSide'), store);

    this.bindToolbar();
    this.bindCanvas();
    this.bindKeyboard();
    store.subscribe(() => this.render());
    window.addEventListener('resize', () => this.render());
  }

  // ---------------------------------------------------------------- barre d'outils

  private bindToolbar(): void {
    const { store } = this;
    this.select.onchange = () =>
      store.change((s) => {
        s.boardId = Number(this.select.value);
        s.deviceSelection = null;
      });
    qs<HTMLButtonElement>('#bAdd').onclick = () => createBoard(store, 'empty');
    qs<HTMLButtonElement>('#bDel').onclick = () => {
      const board = store.activeBoard;
      if (board && confirm(`Supprimer le tableau « ${board.name} » ? (Ctrl+Z pour annuler)`)) deleteActiveBoard(store);
    };
    qs<HTMLButtonElement>('#bEmptyBlank').onclick = () => createBoard(store, 'empty');
    qs<HTMLButtonElement>('#bEmptyExample').onclick = () => createBoard(store, 'logement');

    this.nameEl.oninput = () => patchBoard(store, { name: this.nameEl.value });
    this.nameEl.onchange = () => store.commit();
    this.locEl.oninput = () => patchBoard(store, { location: this.locEl.value });
    this.locEl.onchange = () => store.commit();
    this.supplyEl.onchange = () => {
      patchBoard(store, { supply: this.supplyEl.value === 'tri' ? 'tri' : 'mono' });
      store.commit();
    };
    this.presetEl.onchange = () => {
      if (this.presetEl.value === CUSTOM) {
        this.customCols = true;
        this.render();
        this.colsEl.focus();
        this.colsEl.select();
        return;
      }
      this.customCols = false;
      setCols(store, Number(this.presetEl.value));
      this.needFit = true;
    };
    // Valeur personnalisée : appliquée à la validation (Entrée / perte du focus), pas à chaque frappe.
    this.colsEl.onchange = () => {
      setCols(store, Number(this.colsEl.value));
      this.needFit = true;
      const board = store.activeBoard;
      if (!board) return;
      this.colsEl.value = String(board.cols); // reflète la valeur réellement retenue
      if (COL_PRESETS.includes(board.cols)) this.customCols = false; // retombe sur un standard
      this.render();
    };
    qs<HTMLButtonElement>('#bRowMinus').onclick = () => setRows(store, (store.activeBoard?.rows ?? 1) - 1);
    qs<HTMLButtonElement>('#bRowPlus').onclick = () => setRows(store, (store.activeBoard?.rows ?? 1) + 1);
    qs<HTMLButtonElement>('#bCompact').onclick = () => compactBoard(store);

    // Lien avec le plan : quel symbole « tableau » représente ce tableau.
    const planSel = qs<HTMLSelectElement>('#bPlan');
    planSel.onchange = () => {
      const board = store.activeBoard;
      if (!board) return;
      const current = symbolOfBoard(store.state.doc, board.id);
      if (planSel.value === '') {
        if (current) linkSymbolToBoard(store, current.id, null);
      } else {
        linkSymbolToBoard(store, Number(planSel.value), board.id);
      }
    };
    qs<HTMLButtonElement>('#bPlanGo').onclick = () => {
      const board = store.activeBoard;
      const symbol = board ? symbolOfBoard(store.state.doc, board.id) : undefined;
      if (symbol) showItemOnPlan(store, symbol.id);
    };

    qs<HTMLButtonElement>('#bViewFront').onclick = () => this.setView('front');
    qs<HTMLButtonElement>('#bViewUni').onclick = () => this.setView('uni');
    qs<HTMLButtonElement>('#bZoomIn').onclick = () => this.setZoom(this.zoom * 1.2);
    qs<HTMLButtonElement>('#bZoomOut').onclick = () => this.setZoom(this.zoom / 1.2);
    qs<HTMLButtonElement>('#bFit').onclick = () => {
      this.needFit = true;
      this.render();
    };
  }

  private setView(view: 'front' | 'uni'): void {
    this.view = view;
    this.needFit = true;
    this.ghost = null;
    this.render();
  }

  private setZoom(z: number): void {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    this.render();
  }

  // ---------------------------------------------------------------- interactions

  private bindCanvas(): void {
    const { store } = this;

    this.host.addEventListener('pointerdown', (e) => {
      if (this.view !== 'front' || e.button !== 0 || !store.activeBoard) return;
      if (store.state.armedKind) {
        this.placeArmed(e.clientX, e.clientY);
        return;
      }
      const id = (e.target as Element).closest('[data-dev]')?.getAttribute('data-dev');
      if (id) {
        store.change((s) => (s.deviceSelection = Number(id)));
        this.gesture = { kind: 'move', id: Number(id), startX: e.clientX, startY: e.clientY, dragging: false };
        e.preventDefault();
      } else {
        store.change((s) => (s.deviceSelection = null));
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (store.state.mode !== 'board') return;
      const g = this.gesture;
      if (g) {
        if (!g.dragging && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 5) {
          g.dragging = true;
          if (g.kind === 'move') this.dragId = g.id;
        }
        if (g.dragging) this.updateGhost(e.clientX, e.clientY);
      } else if (store.state.armedKind) {
        this.updateGhost(e.clientX, e.clientY);
      }
    });

    window.addEventListener('pointerup', () => {
      const g = this.gesture;
      if (!g) return;
      this.gesture = null;
      const ghost = this.ghost;
      this.ghost = null;
      this.dragId = null;

      if (g.kind === 'palette') {
        if (g.dragging) {
          if (ghost?.valid) addDevice(store, g.deviceKind, { row: ghost.row, col: ghost.col });
          store.change((s) => (s.armedKind = null));
        } else if (g.wasArmed) {
          store.change((s) => (s.armedKind = null)); // second clic : on désarme
        }
      } else if (g.dragging && ghost?.valid) {
        if (moveDevice(store, g.id, ghost.row, ghost.col)) store.commit();
      }
      this.render();
    });
  }

  private onPalettePointerDown(kind: string, e: PointerEvent): void {
    const wasArmed = this.store.state.armedKind === kind;
    this.store.change((s) => {
      s.armedKind = kind;
      s.deviceSelection = null;
    });
    this.gesture = { kind: 'palette', deviceKind: kind, startX: e.clientX, startY: e.clientY, dragging: false, wasArmed };
  }

  /** Appareil sous le curseur pendant un glisser ou une pose : largeur et aperçu. */
  private ghostSubject(): { device: Device; ignoreId?: number } | null {
    const { store } = this;
    const g = this.gesture;
    if (g?.kind === 'move') {
      const device = store.activeBoard?.devices.find((d) => d.id === g.id);
      return device ? { device, ignoreId: device.id } : null;
    }
    const kind = g?.kind === 'palette' ? g.deviceKind : store.state.armedKind;
    const def = kind ? getDeviceDef(kind) : undefined;
    return def ? { device: createDevice(def, -1, 0, 0) } : null;
  }

  private slotAt(clientX: number, clientY: number, width: number): { row: number; col: number } | null {
    const board = this.store.activeBoard;
    const svg = this.host.querySelector('svg');
    if (!board || !svg || this.view !== 'front') return null;
    const r = svg.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const scale = this.natural.w / r.width;
    return slotFromPoint(board, (clientX - r.left) * scale, (clientY - r.top) * scale, width);
  }

  private updateGhost(clientX: number, clientY: number): void {
    const board = this.store.activeBoard;
    const subject = this.ghostSubject();
    let next: Ghost | null = null;
    if (board && subject) {
      const width = deviceWidth(subject.device);
      const slot = this.slotAt(clientX, clientY, width);
      if (slot) {
        next = {
          ...slot,
          width,
          valid: canPlace(board, slot.row, slot.col, width, subject.ignoreId),
          device: subject.ignoreId === undefined ? subject.device : undefined,
        };
      }
    }
    const prev = this.ghost;
    const same = prev && next && prev.row === next.row && prev.col === next.col && prev.valid === next.valid;
    if (same || (!prev && !next)) return;
    this.ghost = next;
    this.render();
  }

  private placeArmed(clientX: number, clientY: number): void {
    const kind = this.store.state.armedKind;
    const def = kind ? getDeviceDef(kind) : undefined;
    const board = this.store.activeBoard;
    if (!kind || !def || !board) return;
    const width = def.variants.find((v) => v.id === def.defaultVariant)?.width ?? 1;
    const slot = this.slotAt(clientX, clientY, width);
    if (slot && canPlace(board, slot.row, slot.col, width)) addDevice(this.store, kind, slot);
  }

  private bindKeyboard(): void {
    const { store } = this;
    window.addEventListener('keydown', (e) => {
      if (store.state.mode !== 'board' || isTyping()) return;
      const mod = e.ctrlKey || e.metaKey;
      const id = store.state.deviceSelection;
      const device = store.activeBoard?.devices.find((d) => d.id === id);

      if (e.key === 'Escape') {
        if (store.state.armedKind) store.change((s) => (s.armedKind = null));
        else store.change((s) => (s.deviceSelection = null));
        this.ghost = null;
        return;
      }
      if (!device || mod) {
        if (mod && e.key.toLowerCase() === 'd' && device) {
          e.preventDefault();
          duplicateDevice(store, device.id);
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeDevice(store, device.id);
        return;
      }
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
      };
      const d = delta[e.key];
      if (d) {
        e.preventDefault();
        if (moveDevice(store, device.id, device.row + d[0], device.col + d[1])) store.commit();
      }
    });
  }

  // ---------------------------------------------------------------- rendu

  private render(): void {
    const { store } = this;
    if (store.state.mode !== 'board') return;
    const board = store.activeBoard;
    const boards = store.state.doc.boards;

    qs('#boardEmpty').toggleAttribute('hidden', boards.length > 0);
    qs('#boardContent').toggleAttribute('hidden', boards.length === 0);
    if (!board) {
      this.host.innerHTML = '';
      return;
    }
    if (board.id !== this.lastBoardId) {
      this.lastBoardId = board.id;
      this.needFit = true;
      this.customCols = false;
    }
    // Une demande de « voir cet appareil » : la face avant seule permet de le montrer.
    const focus = store.state.boardFocus;
    if (focus && focus.seq !== this.lastFocusSeq && this.view === 'uni') this.view = 'front';

    this.syncToolbar(board);

    if (this.view === 'front') {
      this.natural = { w: boardWidth(board), h: 0 };
      this.applyFit();
      const r = renderBoard(board, {
        interactive: true,
        selectedId: store.state.deviceSelection,
        ghost: this.ghost,
        dragId: this.dragId,
        badges: linkBadges(store.state.doc),
        highlight: matchingDevices(store.state.doc, board, store.state.boardFilter),
      });
      this.natural = { w: r.width, h: r.height };
      this.host.innerHTML = this.wrap(r.svg, r.width, r.height);
      this.applyFocusRequest(board);
    } else {
      const r = renderUnifilaire(board);
      this.natural = { w: r.width, h: r.height };
      this.applyFit();
      this.host.innerHTML = this.wrap(r.svg, r.width, r.height);
    }

    const armed = store.state.armedKind ? getDeviceDef(store.state.armedKind) : undefined;
    qs('#boardHint').textContent =
      this.view === 'uni'
        ? 'Schéma unifilaire généré automatiquement depuis l’implantation. Repassez en « Face avant » pour modifier.'
        : armed
          ? `Cliquez sur un rail pour poser « ${armed.name} » (Échap pour annuler).`
          : 'Glissez un appareil depuis la palette sur un rail · cliquez-en un pour le régler · ← → pour le décaler.';
  }

  /** Fait défiler la face avant jusqu'à l'appareil demandé (« voir au tableau », liste des circuits). */
  private applyFocusRequest(board: Board): void {
    const req = this.store.state.boardFocus;
    if (!req || req.seq === this.lastFocusSeq) return;
    if (this.scroll.clientWidth < 50) return; // pas encore visible : on réessaiera au prochain rendu
    this.lastFocusSeq = req.seq;
    const device = board.devices.find((d) => d.id === req.deviceId);
    if (!device) return;

    const box = deviceBox(device);
    const z = this.zoom;
    const left = box.x * z - (this.scroll.clientWidth - box.w * z) / 2;
    const top = box.y * z - (this.scroll.clientHeight - box.h * z) / 2;
    this.scroll.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: 'smooth' });
  }

  private wrap(inner: string, w: number, h: number): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${Math.round(w * this.zoom)}" height="${Math.round(h * this.zoom)}" font-family="Arial,sans-serif">${inner}</svg>`;
  }

  private applyFit(): void {
    if (!this.needFit) return;
    this.needFit = false;
    const avail = (this.scroll.clientWidth || 900) - 48;
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, avail / this.natural.w));
    if (this.view === 'front') this.zoom = Math.min(this.zoom, 1.2);
  }

  private syncToolbar(board: Board): void {
    const { store } = this;
    const boards = store.state.doc.boards;
    const key = boards.map((b) => `${b.id}:${b.name}`).join('|') + `#${board.id}`;
    if (this.select.dataset.key !== key) {
      this.select.dataset.key = key;
      this.select.innerHTML = boards
        .map((b) => `<option value="${b.id}"${b.id === board.id ? ' selected' : ''}>${esc(b.name)}</option>`)
        .join('');
    }
    if (document.activeElement !== this.nameEl) this.nameEl.value = board.name;
    if (document.activeElement !== this.locEl) this.locEl.value = board.location;
    this.supplyEl.value = board.supply;

    // Largeur : liste des standards (désactivés sous le minimum imposé par les appareils posés)
    // et option « Personnalisé… » qui révèle un champ libre.
    const need = Math.max(MIN_COLS, minCols(board));
    const custom = this.customCols || !COL_PRESETS.includes(board.cols);
    this.presetEl.innerHTML =
      COL_PRESETS.map(
        (c) =>
          `<option value="${c}"${!custom && c === board.cols ? ' selected' : ''}${c < need ? ' disabled' : ''}>${c} modules</option>`,
      ).join('') + `<option value="${CUSTOM}"${custom ? ' selected' : ''}>Personnalisé…</option>`;

    this.colsEl.hidden = !custom;
    this.colsEl.min = String(need);
    this.colsEl.max = String(MAX_COLS);
    this.colsEl.title =
      need > MIN_COLS
        ? `Minimum ${need} : les appareils posés occupent ${need} modules sur leur rail le plus rempli.`
        : `Entre ${MIN_COLS} et ${MAX_COLS} modules.`;
    if (document.activeElement !== this.colsEl) this.colsEl.value = String(board.cols);

    // Symbole du plan lié à ce tableau
    const { doc } = store.state;
    const symbols = tableauSymbols(doc);
    const rooms = roomsOf(doc.items);
    const linked = symbolOfBoard(doc, board.id);
    const planSel = qs<HTMLSelectElement>('#bPlan');
    planSel.innerHTML =
      `<option value="">${symbols.length === 0 ? 'aucun symbole « Tableau » sur le plan' : '— non lié —'}</option>` +
      symbols
        .map((sym) => {
          const room = roomAt(rooms, sym.x, sym.y);
          const where = room ? (room.label.trim() || getRoomKind(room.kind).name) : 'hors pièce';
          const other = sym.board !== null && sym.board !== board.id ? ' (lié à un autre tableau)' : '';
          return `<option value="${sym.id}"${sym.id === linked?.id ? ' selected' : ''}>${esc(sym.label.trim() || 'Tableau')} · ${esc(where)}${other}</option>`;
        })
        .join('');
    planSel.disabled = symbols.length === 0;
    qs<HTMLButtonElement>('#bPlanGo').disabled = !linked;

    qs('#bRows').textContent = String(board.rows);
    qs<HTMLButtonElement>('#bRowMinus').disabled = board.rows <= Math.max(1, lastUsedRow(board) + 1);
    qs<HTMLButtonElement>('#bRowPlus').disabled = board.rows >= 8;
    qs('#bViewFront').classList.toggle('active', this.view === 'front');
    qs('#bViewUni').classList.toggle('active', this.view === 'uni');
  }
}
