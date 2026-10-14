import type { Room, RoomRect } from '../types';

/**
 * Une pièce est un rectangle principal (x, y, w, h) auquel on peut ajouter des « parties » :
 * c'est ainsi qu'on représente une pièce en L, en U, avec un renfoncement… Surface, appartenance
 * des symboles et contour se calculent sur l'union des rectangles, sans double comptage.
 */

type Shape = Pick<Room, 'x' | 'y' | 'w' | 'h' | 'parts'>;

export const roomRects = (r: Shape): RoomRect[] => [{ x: r.x, y: r.y, w: r.w, h: r.h }, ...r.parts];

const inside = (r: RoomRect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export const roomContains = (r: Shape, x: number, y: number): boolean =>
  roomRects(r).some((rect) => inside(rect, x, y));

/** Boîte englobante de la pièce. */
export function roomBox(r: Shape): { x0: number; y0: number; x1: number; y1: number } {
  const rects = roomRects(r);
  return {
    x0: Math.min(...rects.map((q) => q.x)),
    y0: Math.min(...rects.map((q) => q.y)),
    x1: Math.max(...rects.map((q) => q.x + q.w)),
    y1: Math.max(...rects.map((q) => q.y + q.h)),
  };
}

/** Grille de cellules délimitée par tous les bords des rectangles. */
function cells(rects: RoomRect[]): { xs: number[]; ys: number[]; filled: (i: number, j: number) => boolean } {
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  const filled = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= ys.length - 1) return false;
    const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
    const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
    return rects.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h);
  };
  return { xs, ys, filled };
}

/** Surface de l'union des rectangles, en unités du plan au carré (les recouvrements comptent une fois). */
export function unionArea(rects: RoomRect[]): number {
  if (rects.length === 0) return 0;
  const { xs, ys, filled } = cells(rects);
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (filled(i, j)) area += ((xs[i + 1] as number) - (xs[i] as number)) * ((ys[j + 1] as number) - (ys[j] as number));
    }
  }
  return area;
}

export const roomArea = (r: Shape): number => unionArea(roomRects(r));

export type Segment = [number, number, number, number];

/** Contour extérieur de l'union : les arêtes communes à deux parties disparaissent. */
export function outlineSegments(rects: RoomRect[]): Segment[] {
  if (rects.length === 0) return [];
  const { xs, ys, filled } = cells(rects);
  const out: Segment[] = [];
  for (let i = 0; i <= xs.length - 1; i++) {
    for (let j = 0; j <= ys.length - 1; j++) {
      const here = filled(i, j);
      // arête haute de la cellule (i, j) : séparation avec la cellule du dessus
      if (i < xs.length - 1 && here !== filled(i, j - 1)) {
        out.push([xs[i] as number, ys[j] as number, xs[i + 1] as number, ys[j] as number]);
      }
      // arête gauche : séparation avec la cellule de gauche
      if (j < ys.length - 1 && here !== filled(i - 1, j)) {
        out.push([xs[i] as number, ys[j] as number, xs[i] as number, ys[j + 1] as number]);
      }
    }
  }
  return out;
}

/** Rectangle le plus grand (là où poser le nom de la pièce). */
export function largestRect(rects: RoomRect[]): RoomRect {
  return rects.reduce((best, r) => (r.w * r.h > best.w * best.h ? r : best), rects[0] as RoomRect);
}

/** `source` est absorbée par `target` : ses rectangles deviennent des parties de `target`. */
export function mergeRooms(target: Room, source: Room): Room {
  return { ...target, parts: [...target.parts, ...roomRects(source)] };
}

/** Retire la partie `index` de la pièce. Retourne la pièce amputée et le rectangle détaché. */
export function detachPart(room: Room, index: number): { room: Room; part: RoomRect } | null {
  const part = room.parts[index];
  if (!part) return null;
  return { room: { ...room, parts: room.parts.filter((_, i) => i !== index) }, part };
}

/** Vrai si deux rectangles se touchent ou se recouvrent. */
export function touches(a: RoomRect, b: RoomRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Vrai si toutes les parties forment un seul tenant (chacune touche au moins une autre). */
export function isConnected(rects: RoomRect[]): boolean {
  if (rects.length <= 1) return true;
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const cur = queue.pop() as number;
    rects.forEach((r, i) => {
      if (!seen.has(i) && touches(rects[cur] as RoomRect, r)) {
        seen.add(i);
        queue.push(i);
      }
    });
  }
  return seen.size === rects.length;
}
