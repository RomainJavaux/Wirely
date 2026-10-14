import type { Doc, Room, Rotation } from '../types';
import { faceCoords, faceOfSymbol, pointOnFace, roomFaces, unitsToCm, cmToUnits, type WallFace } from './faces';
import { isCeilingKind, isOpeningKind } from './mounting';

/**
 * Accrochage d'un appareil à un mur : position le long du mur, décalage vers l'intérieur et
 * orientation du pictogramme. C'est ce qui fait qu'un appareil posé « sur le plan » est aussi
 * « sur un mur » (hauteur, élévation, 3D).
 */

/** Distance maximale (unités du plan) du pointeur à un mur pour s'y accrocher. */
export const SNAP_DISTANCE = 36;
/** Décalage d'un appareil de mur vers l'intérieur : le dos du pictogramme repose sur le mur. */
export const WALL_OFFSET = 5;
/** Pas de positionnement le long d'un mur (cm). */
export const STEP_CM = 5;

/** Rotation (sens horaire) qui oriente le haut du pictogramme vers l'intérieur de la pièce. */
export function inwardRotation(inward: readonly [number, number]): Rotation {
  const [dx, dy] = inward;
  if (dy < 0) return 0; // mur sud : l'intérieur est au nord
  if (dx > 0) return 90; // mur ouest : l'intérieur est à l'est
  if (dy > 0) return 180; // mur nord : l'intérieur est au sud
  return 270; // mur est : l'intérieur est à l'ouest
}

export interface WallPlacement {
  x: number;
  y: number;
  rot: Rotation;
  room: Room;
  face: WallFace;
  /** Distance au coin gauche, en cm (arrondie au pas). */
  u: number;
}

/** Position d'un appareil à `uCm` du coin gauche d'un mur. */
export function placeOnFace(
  doc: Pick<Doc, 'scale'>,
  face: WallFace,
  uCm: number,
  kind: string,
): { x: number; y: number; rot: Rotation } {
  const lengthCm = unitsToCm(doc.scale, face.length);
  const clamped = Math.min(lengthCm, Math.max(0, Math.round(uCm / STEP_CM) * STEP_CM));
  const offset = isOpeningKind(kind) ? 0 : WALL_OFFSET;
  const [x, y] = pointOnFace(face, cmToUnits(doc.scale, clamped), offset);
  return { x, y, rot: inwardRotation(face.inward) };
}

/**
 * Mur le plus proche d'un point du plan, pour un type d'appareil donné. null si le type ne se pose
 * pas sur un mur (plafond) ou si aucun mur n'est assez proche.
 */
export function snapToWall(
  doc: Pick<Doc, 'items' | 'scale'>,
  x: number,
  y: number,
  kind: string,
  maxDistance = SNAP_DISTANCE,
): WallPlacement | null {
  if (isCeilingKind(kind)) return null;
  let best: { room: Room; face: WallFace; t: number; score: number } | null = null;

  for (const room of doc.items) {
    if (room.type !== 'room') continue;
    for (const face of roomFaces(room)) {
      const { t, s } = faceCoords(face, x, y);
      if (t < -maxDistance * 0.3 || t > face.length + maxDistance * 0.3) continue;
      // Du côté de la pièce : le pointeur est à l'intérieur (s ≥ 0). De l'autre côté (dans le mur ou
      // la pièce voisine), l'accrochage reste possible mais moins prioritaire.
      const dist = Math.abs(s);
      if (dist > maxDistance) continue;
      const score = dist + (s < 0 ? 6 : 0);
      if (!best || score < best.score) best = { room, face, t, score };
    }
  }
  if (!best) return null;

  const uCm = unitsToCm(doc.scale, Math.min(best.face.length, Math.max(0, best.t)));
  const placed = placeOnFace(doc, best.face, uCm, kind);
  const u = Math.round(Math.min(unitsToCm(doc.scale, best.face.length), Math.max(0, uCm)) / STEP_CM) * STEP_CM;
  return { ...placed, room: best.room, face: best.face, u };
}

/** Distance maximale (unités) à laquelle un appareil mal placé est ramené vers un mur. */
const ALIGN_DISTANCE = 60;

export interface Realignment {
  id: number;
  x: number;
  y: number;
  rot: Rotation;
}

/**
 * Appareils de mur qui ne sont pas posés sur un mur mais en sont proches : position et orientation
 * qui les y accrochent (la position le long du mur est conservée). Pour recaler un ancien plan.
 */
export function wallRealignments(doc: Pick<Doc, 'items' | 'scale'>): Realignment[] {
  const out: Realignment[] = [];
  for (const it of doc.items) {
    if (it.type !== 'symbol' || isCeilingKind(it.kind) || isOpeningKind(it.kind)) continue;
    if (faceOfSymbol(doc, it) !== null) continue;
    const snap = snapToWall(doc, it.x, it.y, it.kind, ALIGN_DISTANCE);
    if (snap) out.push({ id: it.id, x: snap.x, y: snap.y, rot: snap.rot });
  }
  return out;
}
