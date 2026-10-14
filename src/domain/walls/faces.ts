import { toMeters, toUnits } from '../plan/metrics';
import { outlineSegments, roomRects } from '../plan/rooms';
import type { Doc, Point, Room, SymbolItem } from '../types';
import { effectiveHeight, isCeilingKind, isOpeningKind, mountingOf, type Mounting } from './mounting';

/**
 * Faces de murs : chaque côté d'une pièce, vu de l'intérieur. C'est la vue que l'on dessine pour
 * « définir sur chaque mur où sont les prises, interrupteurs… » : une position le long du mur
 * (en cm depuis le coin de gauche) et une hauteur (en cm depuis le sol).
 *
 * Le haut du plan est le nord. Vu de l'intérieur, la gauche et la droite dépendent du mur :
 * mur nord → ouest à gauche ; mur est → nord à gauche ; mur sud → est à gauche ; mur ouest → sud à gauche.
 */

export type Orientation = 'N' | 'E' | 'S' | 'W';

export const ORIENTATION_NAMES: Readonly<Record<Orientation, string>> = {
  N: 'Nord',
  E: 'Est',
  S: 'Sud',
  W: 'Ouest',
};

export interface WallFace {
  /** Identifiant dans la pièce : « N0 », « E0 »… (orientation + rang), stable tant que la forme ne change pas. */
  key: string;
  roomId: number;
  orientation: Orientation;
  name: string;
  /** Début (coin de gauche) et fin (coin de droite) vus de l'intérieur, en unités du plan. */
  a: Point;
  b: Point;
  /** Longueur en unités du plan. */
  length: number;
  /** Direction du mur (a → b) et normale tournée vers l'intérieur de la pièce, unitaires. */
  dir: [number, number];
  inward: [number, number];
}

const strictlyInside = (rects: ReturnType<typeof roomRects>, x: number, y: number): boolean =>
  rects.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);

interface Raw {
  o: Orientation;
  coord: number;
  start: number;
  end: number;
}

/** Faces d'une pièce, triées par orientation (N, E, S, W) puis par position. Une pièce en L en a plus de quatre. */
export function roomFaces(room: Room): WallFace[] {
  const rects = roomRects(room);
  const raws: Raw[] = [];

  for (const [x1, y1, x2, y2] of outlineSegments(rects)) {
    if (y1 === y2) {
      const o: Orientation = strictlyInside(rects, (x1 + x2) / 2, y1 + 0.5) ? 'N' : 'S';
      raws.push({ o, coord: y1, start: Math.min(x1, x2), end: Math.max(x1, x2) });
    } else {
      const o: Orientation = strictlyInside(rects, x1 + 0.5, (y1 + y2) / 2) ? 'W' : 'E';
      raws.push({ o, coord: x1, start: Math.min(y1, y2), end: Math.max(y1, y2) });
    }
  }

  // Les segments de la grille compressée sont recollés quand ils se prolongent.
  const order: Orientation[] = ['N', 'E', 'S', 'W'];
  raws.sort((p, q) => order.indexOf(p.o) - order.indexOf(q.o) || p.coord - q.coord || p.start - q.start);
  const merged: Raw[] = [];
  for (const r of raws) {
    const last = merged[merged.length - 1];
    if (last && last.o === r.o && last.coord === r.coord && last.end === r.start) last.end = r.end;
    else merged.push({ ...r });
  }

  const counts: Record<Orientation, number> = { N: 0, E: 0, S: 0, W: 0 };
  return merged.map((m): WallFace => {
    const index = counts[m.o]++;
    let a: Point;
    let b: Point;
    let inward: [number, number];
    switch (m.o) {
      case 'N':
        a = [m.start, m.coord];
        b = [m.end, m.coord];
        inward = [0, 1];
        break;
      case 'S':
        a = [m.end, m.coord];
        b = [m.start, m.coord];
        inward = [0, -1];
        break;
      case 'E':
        a = [m.coord, m.start];
        b = [m.coord, m.end];
        inward = [-1, 0];
        break;
      case 'W':
        a = [m.coord, m.end];
        b = [m.coord, m.start];
        inward = [1, 0];
        break;
    }
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return {
      key: `${m.o}${index}`,
      roomId: room.id,
      orientation: m.o,
      name: `Mur ${ORIENTATION_NAMES[m.o].toLowerCase()}`,
      a,
      b,
      length,
      dir: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
      inward,
    };
  });
}

/** Libellé d'une face : « Mur nord », avec un rang quand la pièce en a plusieurs du même côté. */
export function faceLabel(face: WallFace, all: readonly WallFace[]): string {
  const same = all.filter((f) => f.orientation === face.orientation);
  return same.length > 1 ? `${face.name} (${same.findIndex((f) => f.key === face.key) + 1})` : face.name;
}

/** Distance maximale (unités du plan) d'un appareil à un mur pour le considérer posé sur ce mur. */
export const FACE_TOLERANCE = 14;
/** Tolérance pour une ouverture : elle est centrée sur la ligne du mur. */
const OPENING_TOLERANCE = 8;

/** cm ↔ unités du plan. */
export const unitsToCm = (scale: number, units: number): number => toMeters(scale, units) * 100;
export const cmToUnits = (scale: number, cm: number): number => toUnits(scale, cm / 100);

/** Un appareil posé sur un mur : position le long du mur et hauteur, en cm. */
export interface Placement {
  item: SymbolItem;
  face: WallFace;
  /** Distance au coin de gauche, en cm. */
  u: number;
  /** Hauteur depuis le sol, en cm (pour une ouverture : hauteur d'allège). */
  v: number;
  /** Écart à la ligne du mur, en unités du plan (positif : vers l'intérieur). */
  offset: number;
  mounting: Mounting;
}

/** Coordonnées d'un point par rapport à une face : t le long du mur, s vers l'intérieur (unités du plan). */
export function faceCoords(face: WallFace, x: number, y: number): { t: number; s: number } {
  const dx = x - face.a[0];
  const dy = y - face.a[1];
  return { t: dx * face.dir[0] + dy * face.dir[1], s: dx * face.inward[0] + dy * face.inward[1] };
}

/** Point du plan situé à la position (t le long du mur, s vers l'intérieur). */
export function pointOnFace(face: WallFace, t: number, s = 0): Point {
  return [
    face.a[0] + face.dir[0] * t + face.inward[0] * s,
    face.a[1] + face.dir[1] * t + face.inward[1] * s,
  ];
}

/**
 * Appareils posés sur la face : proches de la ligne du mur (jusqu'à `FACE_TOLERANCE` vers l'intérieur)
 * et entre ses deux coins. Les appareils de plafond n'y figurent pas.
 */
export function symbolsOnFace(doc: Pick<Doc, 'items' | 'scale'>, face: WallFace): Placement[] {
  const out: Placement[] = [];
  for (const it of doc.items) {
    if (it.type !== 'symbol' || isCeilingKind(it.kind)) continue;
    const opening = isOpeningKind(it.kind);
    const { t, s } = faceCoords(face, it.x, it.y);
    const inside = opening ? Math.abs(s) <= OPENING_TOLERANCE : s >= -2 && s <= FACE_TOLERANCE;
    if (!inside || t < -2 || t > face.length + 2) continue;
    out.push({
      item: it,
      face,
      u: unitsToCm(doc.scale, t),
      v: effectiveHeight(it),
      offset: s,
      mounting: mountingOf(it.kind),
    });
  }
  return out.sort((p, q) => p.u - q.u);
}

/** Face à laquelle un appareil est posé (la plus proche), si c'est le cas. */
export function faceOfSymbol(
  doc: Pick<Doc, 'items' | 'scale'>,
  item: SymbolItem,
): { room: Room; face: WallFace } | null {
  if (isCeilingKind(item.kind)) return null;
  let best: { room: Room; face: WallFace; score: number } | null = null;
  for (const room of doc.items) {
    if (room.type !== 'room') continue;
    for (const face of roomFaces(room)) {
      const { t, s } = faceCoords(face, item.x, item.y);
      const tolerance = isOpeningKind(item.kind) ? OPENING_TOLERANCE : FACE_TOLERANCE;
      if (t < -2 || t > face.length + 2 || s < -tolerance || s > tolerance) continue;
      const score = Math.abs(s);
      if (!best || score < best.score) best = { room, face, score };
    }
  }
  return best ? { room: best.room, face: best.face } : null;
}

/** Nouvelle position plan d'un appareil déplacé à `uCm` le long de la face, en conservant son écart au mur. */
export function moveAlongFace(doc: Pick<Doc, 'scale'>, face: WallFace, item: SymbolItem, uCm: number): Point {
  const { s } = faceCoords(face, item.x, item.y);
  const clamped = Math.min(face.length, Math.max(0, cmToUnits(doc.scale, uCm)));
  return pointOnFace(face, clamped, s);
}

/** Longueur d'une face en cm. */
export const faceLengthCm = (doc: Pick<Doc, 'scale'>, face: WallFace): number => unitsToCm(doc.scale, face.length);
