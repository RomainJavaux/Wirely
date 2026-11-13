import { isElectrical, locateDevice } from '../domain/link/links';
import { placePoint } from '../domain/plan/equip';
import { DEFAULT_ROOM_SIZE } from '../domain/plan/layout';
import { roomsOf } from '../domain/plan/metrics';
import { symbolsByRoom } from '../domain/plan/needs';
import { getRoomKind } from '../domain/plan/roomKinds';
import { allPoints, pointTypes, roomCounts } from '../domain/points';
import { rulesFor } from '../domain/rules';
import type { Country, ProjectInfo, RoomKind, SymbolItem } from '../domain/types';
import { addRoomQuick, notify } from './planActions';
import type { Store } from './store';

/**
 * Actions du relevé : créer une pièce d'un geste, compter des points, les répartir entre circuits.
 * Ce sont les gestes faits sur chantier, au pouce ; chacun est une étape d'historique.
 */

/** Nom d'une nouvelle pièce : « Chambre », puis « Chambre 2 », « Chambre 3 »… */
function nextRoomName(store: Store, kind: RoomKind): string {
  const base = getRoomKind(kind).name;
  const names = new Set(roomsOf(store.state.doc.items).map((r) => r.label.trim() || getRoomKind(r.kind).name));
  if (!names.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  return base;
}

/**
 * Ajoute une pièce depuis la liste : un bloc aux dimensions usuelles, posé à côté des autres. Ses
 * dimensions restent à préciser (le plan peut rester schématique).
 */
export function addRoomOfKind(store: Store, kind: RoomKind): number | null {
  const [widthM, depthM] = DEFAULT_ROOM_SIZE[kind];
  const sel = store.selectedItem;
  return addRoomQuick(store, {
    kind,
    name: nextRoomName(store, kind),
    widthM,
    depthM,
    nearId: sel?.type === 'room' ? sel.id : null,
    rough: true,
  });
}

/** Renomme une pièce (sans valider : la saisie se valide à la perte du focus). */
export function renameRoom(store: Store, roomId: number, label: string): void {
  const room = store.getItem(roomId);
  if (room?.type === 'room') store.updateItem({ ...room, label });
}

/** Supprime une pièce et les points qu'elle contient. */
export function deleteRoom(store: Store, roomId: number): void {
  const { doc } = store.state;
  const inside = new Set((symbolsByRoom(doc).get(roomId) ?? []).map((s) => s.id));
  doc.items = doc.items.filter((i) => i.id !== roomId && !inside.has(i.id));
  if (store.state.selection === roomId || (store.state.selection !== null && inside.has(store.state.selection))) {
    store.state.selection = null;
  }
  store.commit();
  notify(store, inside.size > 0 ? `Pièce supprimée avec ses ${inside.size} points.` : 'Pièce supprimée.', { undo: true });
}

/** Circuit actif, s'il existe encore. */
function activeCircuit(store: Store): number | null {
  const id = store.state.activeCircuit;
  return id !== null && locateDevice(store.state.doc, id) ? id : null;
}

/**
 * Compte un point de plus dans une pièce. Il est raccordé au circuit actif et posé
 * automatiquement sur un mur (ou au plafond) : sa position reste « à vérifier » sur le plan.
 */
export function addPoint(store: Store, roomId: number, typeKey: string): number | null {
  const { doc } = store.state;
  const room = store.getItem(roomId);
  const type = pointTypes(doc.project.country).find((t) => t.key === typeKey);
  if (room?.type !== 'room' || !type) return null;

  const at = placePoint(doc, room, type.kind);
  const item: SymbolItem = {
    id: doc.nextId++,
    type: 'symbol',
    kind: type.kind,
    x: at.x,
    y: at.y,
    rot: at.rot,
    label: type.preset ?? '',
    breaker: null,
    board: null,
    height: null,
    rough: true,
  };
  if (isElectrical(item)) item.breaker = activeCircuit(store);
  doc.items.push(item);
  store.commit();
  return item.id;
}

/**
 * Retire un point d'un type dans une pièce : le dernier compté, de préférence sur le circuit actif.
 */
export function removePoint(store: Store, roomId: number, typeKey: string): boolean {
  const { doc } = store.state;
  const count = roomCounts(doc, roomId).find((c) => c.type.key === typeKey);
  if (!count || count.items.length === 0) return false;
  const active = activeCircuit(store);
  const pool = count.items.some((i) => i.breaker === active) ? count.items.filter((i) => i.breaker === active) : count.items;
  const victim = pool.reduce((a, b) => (b.id > a.id ? b : a));
  doc.items = doc.items.filter((i) => i.id !== victim.id);
  if (store.state.selection === victim.id) store.state.selection = null;
  store.commit();
  return true;
}

/** Supprime un point précis. */
export function deletePoint(store: Store, itemId: number): void {
  const { doc } = store.state;
  doc.items = doc.items.filter((i) => i.id !== itemId);
  if (store.state.selection === itemId) store.state.selection = null;
  store.commit();
}

/** Raccorde des points à un circuit (null : les détache). */
export function movePointsToCircuit(store: Store, itemIds: readonly number[], deviceId: number | null): number {
  const { doc } = store.state;
  if (deviceId !== null && !locateDevice(doc, deviceId)) return 0;
  const ids = new Set(itemIds);
  let n = 0;
  doc.items = doc.items.map((i) => {
    if (i.type !== 'symbol' || !ids.has(i.id) || !isElectrical(i) || i.breaker === deviceId) return i;
    n += 1;
    return { ...i, breaker: deviceId };
  });
  if (n > 0) store.commit();
  return n;
}

/** Valide les positions posées automatiquement (toutes, ou celles d'une pièce). */
export function confirmPositions(store: Store, roomId?: number): number {
  const { doc } = store.state;
  const scope = roomId === undefined ? null : new Set((symbolsByRoom(doc).get(roomId) ?? []).map((s) => s.id));
  let n = 0;
  doc.items = doc.items.map((i) => {
    if (i.type !== 'symbol' || i.rough !== true || (scope && !scope.has(i.id))) return i;
    n += 1;
    const { rough: _rough, ...rest } = i;
    return rest;
  });
  if (n > 0) {
    store.commit();
    notify(store, `${n} position${n > 1 ? 's validées' : ' validée'}.`, { undo: true });
  }
  return n;
}

/** Nombre de points dont la position reste à vérifier. */
export const roughCount = (store: Store): number => allPoints(store.state.doc).filter((p) => p.rough === true).length;

/** Modifie les renseignements du chantier (sans valider : la saisie se valide à la perte du focus). */
export function patchProject(store: Store, patch: Partial<ProjectInfo>): void {
  store.change((s) => {
    s.doc.project = { ...s.doc.project, ...patch };
  });
}

/**
 * Change le pays du chantier : règles, repérage (lettres ou numéros), câble et mode de pose par
 * défaut. Les circuits déjà créés gardent leurs réglages.
 */
export function setCountry(store: Store, country: Country): void {
  const { doc } = store.state;
  if (doc.project.country === country) return;
  const before = rulesFor(doc.project.country);
  const after = rulesFor(country);
  doc.project = {
    ...doc.project,
    country,
    // On ne remplace le câble et la pose que s'ils étaient ceux par défaut du pays précédent.
    cable: doc.project.cable === before.cable ? after.cable : doc.project.cable,
    laying: doc.project.laying === before.laying ? after.laying : doc.project.laying,
    vat: doc.project.vat === before.vat ? after.vat : doc.project.vat,
  };
  store.commit();
}
