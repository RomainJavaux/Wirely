import type { Item, Room, SymbolItem } from '../types';
import { FACE_TOLERANCE } from '../walls/faces';
import { roomContains } from './rooms';

/**
 * Réarranger le plan sans perdre ce qu'on a compté : une pièce que l'on déplace emporte ses points
 * et ses ouvertures ; une pièce que l'on redimensionne garde ses points collés à leurs murs.
 */

/** Symboles situés dans la pièce ou sur son contour (portes et fenêtres comprises). */
export function contentsOf(items: readonly Item[], room: Room): SymbolItem[] {
  return items.filter((i): i is SymbolItem => i.type === 'symbol' && roomContains(room, i.x, i.y));
}

/** Déplace une pièce et tout ce qu'elle contient. `contentIds` : les symboles à emporter. */
export function translateRoom(
  items: readonly Item[],
  room: Room,
  contentIds: ReadonlySet<number>,
  dx: number,
  dy: number,
): Item[] {
  return items.map((i) => {
    if (i.id === room.id && i.type === 'room') {
      return { ...i, x: room.x + dx, y: room.y + dy, parts: room.parts.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) };
    }
    if (i.type === 'symbol' && contentIds.has(i.id)) return { ...i, x: i.x + dx, y: i.y + dy };
    return i;
  });
}

/**
 * Position d'un point quand le rectangle principal de sa pièce passe de (w, h) à (w2, h2) : un
 * point proche du mur de droite ou du bas le suit, un point proche du mur de gauche ou du haut ne
 * bouge pas, et un point au milieu (plafond) garde sa place relative.
 */
function follow(v: number, start: number, size: number, size2: number): number {
  const fromStart = v - start;
  const fromEnd = start + size - v;
  if (fromEnd <= FACE_TOLERANCE && fromStart > FACE_TOLERANCE) return start + size2 - fromEnd;
  if (fromStart <= FACE_TOLERANCE) return v;
  return start + (fromStart * size2) / size;
}

/**
 * Redimensionne le rectangle principal d'une pièce. `origin` est la pièce avant le geste et
 * `contents` ses symboles à ce moment-là : on repart toujours de l'état initial, pour que le
 * résultat ne dépende pas du chemin parcouru par la souris.
 */
export function resizeRoom(
  items: readonly Item[],
  origin: Room,
  contents: readonly SymbolItem[],
  w: number,
  h: number,
): Item[] {
  const byId = new Map(contents.map((s) => [s.id, s] as const));
  return items.map((i) => {
    if (i.id === origin.id && i.type === 'room') return { ...i, w, h };
    const start = i.type === 'symbol' ? byId.get(i.id) : undefined;
    if (!start || i.type !== 'symbol') return i;
    // Seuls les points du rectangle principal suivent ; ceux d'une partie ajoutée restent en place.
    const inMain = start.x >= origin.x && start.x <= origin.x + origin.w && start.y >= origin.y && start.y <= origin.y + origin.h;
    if (!inMain) return i;
    const x = Math.round(follow(start.x, origin.x, origin.w, w));
    const y = Math.round(follow(start.y, origin.y, origin.h, h));
    return {
      ...i,
      x: Math.min(origin.x + w, Math.max(origin.x, x)),
      y: Math.min(origin.y + h, Math.max(origin.y, y)),
    };
  });
}

/** Retire la marque « à vérifier » d'un point ou « à préciser » d'une pièce que l'on vient d'ajuster. */
export function settle<T extends Item>(item: T): T {
  if ((item.type === 'symbol' || item.type === 'room') && item.rough) {
    const { rough: _rough, ...rest } = item;
    return rest as T;
  }
  return item;
}
