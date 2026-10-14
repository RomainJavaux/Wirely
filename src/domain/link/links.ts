import { USAGES, getDeviceDef } from '../board/catalog';
import { deviceSpec } from '../board/bom';
import { analyze, effectiveUsage, isCircuitRole, type Analysis } from '../board/layout';
import type { Board, Device } from '../board/types';
import { getSymbol } from '../catalog';
import { polylineLength, roomAt, roomsOf, toMeters } from '../plan/metrics';
import { getRoomKind } from '../plan/roomKinds';
import type { Doc, Item, Room, SymbolItem, Wire } from '../types';

/**
 * Lien entre le plan et les tableaux. Un câble ou un symbole est raccordé à un disjoncteur par
 * l'identifiant de l'appareil (`breaker`) : contrairement au repère affiché (1, 2, 3…), il ne
 * change pas quand on déplace des appareils dans le tableau.
 */

type Linkable = Pick<Doc, 'items' | 'boards' | 'scale'>;

export interface DeviceLocation {
  board: Board;
  device: Device;
}

export function locateDevice(doc: Pick<Doc, 'boards'>, deviceId: number | null): DeviceLocation | null {
  if (deviceId === null) return null;
  for (const board of doc.boards) {
    const device = board.devices.find((d) => d.id === deviceId);
    if (device) return { board, device };
  }
  return null;
}

/** Catégories de symboles qui n'ont pas de raccordement à un disjoncteur. */
const UNPOWERED_CATEGORIES = new Set(['Ouvertures', 'Distribution']);

/** Vrai pour un symbole qui doit être alimenté (prise, lampe, commande, équipement…). */
export const isElectrical = (s: SymbolItem): boolean => {
  const cat = getSymbol(s.kind)?.category;
  return cat !== undefined && !UNPOWERED_CATEGORIES.has(cat);
};

export interface CircuitOption {
  /** Identifiant de l'appareil (disjoncteur ou disjoncteur différentiel). */
  id: number;
  boardId: number;
  boardName: string;
  ref: string;
  label: string;
  /** « C20 », « 2P · C16 · 30 mA »… */
  spec: string;
  color: string;
  /** Repère du différentiel amont, ou null. */
  group: string | null;
}

/** Tous les disjoncteurs de tous les tableaux, dans l'ordre d'implantation. */
export function circuitOptions(doc: Pick<Doc, 'boards'>): CircuitOption[] {
  const out: CircuitOption[] = [];
  for (const board of doc.boards) {
    const a = analyze(board);
    for (const d of a.circuits) {
      const def = getDeviceDef(d.kind);
      const rcd = a.protectedBy.get(d.id) ?? null;
      out.push({
        id: d.id,
        boardId: board.id,
        boardName: board.name,
        ref: a.refs.get(d.id) ?? '',
        label: d.label.trim() || def?.name || '',
        spec: deviceSpec(d),
        color: USAGES[effectiveUsage(d)].color,
        group: rcd && rcd.id !== d.id ? (a.refs.get(rcd.id) ?? null) : null,
      });
    }
  }
  return out;
}

/** Repère et couleur d'usage de chaque disjoncteur, pour étiqueter les éléments du plan. */
export function circuitInfo(doc: Pick<Doc, 'boards'>): Map<number, { ref: string; color: string }> {
  return new Map(circuitOptions(doc).map((o) => [o.id, { ref: o.ref, color: o.color }]));
}

/** Libellé unique d'un circuit : « 3 · Prises cuisine · C20 » (préfixé du tableau s'il y en a plusieurs). */
export function circuitTitle(doc: Pick<Doc, 'boards'>, o: CircuitOption): string {
  const base = `${o.ref} · ${o.label} · ${o.spec}`;
  if (doc.boards.length <= 1) return base;
  // Deux tableaux peuvent porter le même nom : on numérote pour garder des libellés uniques.
  const sameName = doc.boards.filter((b) => b.name === o.boardName);
  const suffix = sameName.length > 1 ? ` (${sameName.findIndex((b) => b.id === o.boardId) + 1})` : '';
  return `${o.boardName}${suffix} — ${base}`;
}

/** Retrouve le circuit dont le libellé a été saisi (liste de suggestions du navigateur). */
export function circuitFromTitle(doc: Pick<Doc, 'boards'>, text: string): CircuitOption | null {
  const wanted = text.trim().toLowerCase();
  if (!wanted) return null;
  return circuitOptions(doc).find((o) => circuitTitle(doc, o).toLowerCase() === wanted) ?? null;
}

export interface CircuitLinks {
  symbols: SymbolItem[];
  wires: Wire[];
  /** Longueur de câble raccordée, en mètres. */
  length: number;
  sockets: number;
  lights: number;
  switches: number;
  /** Pièces desservies, avec le nombre d'appareils dans chacune. */
  rooms: { room: Room; label: string; count: number }[];
}

const SOCKETS = new Set(['prise']);
const LIGHTS = new Set(['lampe', 'applique', 'spot']);
const SWITCHES = new Set(['inter', 'va', 'poussoir']);

const emptyLinks = (): CircuitLinks => ({ symbols: [], wires: [], length: 0, sockets: 0, lights: 0, switches: 0, rooms: [] });

/** Ce qui est raccordé à chaque disjoncteur (uniquement ceux qui ont au moins un raccordement). */
export function allLinks(doc: Linkable): Map<number, CircuitLinks> {
  const rooms = roomsOf(doc.items);
  const map = new Map<number, CircuitLinks>();
  const get = (id: number): CircuitLinks => {
    let l = map.get(id);
    if (!l) {
      l = emptyLinks();
      map.set(id, l);
    }
    return l;
  };

  for (const it of doc.items) {
    if (it.type === 'wire' && it.breaker !== null) {
      const l = get(it.breaker);
      l.wires.push(it);
      l.length += toMeters(doc.scale, polylineLength(it.points));
    } else if (it.type === 'symbol' && it.breaker !== null) {
      const l = get(it.breaker);
      l.symbols.push(it);
      if (SOCKETS.has(it.kind)) l.sockets++;
      else if (LIGHTS.has(it.kind)) l.lights++;
      else if (SWITCHES.has(it.kind)) l.switches++;
    }
  }

  for (const l of map.values()) {
    const counts = new Map<number, number>();
    for (const s of l.symbols) {
      const room = roomAt(rooms, s.x, s.y);
      if (room) counts.set(room.id, (counts.get(room.id) ?? 0) + 1);
    }
    l.rooms = [...counts.entries()]
      .map(([id, count]) => {
        const room = rooms.find((r) => r.id === id) as Room;
        return { room, label: room.label.trim() || getRoomKind(room.kind).name, count };
      })
      .sort((a, b) => b.count - a.count);
  }
  return map;
}

export const circuitLinks = (doc: Linkable, deviceId: number): CircuitLinks =>
  allLinks(doc).get(deviceId) ?? emptyLinks();

/** Texte court : « 6 prises · 2 lampes · 12,4 m ». */
export function linksSummary(l: CircuitLinks): string {
  const parts: string[] = [];
  if (l.sockets) parts.push(`${l.sockets} prise${l.sockets > 1 ? 's' : ''}`);
  if (l.lights) parts.push(`${l.lights} point${l.lights > 1 ? 's' : ''} lumineux`);
  if (l.switches) parts.push(`${l.switches} commande${l.switches > 1 ? 's' : ''}`);
  const other = l.symbols.length - l.sockets - l.lights - l.switches;
  if (other > 0) parts.push(`${other} autre${other > 1 ? 's' : ''}`);
  if (l.length > 0) parts.push(`${l.length.toFixed(1).replace('.', ',')} m`);
  return parts.join(' · ');
}

export interface Unlinked {
  wires: Wire[];
  symbols: SymbolItem[];
}

/** Câbles et appareils alimentés qui ne sont raccordés à aucun disjoncteur. */
export function unlinkedItems(doc: Pick<Doc, 'items'>): Unlinked {
  return {
    wires: doc.items.filter((i): i is Wire => i.type === 'wire' && i.breaker === null),
    symbols: doc.items.filter((i): i is SymbolItem => i.type === 'symbol' && i.breaker === null && isElectrical(i)),
  };
}

/** Éléments du plan raccordés à un disjoncteur. */
export const itemsOfCircuit = (doc: Pick<Doc, 'items'>, deviceId: number): Item[] =>
  doc.items.filter((i) => (i.type === 'wire' || i.type === 'symbol') && i.breaker === deviceId);

/** Symboles « tableau » du plan. */
export const tableauSymbols = (doc: Pick<Doc, 'items'>): SymbolItem[] =>
  doc.items.filter((i): i is SymbolItem => i.type === 'symbol' && i.kind === 'tableau');

/** Symbole du plan qui représente ce tableau, s'il y en a un. */
export const symbolOfBoard = (doc: Pick<Doc, 'items'>, boardId: number): SymbolItem | undefined =>
  tableauSymbols(doc).find((s) => s.board === boardId);

/** Supprime les raccordements vers des appareils qui n'existent plus. */
export function clearLinks(doc: Pick<Doc, 'items'>, deviceIds: ReadonlySet<number>): number {
  let n = 0;
  doc.items = doc.items.map((i) => {
    if ((i.type === 'wire' || i.type === 'symbol') && i.breaker !== null && deviceIds.has(i.breaker)) {
      n++;
      return { ...i, breaker: null };
    }
    return i;
  });
  return n;
}

/** Supprime les liens vers un tableau supprimé. */
export function clearBoardLinks(doc: Pick<Doc, 'items'>, boardId: number): void {
  doc.items = doc.items.map((i) => (i.type === 'symbol' && i.board === boardId ? { ...i, board: null } : i));
}

/** Nombre maximal de prises conseillé par circuit, selon sa section (repères indicatifs, NF C 15-100). */
export const MAX_SOCKETS_BY_SECTION: Readonly<Record<number, number>> = { 1.5: 5, 2.5: 8 };

export { isCircuitRole };

const normalize = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Texte (sans accents ni majuscules) sur lequel porte la recherche d'un circuit. */
export function circuitSearchText(d: Device, a: Analysis, links: ReadonlyMap<number, CircuitLinks>): string {
  const l = links.get(d.id);
  const parts = [
    a.refs.get(d.id),
    d.label,
    d.dest,
    getDeviceDef(d.kind)?.name,
    deviceSpec(d),
    USAGES[effectiveUsage(d)].name,
    d.note,
    ...d.outputs,
    ...(l?.rooms.map((r) => r.label) ?? []),
    ...(l?.symbols.map((s) => s.label || getSymbol(s.kind)?.name || '') ?? []),
  ];
  return normalize(parts.filter(Boolean).join(' '));
}

/**
 * Appareils d'un tableau qui répondent à la recherche (tous les mots doivent apparaître : nom,
 * destination, repère, pièce desservie, appareils raccordés…). null si la recherche est vide.
 */
export function matchingDevices(doc: Linkable, board: Board, filter: string): Set<number> | null {
  const terms = normalize(filter).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  const a = analyze(board);
  const links = allLinks(doc);
  const out = new Set<number>();
  for (const d of board.devices) {
    const text = circuitSearchText(d, a, links);
    if (terms.every((t) => text.includes(t))) out.add(d.id);
  }
  return out;
}

/** Nombre d'éléments du plan raccordés à chaque appareil du tableau (pour les pastilles). */
export function linkBadges(doc: Linkable): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, l] of allLinks(doc)) out.set(id, l.symbols.length + l.wires.length);
  return out;
}
