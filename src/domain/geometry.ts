import type { Item, Point } from './types';

/** Pas de la grille d'accrochage (unités du plan). */
export const SNAP = 10;
/** Taille d'un carreau affiché (1 carreau = 20 unités). */
export const GRID = 20;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const snap = (v: number, step = SNAP): number => Math.round(v / step) * step;
export const snapPoint = (x: number, y: number): Point => [snap(x), snap(y)];
export const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function itemBounds(item: Item): Rect {
  switch (item.type) {
    case 'room': {
      const rects = [{ x: item.x, y: item.y, w: item.w, h: item.h }, ...item.parts];
      return {
        x0: Math.min(...rects.map((r) => r.x)),
        y0: Math.min(...rects.map((r) => r.y)),
        x1: Math.max(...rects.map((r) => r.x + r.w)),
        y1: Math.max(...rects.map((r) => r.y + r.h)),
      };
    }
    case 'wall':
    case 'wire': {
      const xs = item.points.map((p) => p[0]);
      const ys = item.points.map((p) => p[1]);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    case 'symbol': {
      const half = item.label ? Math.max(22, item.label.length * 3.6) : 22;
      return { x0: item.x - half, y0: item.y - 22, x1: item.x + half, y1: item.y + (item.label ? 34 : 22) };
    }
    case 'text':
      return { x0: item.x, y0: item.y - 14, x1: item.x + item.text.length * 8, y1: item.y + 4 };
  }
}

export function unionBounds(items: readonly Item[]): Rect | null {
  if (items.length === 0) return null;
  return items.map(itemBounds).reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }));
}

/** Retourne une copie de l'élément décalée de (dx, dy). */
export function translateItem<T extends Item>(item: T, dx: number, dy: number): T {
  const it: Item = item;
  if (it.type === 'wall' || it.type === 'wire') {
    return { ...it, points: it.points.map(([x, y]): Point => [x + dx, y + dy]) } as T;
  }
  if (it.type === 'room') {
    return {
      ...it,
      x: it.x + dx,
      y: it.y + dy,
      parts: it.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    } as T;
  }
  return { ...it, x: it.x + dx, y: it.y + dy } as T;
}
