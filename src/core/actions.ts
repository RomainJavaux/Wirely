import { translateItem } from '../domain/geometry';
import { isElectrical } from '../domain/link/links';
import { MAX_SCALE, MIN_SCALE } from '../domain/plan/metrics';
import { detachPart, mergeRooms } from '../domain/plan/rooms';
import { buildBoard } from '../domain/board/templates';
import { examplePlan, linkExample } from '../domain/plan/templates';
import type { Board } from '../domain/board/types';
import type { NewItem, Item, Rotation, Room } from '../domain/types';
import type { Store } from './store';

/** Ajoute un élément, le sélectionne et valide. Retourne son identifiant. */
export function addItem(store: Store, draft: NewItem): number {
  const doc = store.state.doc;
  const item = { ...draft, id: doc.nextId++ } as Item;
  // Avec un circuit actif, ce qu'on dessine s'y raccorde directement.
  const active = store.state.activeCircuit;
  if (active !== null && (item.type === 'wire' || (item.type === 'symbol' && isElectrical(item)))) {
    item.breaker = active;
  }
  doc.items.push(item);
  store.state.selection = item.id;
  store.commit();
  return item.id;
}

export function deleteSelection(store: Store): void {
  const id = store.state.selection;
  if (id === null) return;
  store.state.doc.items = store.state.doc.items.filter((i) => i.id !== id);
  store.state.selection = null;
  store.commit();
}

export function rotateSelection(store: Store, step: 90 | -90 = 90): void {
  const item = store.selectedItem;
  if (item?.type !== 'symbol') return;
  store.updateItem({ ...item, rot: ((item.rot + step + 360) % 360) as Rotation });
  store.commit();
}

export function duplicateSelection(store: Store): void {
  const item = store.selectedItem;
  if (!item) return;
  const { id: _id, ...rest } = translateItem(item, 20, 20);
  addItem(store, rest as NewItem);
}

export function setTool(store: Store, tool: Store['state']['tool'], symbolKind: string | null = null): void {
  store.change((s) => {
    s.tool = tool;
    s.symbolKind = tool === 'symbol' ? symbolKind : null;
  });
}

/** Décale la sélection de (dx, dy) unités du plan et valide. */
export function moveSelection(store: Store, dx: number, dy: number): void {
  const item = store.selectedItem;
  if (!item) return;
  store.updateItem(translateItem(item, dx, dy));
  store.commit();
}

/** Échelle du plan en mètres par carreau, bornée. */
export function setScale(store: Store, metersPerCell: number): void {
  if (!Number.isFinite(metersPerCell)) return;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(metersPerCell * 100) / 100));
  if (scale === store.state.doc.scale) return;
  store.state.doc.scale = scale;
  store.commit();
}

/**
 * Charge l'appartement d'exemple, avec un tableau « logement » dont les disjoncteurs sont déjà
 * reliés aux câbles et appareils du plan. Retourne false si le plan contient déjà des éléments.
 */
export function loadExamplePlan(store: Store): boolean {
  const doc = store.state.doc;
  if (doc.items.length > 0) return false;
  const example = examplePlan();

  let board: Board | null = null;
  if (doc.boards.length === 0) {
    board = buildBoard('logement', 'Tableau principal', () => doc.nextId++);
    board.location = 'Entrée';
    doc.boards.push(board);
    store.state.boardId = board.id;
  }

  const items = example.items.map((draft) => ({ ...draft, id: doc.nextId++ }) as Item);
  if (board) linkExample(items, board);
  doc.items.push(...items);

  if (doc.name === 'Mon installation') doc.name = example.name;
  store.state.selection = null;
  store.commit();
  return true;
}

/** Démarre la fusion : la pièce sélectionnée absorbera la prochaine pièce cliquée. */
export function startMerge(store: Store): void {
  const item = store.selectedItem;
  if (item?.type === 'room') store.change((s) => (s.mergeFrom = item.id));
}

export function cancelMerge(store: Store): void {
  if (store.state.mergeFrom !== null) store.change((s) => (s.mergeFrom = null));
}

/**
 * Fusionne `fromId` dans `intoId` : les rectangles de la seconde deviennent des parties de la
 * première, qui garde son nom et son type. Les symboles ne bougent pas. Retourne false si impossible.
 */
export function mergeRoomsInto(store: Store, intoId: number, fromId: number): boolean {
  const into = store.getItem(intoId);
  const from = store.getItem(fromId);
  if (into?.type !== 'room' || from?.type !== 'room' || intoId === fromId) return false;
  const merged = mergeRooms(into, from);
  const doc = store.state.doc;
  doc.items = doc.items.filter((i) => i.id !== fromId).map((i) => (i.id === intoId ? merged : i));
  store.state.selection = intoId;
  store.state.mergeFrom = null;
  store.commit();
  return true;
}

/** Détache une partie d'une pièce composée : elle redevient une pièce à part entière. */
export function detachRoomPart(store: Store, roomId: number, index: number): void {
  const room = store.getItem(roomId);
  if (room?.type !== 'room') return;
  const result = detachPart(room, index);
  if (!result) return;
  const doc = store.state.doc;
  const detached: Room = {
    id: doc.nextId++,
    type: 'room',
    ...result.part,
    label: '',
    kind: room.kind,
    parts: [],
  };
  doc.items = doc.items.map((i) => (i.id === roomId ? result.room : i));
  doc.items.push(detached);
  store.state.selection = detached.id;
  store.commit();
}
