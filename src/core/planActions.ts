import { getSymbol } from '../domain/catalog';
import { appendCircuits, buildBoardFromPlan, planCircuits, suggestCircuit } from '../domain/link/autoCircuits';
import { circuitOptions, circuitTitle, isElectrical, tableauSymbols, unlinkedItems } from '../domain/link/links';
import { describeEquip, equipPlan, equipRooms, incompleteRooms, type EquipResult } from '../domain/plan/equip';
import { DEFAULT_ROOM_SIZE, findRoomSpot, metersToRoomUnits } from '../domain/plan/layout';
import { roomAt, roomsOf } from '../domain/plan/metrics';
import { getRoomKind } from '../domain/plan/roomKinds';
import type { Item, NewItem, Room, RoomKind, SymbolItem } from '../domain/types';
import { wallRealignments } from '../domain/walls/snap';
import type { Store } from './store';

/**
 * Actions de haut niveau : celles qui font le travail à la place de l'utilisateur (équiper une
 * pièce, générer les circuits…). Chacune est une seule étape d'historique, donc annulable d'un coup.
 */

let noticeSeq = 0;

/** Affiche un message bref (bandeau en bas de l'écran). */
export function notify(store: Store, text: string): void {
  store.change((s) => {
    s.notice = { seq: ++noticeSeq, text };
  });
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;

// ---------------------------------------------------------------- pièces

export interface QuickRoom {
  kind: RoomKind;
  name: string;
  widthM: number;
  depthM: number;
  /** Pièce contre laquelle poser la nouvelle (la sélection, en général). */
  nearId?: number | null;
}

/** Ajoute une pièce de dimensions données, collée aux autres. Retourne son identifiant. */
export function addRoomQuick(store: Store, spec: QuickRoom): number | null {
  const { doc } = store.state;
  if (!Number.isFinite(spec.widthM) || !Number.isFinite(spec.depthM) || spec.widthM <= 0 || spec.depthM <= 0) return null;
  const w = metersToRoomUnits(doc.scale, spec.widthM);
  const h = metersToRoomUnits(doc.scale, spec.depthM);
  const near = spec.nearId != null ? store.getItem(spec.nearId) : undefined;
  const spot = findRoomSpot(doc, w, h, near?.type === 'room' ? near : undefined);

  const name = spec.name.trim();
  const room: Room = {
    id: doc.nextId++,
    type: 'room',
    x: spot.x,
    y: spot.y,
    w: spot.w,
    h: spot.h,
    label: name === getRoomKind(spec.kind).name ? '' : name,
    kind: spec.kind,
    parts: [],
  };
  // Les pièces sont au fond : elles passent avant les murs et les symboles.
  doc.items.unshift(room);
  store.state.selection = room.id;
  store.commit();
  return room.id;
}

export const defaultRoomSize = (kind: RoomKind): [number, number] => DEFAULT_ROOM_SIZE[kind];

// ---------------------------------------------------------------- équipement

function applyEquip(store: Store, result: EquipResult): number {
  const { doc } = store.state;
  const added: Item[] = result.items.map((draft: NewItem) => ({ ...draft, id: doc.nextId++ }) as Item);
  // Un circuit actif reçoit directement les nouveaux appareils, comme pour un dessin à la main.
  const active = store.state.activeCircuit;
  if (active !== null) {
    for (const it of added) if (it.type === 'symbol' && isElectrical(it)) it.breaker = active;
  }
  doc.items.push(...added);
  return added.length;
}

const nameOf = (kind: string): string => getSymbol(kind)?.name ?? kind;

/** Équipe une pièce : ajoute les appareils qui manquent. Retourne le nombre de points ajoutés. */
export function equipRoom(store: Store, roomId: number): number {
  const result = equipRooms(store.state.doc, [roomId]);
  const n = applyEquip(store, result);
  if (n === 0) {
    notify(store, result.unplaced > 0 ? 'Plus de place sur les murs de cette pièce.' : 'Cette pièce a déjà l’équipement conseillé.');
    return 0;
  }
  store.commit();
  const warn = result.unplaced > 0 ? ` (${plural(result.unplaced, 'point')} sans place sur les murs)` : '';
  notify(store, `Ajouté : ${describeEquip(result.byKind, nameOf)}${warn}.`);
  return n;
}

/** Équipe toute la maison (pièces incomplètes, détecteur de fumée, tableau). */
export function equipAll(store: Store): number {
  const result = equipPlan(store.state.doc);
  const n = applyEquip(store, result);
  if (n === 0) {
    notify(store, 'Toutes les pièces ont déjà l’équipement conseillé.');
    return 0;
  }
  store.commit();
  notify(store, `Ajouté : ${describeEquip(result.byKind, nameOf)}.`);
  return n;
}

export const incompleteRoomCount = (store: Store): number => incompleteRooms(store.state.doc).length;

/** Ramène les appareils proches d'un mur sur ce mur (anciens plans, ou appareils posés à la main). */
export function alignToWalls(store: Store): number {
  const { doc } = store.state;
  const moves = new Map(wallRealignments(doc).map((m) => [m.id, m] as const));
  if (moves.size === 0) {
    notify(store, 'Tous les appareils de mur sont déjà posés sur un mur.');
    return 0;
  }
  doc.items = doc.items.map((i) => {
    const m = moves.get(i.id);
    return m && i.type === 'symbol' ? { ...i, x: m.x, y: m.y, rot: m.rot } : i;
  });
  store.commit();
  notify(store, `${plural(moves.size, 'appareil recalé', 'appareils recalés')} sur les murs.`);
  return moves.size;
}

// ---------------------------------------------------------------- circuits et tableau

export interface BoardReport {
  circuits: number;
  rails: number;
  boardId: number;
}

/**
 * Génère un tableau à partir du plan : circuits regroupés par usage et par zone, un différentiel
 * par rail, et chaque appareil raccordé. Le symbole « tableau » du plan est lié au nouveau tableau.
 */
export function generateBoard(store: Store): BoardReport | null {
  const { doc } = store.state;
  const plans = planCircuits(doc);
  const name = doc.boards.length === 0 ? 'Tableau principal' : `Tableau ${doc.boards.length + 1}`;
  const gen = buildBoardFromPlan(plans, name, () => doc.nextId++);
  if (!gen) {
    notify(store, 'Rien à raccorder : posez d’abord des appareils (prises, lumières…) ou équipez les pièces.');
    return null;
  }

  const byItem = new Map<number, number>();
  for (const { plan, device } of gen.circuits) for (const id of plan.itemIds) byItem.set(id, device.id);

  // Le tableau du plan (s'il n'en représente pas déjà un) est lié au nouveau tableau.
  const freeSymbol = tableauSymbols(doc).find((s) => s.board === null);
  doc.items = doc.items.map((i) => {
    if (i.type !== 'symbol') return i;
    if (freeSymbol && i.id === freeSymbol.id) return { ...i, board: gen.board.id };
    const dev = byItem.get(i.id);
    return dev === undefined ? i : { ...i, breaker: dev };
  });
  if (freeSymbol) {
    const room = roomAt(roomsOf(doc.items), freeSymbol.x, freeSymbol.y);
    if (room) gen.board.location = room.label.trim() || getRoomKind(room.kind).name;
  }

  doc.boards.push(gen.board);
  store.state.boardId = gen.board.id;
  store.state.deviceSelection = null;
  store.commit();
  notify(store, `Tableau généré : ${plural(gen.circuits.length, 'circuit')} sur ${plural(gen.board.rows, 'rail')}.`);
  return { circuits: gen.circuits.length, rails: gen.board.rows, boardId: gen.board.id };
}

export interface ConnectReport {
  /** Appareils raccordés à un circuit existant. */
  assigned: number;
  /** Nouveaux circuits créés pour le reste. */
  created: number;
}

/**
 * Raccorde ce qui ne l'est pas encore : d'abord aux circuits existants qui desservent déjà la
 * pièce (tant qu'ils ont de la place), puis dans de nouveaux circuits ajoutés au tableau.
 */
export function connectUnlinked(store: Store): ConnectReport {
  const { doc } = store.state;
  const report: ConnectReport = { assigned: 0, created: 0 };
  if (doc.boards.length === 0) {
    const generated = generateBoard(store);
    report.created = generated?.circuits ?? 0;
    return report;
  }

  // 1. Circuits existants (un appareil à la fois : la place restante change après chaque ajout).
  for (const s of unlinkedItems(doc).symbols) {
    const current = doc.items.find((i) => i.id === s.id) as SymbolItem | undefined;
    if (!current || current.breaker !== null) continue;
    const suggestion = suggestCircuit(doc, current);
    if (!suggestion) continue;
    doc.items = doc.items.map((i) => (i.id === s.id && i.type === 'symbol' ? { ...i, breaker: suggestion.deviceId } : i));
    report.assigned++;
  }

  // 2. Nouveaux circuits pour le reste, ajoutés au tableau actif.
  const plans = planCircuits(doc);
  const board = store.activeBoard ?? doc.boards[0];
  if (board && plans.length > 0) {
    const created = appendCircuits(board, plans, () => doc.nextId++);
    const byItem = new Map<number, number>();
    for (const { plan, device } of created) for (const id of plan.itemIds) byItem.set(id, device.id);
    doc.items = doc.items.map((i) => {
      if (i.type !== 'symbol') return i;
      const dev = byItem.get(i.id);
      return dev === undefined ? i : { ...i, breaker: dev };
    });
    report.created = created.length;
  }

  if (report.assigned === 0 && report.created === 0) {
    notify(store, 'Tout est déjà raccordé.');
    return report;
  }
  store.commit();
  const parts: string[] = [];
  if (report.assigned) parts.push(`${plural(report.assigned, 'appareil raccordé', 'appareils raccordés')} à des circuits existants`);
  if (report.created) parts.push(plural(report.created, 'nouveau circuit'));
  notify(store, `${parts.join(' et ')}.`);
  return report;
}

/** Libellé « 3 · Prises cuisine · C20 » du circuit d'un appareil, ou null. */
export function circuitLabelOf(store: Store, deviceId: number | null): string | null {
  if (deviceId === null) return null;
  const { doc } = store.state;
  const o = circuitOptions(doc).find((x) => x.id === deviceId);
  return o ? circuitTitle(doc, o) : null;
}
