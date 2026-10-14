import { buildBoard } from '../domain/board/templates';
import { itemsOfCircuit, locateDevice } from '../domain/link/links';
import type { Store } from './store';

/**
 * Navigation et raccordements entre le plan et les tableaux : toutes les actions qui font passer
 * d'un côté à l'autre sans que l'utilisateur ait à rechercher l'élément correspondant.
 */

let seq = 0;
const nextSeq = (): number => ++seq;

/** Fixe le circuit actif (null pour l'enlever) ; ses éléments sont mis en évidence sur le plan. */
export function setActiveCircuit(store: Store, deviceId: number | null): void {
  const found = deviceId === null ? null : locateDevice(store.state.doc, deviceId);
  store.change((s) => {
    s.activeCircuit = found ? found.device.id : null;
  });
}

/** Raccorde un câble ou un appareil du plan à un disjoncteur (null pour le détacher). Annulable. */
export function assignBreaker(store: Store, itemId: number, deviceId: number | null): void {
  const item = store.getItem(itemId);
  if (item?.type !== 'wire' && item?.type !== 'symbol') return;
  if (deviceId !== null && locateDevice(store.state.doc, deviceId) === null) return;
  store.updateItem({ ...item, breaker: deviceId });
  store.commit();
}

/** Lie un symbole « tableau » du plan à un tableau (null pour délier). Un tableau n'a qu'un symbole. */
export function linkSymbolToBoard(store: Store, symbolId: number, boardId: number | null): void {
  const symbol = store.getItem(symbolId);
  if (symbol?.type !== 'symbol') return;
  const doc = store.state.doc;
  if (boardId !== null && !doc.boards.some((b) => b.id === boardId)) return;
  doc.items = doc.items.map((i) => {
    if (i.id === symbolId) return { ...i, board: boardId };
    // Un tableau est représenté par un seul symbole : on retire l'ancien lien.
    if (boardId !== null && i.type === 'symbol' && i.board === boardId) return { ...i, board: null };
    return i;
  });
  store.commit();
}

/** Crée un tableau vide, le lie au symbole et l'ouvre. Retourne l'identifiant du tableau. */
export function createLinkedBoard(store: Store, symbolId: number): number | null {
  const symbol = store.getItem(symbolId);
  if (symbol?.type !== 'symbol') return null;
  const doc = store.state.doc;
  const name = symbol.label.trim() || `Tableau ${doc.boards.length + 1}`;
  const board = buildBoard('empty', name, () => doc.nextId++);
  doc.boards.push(board);
  doc.items = doc.items.map((i) => (i.id === symbolId ? { ...i, board: board.id } : i));
  store.state.boardId = board.id;
  store.state.deviceSelection = null;
  store.commit();
  return board.id;
}

/** Ouvre un tableau (et, si demandé, y sélectionne un appareil). */
export function openBoard(store: Store, boardId: number, deviceId?: number): void {
  const found = deviceId === undefined ? null : locateDevice(store.state.doc, deviceId);
  store.change((s) => {
    s.mode = 'board';
    s.boardId = boardId;
    s.armedKind = null;
    s.deviceSelection = found?.board.id === boardId ? deviceId! : null;
    s.boardFilter = '';
    if (found && found.board.id === boardId) s.boardFocus = { seq: nextSeq(), deviceId: deviceId! };
  });
}

/** Va voir un disjoncteur dans son tableau, sélectionné et centré à l'écran. */
export function showDeviceInBoard(store: Store, deviceId: number): void {
  const found = locateDevice(store.state.doc, deviceId);
  if (found) openBoard(store, found.board.id, deviceId);
}

/** Passe sur le plan avec ce circuit actif : ses éléments sont cadrés et mis en évidence. */
export function showCircuitOnPlan(store: Store, deviceId: number): void {
  if (locateDevice(store.state.doc, deviceId) === null) return;
  store.change((s) => {
    s.mode = 'plan';
    s.activeCircuit = deviceId;
    s.selection = null;
    s.tool = 'select';
    s.symbolKind = null;
    s.planFocus = { seq: nextSeq(), circuit: deviceId, itemId: null };
  });
}

/** Passe sur le plan, avec cet élément sélectionné et cadré. */
export function showItemOnPlan(store: Store, itemId: number): void {
  if (store.getItem(itemId) === undefined) return;
  store.change((s) => {
    s.mode = 'plan';
    s.selection = itemId;
    s.tool = 'select';
    s.symbolKind = null;
    s.planFocus = { seq: nextSeq(), circuit: null, itemId };
  });
}

/** Sélectionne un appareil du tableau et le fait défiler à l'écran. */
export function focusDevice(store: Store, deviceId: number): void {
  store.change((s) => {
    s.deviceSelection = deviceId;
    s.boardFocus = { seq: nextSeq(), deviceId };
  });
}

/**
 * Passe sur le plan avec ce circuit actif et l'outil Affecter : l'utilisateur n'a plus qu'à
 * cliquer les câbles et appareils à raccorder.
 */
export function startAssigning(store: Store, deviceId: number): void {
  if (locateDevice(store.state.doc, deviceId) === null) return;
  const hasItems = itemsOfCircuit(store.state.doc, deviceId).length > 0;
  store.change((s) => {
    s.mode = 'plan';
    s.activeCircuit = deviceId;
    s.tool = 'assign';
    s.symbolKind = null;
    s.selection = null;
    if (hasItems) s.planFocus = { seq: nextSeq(), circuit: deviceId, itemId: null };
  });
}
