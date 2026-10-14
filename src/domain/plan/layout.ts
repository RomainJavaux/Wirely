import { toUnits } from './metrics';
import { roomRects } from './rooms';
import type { Doc, Room, RoomKind } from '../types';

/** Dimensions proposées pour une nouvelle pièce (largeur × profondeur, en mètres). */
export const DEFAULT_ROOM_SIZE: Readonly<Record<RoomKind, [number, number]>> = {
  sejour: [5, 4],
  cuisine: [3.5, 3],
  chambre: [3.5, 3],
  bureau: [3, 3],
  sdb: [2.5, 2.2],
  wc: [1.2, 1.6],
  entree: [2, 2],
  couloir: [1.2, 3.5],
  garage: [3, 5.5],
  cave: [3, 3],
  exterieur: [4, 3],
  autre: [3, 3],
};

/** Nouvelle pièce qui tient dans [w, h] unités sans recouvrir l'existante. */
export interface RoomSpot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Les mesures de pièces sont des multiples de 10 unités (comme la saisie des dimensions). */
export const metersToRoomUnits = (scale: number, meters: number): number =>
  Math.max(20, Math.round(toUnits(scale, meters) / 10) * 10);

const overlaps = (a: RoomSpot, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

/**
 * Emplacement d'une nouvelle pièce : collée à une pièce existante (à droite, en dessous, à gauche
 * puis au-dessus de la dernière pièce, puis des précédentes), sans recouvrement. La première pièce
 * est posée à l'origine.
 */
export function findRoomSpot(doc: Pick<Doc, 'items'>, w: number, h: number, near?: Room): RoomSpot {
  const rooms = doc.items.filter((i): i is Room => i.type === 'room');
  if (rooms.length === 0) return { x: 0, y: 0, w, h };

  const rects = rooms.flatMap((r) => roomRects(r));
  const free = (s: RoomSpot): boolean => !rects.some((r) => overlaps(s, r));

  const ordered = near ? [near, ...[...rooms].reverse().filter((r) => r.id !== near.id)] : [...rooms].reverse();
  for (const r of ordered) {
    const candidates: RoomSpot[] = [
      { x: r.x + r.w, y: r.y, w, h },
      { x: r.x, y: r.y + r.h, w, h },
      { x: r.x - w, y: r.y, w, h },
      { x: r.x, y: r.y - h, w, h },
      { x: r.x + r.w, y: r.y + r.h - h, w, h },
      { x: r.x + r.w - w, y: r.y + r.h, w, h },
    ];
    const hit = candidates.find(free);
    if (hit) return hit;
  }
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const top = Math.min(...rects.map((r) => r.y));
  return { x: right, y: top, w, h };
}
