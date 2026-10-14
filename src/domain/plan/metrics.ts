import { getSymbol } from '../catalog';
import { GRID } from '../geometry';
import type { Doc, Item, Point, Room, SymbolItem, Wire, WireTypeId } from '../types';

/** Échelle par défaut : un carreau de la grille représente 0,5 m. */
export const DEFAULT_SCALE = 0.5;
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 5;

/** Convertit une longueur du plan (unités) en mètres. */
export const toMeters = (scale: number, units: number): number => (units / GRID) * scale;
/** Convertit des mètres en unités du plan. */
export const toUnits = (scale: number, meters: number): number => (meters / scale) * GRID;

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1] as Point;
    const [x1, y1] = points[i] as Point;
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total;
}

/** « 4,20 m » */
export const fmtMeters = (m: number): string => `${m.toFixed(2).replace('.', ',')} m`;
/** « 14,7 m² » */
export const fmtArea = (m2: number): string => `${m2.toFixed(1).replace('.', ',')} m²`;
/** Longueur de câble arrondie au dixième : « 12,4 m » */
export const fmtLength = (m: number): string => `${m.toFixed(1).replace('.', ',')} m`;

export interface RoomStats {
  room: Room;
  /** Largeur et profondeur en mètres. */
  width: number;
  depth: number;
  /** Surface en m². */
  area: number;
  symbols: SymbolItem[];
  /** Prises 16 A (hors prises spécialisées, RJ45 et TV). */
  sockets: number;
  lights: number;
  switches: number;
}

const SOCKET_KINDS = new Set(['prise']);
const LIGHT_KINDS = new Set(['lampe', 'applique', 'spot']);
const SWITCH_KINDS = new Set(['inter', 'va', 'poussoir']);

const contains = (r: Room, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** Pièce qui contient le point ; la plus petite si plusieurs se recouvrent. */
export function roomAt(rooms: readonly Room[], x: number, y: number): Room | null {
  let best: Room | null = null;
  for (const r of rooms) {
    if (contains(r, x, y) && (!best || r.w * r.h < best.w * best.h)) best = r;
  }
  return best;
}

export const roomsOf = (items: readonly Item[]): Room[] =>
  items.filter((i): i is Room => i.type === 'room');

/** Surface, dimensions et équipements de chaque pièce (un symbole appartient à la pièce où se trouve son centre). */
export function roomStats(doc: Pick<Doc, 'items' | 'scale'>): RoomStats[] {
  const rooms = roomsOf(doc.items);
  const stats = new Map<number, RoomStats>(
    rooms.map((room) => {
      const width = toMeters(doc.scale, room.w);
      const depth = toMeters(doc.scale, room.h);
      return [room.id, { room, width, depth, area: width * depth, symbols: [], sockets: 0, lights: 0, switches: 0 }];
    }),
  );
  for (const it of doc.items) {
    if (it.type !== 'symbol') continue;
    const room = roomAt(rooms, it.x, it.y);
    const s = room ? stats.get(room.id) : undefined;
    if (!s) continue;
    s.symbols.push(it);
    if (SOCKET_KINDS.has(it.kind)) s.sockets++;
    else if (LIGHT_KINDS.has(it.kind)) s.lights++;
    else if (SWITCH_KINDS.has(it.kind)) s.switches++;
  }
  return [...stats.values()].sort((a, b) => a.room.y - b.room.y || a.room.x - b.room.x);
}

export interface PlanSummary {
  rooms: number;
  /** Surface totale des pièces (m²). */
  area: number;
  /** Longueur totale des murs (m). */
  wallLength: number;
  /** Nombre de symboles par catégorie de la palette. */
  byCategory: { category: string; count: number }[];
  /** Nombre de symboles par type. */
  byKind: { kind: string; count: number }[];
  /** Longueur de câble par type (m). */
  wires: { type: WireTypeId; length: number }[];
  wireLength: number;
}

export function planSummary(doc: Pick<Doc, 'items' | 'scale'>): PlanSummary {
  const kinds = new Map<string, number>();
  const categories = new Map<string, number>();
  const wires = new Map<WireTypeId, number>();
  let area = 0;
  let rooms = 0;
  let wallLength = 0;

  for (const it of doc.items) {
    switch (it.type) {
      case 'room':
        rooms++;
        area += toMeters(doc.scale, it.w) * toMeters(doc.scale, it.h);
        break;
      case 'wall':
        wallLength += toMeters(doc.scale, polylineLength(it.points));
        break;
      case 'wire':
        wires.set(it.wtype, (wires.get(it.wtype) ?? 0) + toMeters(doc.scale, polylineLength(it.points)));
        break;
      case 'symbol': {
        kinds.set(it.kind, (kinds.get(it.kind) ?? 0) + 1);
        const cat = getSymbol(it.kind)?.category ?? 'Autre';
        categories.set(cat, (categories.get(cat) ?? 0) + 1);
        break;
      }
      default:
        break;
    }
  }

  const wireList = [...wires.entries()].map(([type, length]) => ({ type, length }));
  return {
    rooms,
    area,
    wallLength,
    byCategory: [...categories.entries()].map(([category, count]) => ({ category, count })),
    byKind: [...kinds.entries()].map(([kind, count]) => ({ kind, count })),
    wires: wireList,
    wireLength: wireList.reduce((s, w) => s + w.length, 0),
  };
}

export const wireLengthM = (doc: Pick<Doc, 'scale'>, wire: Pick<Wire, 'points'>): number =>
  toMeters(doc.scale, polylineLength(wire.points));
