import { analyze } from './board/layout';
import { parseBoards } from './board/parse';
import { WIRE_TYPES } from './catalog';
import { DEFAULT_SCALE, MAX_SCALE, MIN_SCALE } from './plan/metrics';
import { ROOM_KINDS } from './plan/roomKinds';
import type { Board } from './board/types';
import type { Doc, Item, ItemType, Point, Rotation, RoomKind, RoomRect } from './types';

export const DEFAULT_NAME = 'Mon installation';

/** Ordre de dessin : les pièces au fond, les textes au-dessus. */
const DRAW_ORDER: readonly ItemType[] = ['room', 'wall', 'wire', 'symbol', 'text'];

export const createDoc = (name = DEFAULT_NAME): Doc => ({
  name,
  items: [],
  boards: [],
  scale: DEFAULT_SCALE,
  nextId: 1,
});

export const sortedForDrawing = (items: readonly Item[]): Item[] =>
  [...items].sort((a, b) => DRAW_ORDER.indexOf(a.type) - DRAW_ORDER.indexOf(b.type));

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isPoints = (v: unknown): v is Point[] =>
  Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]));
const toRotation = (v: unknown): Rotation => (v === 90 || v === 180 || v === 270 ? v : 0);
const toKind = (v: unknown): RoomKind => (isStr(v) && v in ROOM_KINDS ? (v as RoomKind) : 'autre');
const str = (v: unknown, max = 40): string => (isStr(v) ? v.slice(0, max) : '');
const MAX_PARTS = 16;

function parseParts(v: unknown): RoomRect[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
    .filter((q) => isNum(q.x) && isNum(q.y) && isNum(q.w) && isNum(q.h) && (q.w as number) > 0 && (q.h as number) > 0)
    .slice(0, MAX_PARTS)
    .map((q) => ({ x: q.x as number, y: q.y as number, w: q.w as number, h: q.h as number }));
}

/**
 * Identifiant du disjoncteur. Les anciens fichiers portaient un repère saisi à la main (`circuit`) :
 * on le mémorise pour le résoudre une fois les tableaux lus.
 */
function breakerOf(r: Record<string, unknown>, legacy: Map<number, string>): number | null {
  if (isNum(r.breaker)) return r.breaker;
  const old = str(r.circuit);
  if (old.trim() && isNum(r.id)) legacy.set(r.id, old.trim());
  return null;
}

/** Valide et normalise un élément brut ; retourne null s'il est inutilisable. */
function parseItem(raw: unknown, legacy: Map<number, string>): Item | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.id)) return null;
  switch (r.type) {
    case 'room':
      if (!isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h)) return null;
      return {
        id: r.id,
        type: 'room',
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        label: isStr(r.label) ? r.label : '',
        kind: toKind(r.kind),
        parts: parseParts(r.parts),
      };
    case 'wall':
      return isPoints(r.points) ? { id: r.id, type: 'wall', points: r.points } : null;
    case 'wire':
      if (!isPoints(r.points)) return null;
      return {
        id: r.id,
        type: 'wire',
        points: r.points,
        wtype: isStr(r.wtype) && r.wtype in WIRE_TYPES ? (r.wtype as keyof typeof WIRE_TYPES) : 'prises',
        breaker: breakerOf(r, legacy),
      };
    case 'symbol':
      if (!isStr(r.kind) || !isNum(r.x) || !isNum(r.y)) return null;
      return {
        id: r.id,
        type: 'symbol',
        kind: r.kind,
        x: r.x,
        y: r.y,
        rot: toRotation(r.rot),
        label: isStr(r.label) ? r.label : '',
        breaker: breakerOf(r, legacy),
        board: isNum(r.board) ? r.board : null,
        height: isNum(r.height) && r.height >= 0 && r.height <= 400 ? Math.round(r.height) : null,
      };
    case 'text':
      if (!isStr(r.text) || !isNum(r.x) || !isNum(r.y)) return null;
      return { id: r.id, type: 'text', x: r.x, y: r.y, text: r.text };
    default:
      return null;
  }
}

/** Reconstruit un document depuis des données non fiables (fichier, stockage local). */
export function parseDoc(raw: unknown): Doc {
  if (typeof raw !== 'object' || raw === null) throw new Error('Document invalide');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.items)) throw new Error('Document invalide : liste d’éléments manquante');
  const legacy = new Map<number, string>();
  const items = r.items.map((i) => parseItem(i, legacy)).filter((i): i is Item => i !== null);
  const boards = parseBoards(r.boards);
  resolveLinks(items, boards, legacy);
  const maxId = Math.max(
    items.reduce((m, i) => Math.max(m, i.id), 0),
    ...boards.flatMap((b) => [b.id, ...b.devices.map((d) => d.id)]),
  );
  return {
    name: isStr(r.name) && r.name.trim() ? r.name : DEFAULT_NAME,
    items,
    boards,
    scale: isNum(r.scale) && r.scale >= MIN_SCALE && r.scale <= MAX_SCALE ? r.scale : DEFAULT_SCALE,
    nextId: Math.max(maxId + 1, isNum(r.nextId) ? r.nextId : isNum(r.nid) ? r.nid : 1),
  };
}

/**
 * Valide les liens du plan vers les tableaux : un disjoncteur ou un tableau qui n'existe plus est
 * oublié, et un ancien repère saisi à la main est résolu sur le premier tableau.
 */
function resolveLinks(items: Item[], boards: Board[], legacy: Map<number, string>): void {
  const devices = new Set(boards.flatMap((b) => b.devices.map((d) => d.id)));
  const boardIds = new Set(boards.map((b) => b.id));
  const first = boards[0];
  const refs = new Map<string, number>();
  if (first) {
    const a = analyze(first);
    for (const d of a.circuits) {
      const ref = a.refs.get(d.id);
      if (ref) refs.set(ref, d.id);
    }
  }

  for (const it of items) {
    if (it.type !== 'wire' && it.type !== 'symbol') continue;
    if (it.breaker !== null && !devices.has(it.breaker)) it.breaker = null;
    if (it.breaker === null) {
      const old = legacy.get(it.id);
      const found = old ? refs.get(old) : undefined;
      if (found !== undefined) it.breaker = found;
    }
    if (it.type === 'symbol' && it.board !== null && !boardIds.has(it.board)) it.board = null;
  }
}
