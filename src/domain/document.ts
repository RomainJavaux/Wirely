import { WIRE_TYPES } from './catalog';
import type { Doc, Item, ItemType, Point, Rotation } from './types';

export const DEFAULT_NAME = 'Mon installation';

/** Ordre de dessin : les pièces au fond, les textes au-dessus. */
const DRAW_ORDER: readonly ItemType[] = ['room', 'wall', 'wire', 'symbol', 'text'];

export const createDoc = (name = DEFAULT_NAME): Doc => ({ name, items: [], nextId: 1 });

export const sortedForDrawing = (items: readonly Item[]): Item[] =>
  [...items].sort((a, b) => DRAW_ORDER.indexOf(a.type) - DRAW_ORDER.indexOf(b.type));

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isPoints = (v: unknown): v is Point[] =>
  Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]));
const toRotation = (v: unknown): Rotation => (v === 90 || v === 180 || v === 270 ? v : 0);

/** Valide et normalise un élément brut ; retourne null s'il est inutilisable. */
function parseItem(raw: unknown): Item | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.id)) return null;
  switch (r.type) {
    case 'room':
      if (!isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h)) return null;
      return { id: r.id, type: 'room', x: r.x, y: r.y, w: r.w, h: r.h, label: isStr(r.label) ? r.label : '' };
    case 'wall':
      return isPoints(r.points) ? { id: r.id, type: 'wall', points: r.points } : null;
    case 'wire':
      if (!isPoints(r.points)) return null;
      return {
        id: r.id,
        type: 'wire',
        points: r.points,
        wtype: isStr(r.wtype) && r.wtype in WIRE_TYPES ? (r.wtype as keyof typeof WIRE_TYPES) : 'prises',
      };
    case 'symbol':
      if (!isStr(r.kind) || !isNum(r.x) || !isNum(r.y)) return null;
      return { id: r.id, type: 'symbol', kind: r.kind, x: r.x, y: r.y, rot: toRotation(r.rot), label: isStr(r.label) ? r.label : '' };
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
  const items = r.items.map(parseItem).filter((i): i is Item => i !== null);
  const maxId = items.reduce((m, i) => Math.max(m, i.id), 0);
  return {
    name: isStr(r.name) && r.name.trim() ? r.name : DEFAULT_NAME,
    items,
    nextId: Math.max(maxId + 1, isNum(r.nextId) ? r.nextId : isNum(r.nid) ? r.nid : 1),
  };
}
