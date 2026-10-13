import { getDeviceDef } from '../domain/board/catalog';
import {
  canPlace,
  compactDevices,
  createDevice,
  deviceWidth,
  firstFreeSlot,
  lastUsedRow,
  minCols,
} from '../domain/board/layout';
import { buildBoard, type BoardTemplate } from '../domain/board/templates';
import type { Board, Device } from '../domain/board/types';
import type { Store } from './store';

const MAX_ROWS = 8;

/** Applique `change` au tableau actif (sans valider) ; retourne le nouveau tableau. */
function edit(store: Store, change: (board: Board) => Board): Board | undefined {
  const board = store.activeBoard;
  if (!board) return undefined;
  const next = change(board);
  store.updateBoard(next);
  return next;
}

export function createBoard(store: Store, template: BoardTemplate): number {
  const doc = store.state.doc;
  const board = buildBoard(template, `Tableau ${doc.boards.length + 1}`, () => doc.nextId++);
  doc.boards.push(board);
  store.state.boardId = board.id;
  store.state.deviceSelection = null;
  store.commit();
  return board.id;
}

export function deleteActiveBoard(store: Store): void {
  const id = store.state.boardId;
  if (id === null) return;
  const doc = store.state.doc;
  doc.boards = doc.boards.filter((b) => b.id !== id);
  store.state.boardId = doc.boards[0]?.id ?? null;
  store.state.deviceSelection = null;
  store.commit();
}

/** Pose un appareil à l'emplacement demandé, ou au premier emplacement libre si omis. */
export function addDevice(store: Store, kind: string, at?: { row: number; col: number }): number | null {
  const board = store.activeBoard;
  const def = getDeviceDef(kind);
  if (!board || !def) return null;
  const width = def.variants.find((v) => v.id === def.defaultVariant)?.width ?? 1;
  const slot = at ?? firstFreeSlot(board, width);
  if (!slot || !canPlace(board, slot.row, slot.col, width)) return null;
  const device = createDevice(def, store.state.doc.nextId++, slot.row, slot.col);
  store.updateBoard({ ...board, devices: [...board.devices, device] });
  store.state.deviceSelection = device.id;
  store.commit();
  return device.id;
}

/** Déplace un appareil si l'emplacement est libre. Retourne false sinon. */
export function moveDevice(store: Store, id: number, row: number, col: number): boolean {
  const board = store.activeBoard;
  const device = board?.devices.find((d) => d.id === id);
  if (!board || !device) return false;
  if (!canPlace(board, row, col, deviceWidth(device), id)) return false;
  if (device.row === row && device.col === col) return true;
  store.updateBoard({ ...board, devices: board.devices.map((d) => (d.id === id ? { ...d, row, col } : d)) });
  return true;
}

/** Modifie les champs d'un appareil. Si la largeur change et ne tient plus, la modification est refusée. */
export function patchDevice(store: Store, id: number, patch: Partial<Device>): boolean {
  const board = store.activeBoard;
  const device = board?.devices.find((d) => d.id === id);
  if (!board || !device) return false;
  const next = { ...device, ...patch };
  if (!canPlace(board, next.row, next.col, deviceWidth(next), id)) return false;
  store.updateBoard({ ...board, devices: board.devices.map((d) => (d.id === id ? next : d)) });
  return true;
}

export function removeDevice(store: Store, id: number): void {
  const board = store.activeBoard;
  if (!board) return;
  store.updateBoard({ ...board, devices: board.devices.filter((d) => d.id !== id) });
  if (store.state.deviceSelection === id) store.state.deviceSelection = null;
  store.commit();
}

/** Copie un appareil dans le premier emplacement libre, en commençant par son rail. */
export function duplicateDevice(store: Store, id: number): number | null {
  const board = store.activeBoard;
  const device = board?.devices.find((d) => d.id === id);
  if (!board || !device) return null;
  const slot = firstFreeSlot(board, deviceWidth(device), device.row);
  if (!slot) return null;
  const copy: Device = { ...device, id: store.state.doc.nextId++, row: slot.row, col: slot.col };
  store.updateBoard({ ...board, devices: [...board.devices, copy] });
  store.state.deviceSelection = copy.id;
  store.commit();
  return copy.id;
}

export function setRows(store: Store, rows: number): void {
  const board = store.activeBoard;
  if (!board) return;
  const next = Math.min(MAX_ROWS, Math.max(1, lastUsedRow(board) + 1, rows));
  if (next === board.rows) return;
  edit(store, (b) => ({ ...b, rows: next }));
  store.commit();
}

export function setCols(store: Store, cols: number): void {
  const board = store.activeBoard;
  if (!board) return;
  const next = Math.max(minCols(board), cols);
  if (next === board.cols) return;
  edit(store, (b) => ({ ...b, cols: next }));
  store.commit();
}

export function compactBoard(store: Store): void {
  edit(store, (b) => ({ ...b, devices: compactDevices(b) }));
  store.commit();
}

export function patchBoard(store: Store, patch: Partial<Pick<Board, 'name' | 'location' | 'supply'>>): void {
  edit(store, (b) => ({ ...b, ...patch }));
}
