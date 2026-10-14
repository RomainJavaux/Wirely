import { getSymbol, getWireType } from '../catalog';
import { toMeters } from '../plan/metrics';
import { getRoomKind } from '../plan/roomKinds';
import { outlineSegments, roomContains, roomRects } from '../plan/rooms';
import type { Doc, Point, Room, SymbolItem } from '../types';
import { faceOfSymbol, FACE_TOLERANCE, pointOnFace, faceCoords } from '../walls/faces';
import { effectiveHeight, isCeilingKind, isOpeningKind, mountingOf } from '../walls/mounting';

/**
 * Modèle 3D du logement, indépendant du moteur de rendu : des boîtes (murs, sols, vitrages), des
 * repères d'appareillage et des câbles, en mètres. La vue 3D n'a plus qu'à les transformer en objets.
 *
 * Repère : x vers l'est, y vers le haut, z vers le sud (le haut du plan est le nord).
 */

/** Épaisseur des murs (m). */
export const WALL_THICKNESS = 0.15;
/** Distance maximale (unités du plan) d'un symbole à un mur pour être posé dessus. */
const WALL_SNAP = FACE_TOLERANCE;
/** Tolérance (unités du plan) pour qu'une ouverture appartienne à un mur. */
const OPENING_SNAP = 8;

export type BoxRole = 'wall' | 'floor' | 'glass';

export interface Box3 {
  /** Centre, en mètres. */
  cx: number;
  cy: number;
  cz: number;
  /** Dimensions locales (m) : w le long du mur, h en hauteur, d en épaisseur. */
  w: number;
  h: number;
  d: number;
  /** Rotation autour de l'axe vertical (rad). */
  rotY: number;
  color: string;
  role: BoxRole;
  /** Pièce dont c'est le sol, pour la sélection. */
  roomId?: number;
}

export interface Mark3 {
  id: number;
  kind: string;
  name: string;
  label: string;
  /** Centre de la plaque, en mètres. */
  x: number;
  y: number;
  z: number;
  /** Taille de la plaque (m). */
  w: number;
  h: number;
  /** Direction vers laquelle l'objet fait face (horizontale, unitaire) ; (0, 0) hors mur. */
  nx: number;
  nz: number;
  ceiling: boolean;
  onWall: boolean;
  breaker: number | null;
  /** Couleur de la catégorie (prises, commandes, éclairage…). */
  color: string;
}

export interface Wire3 {
  id: number;
  points: [number, number, number][];
  color: string;
  breaker: number | null;
}

export interface Scene3D {
  boxes: Box3[];
  marks: Mark3[];
  wires: Wire3[];
  /** Hauteur sous plafond (m). */
  ceiling: number;
  /** Hauteur de mur utilisée (m), inférieure au plafond en mode coupe. */
  wallHeight: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface SceneOptions {
  /** Hauteur des murs en m (coupe pour voir à l'intérieur). Par défaut : le plafond. */
  wallHeight?: number;
}

/** Couleur de chaque catégorie de symboles (plaques de la vue 3D et légende). */
export const CATEGORY_COLORS: Readonly<Record<string, string>> = {
  Prises: '#d62828',
  Commandes: '#111827',
  Éclairage: '#e08a00',
  Équipements: '#0e9aa7',
  Distribution: '#7b2cbf',
  Ouvertures: '#6b7385',
};

interface Segment {
  /** Extrémités en unités du plan. */
  p: Point;
  q: Point;
}

/** Murs du plan ; à défaut, le contour des pièces (plan dessiné sans murs). */
function wallSegments(doc: Pick<Doc, 'items'>): Segment[] {
  const segs: Segment[] = [];
  const walls = doc.items.filter((i) => i.type === 'wall');
  for (const w of walls) {
    for (let i = 1; i < w.points.length; i++) segs.push({ p: w.points[i - 1] as Point, q: w.points[i] as Point });
  }
  if (walls.length === 0) {
    for (const r of doc.items) {
      if (r.type !== 'room') continue;
      for (const [x1, y1, x2, y2] of outlineSegments(roomRects(r))) segs.push({ p: [x1, y1], q: [x2, y2] });
    }
  }
  return segs;
}

interface Hole {
  /** Position le long du segment (m) du début et de la fin de l'ouverture. */
  s0: number;
  s1: number;
  sill: number;
  top: number;
  glass: boolean;
}

/** Pose un segment de mur en boîtes : les ouvertures le percent (sans CSG). */
function segmentBoxes(
  doc: Pick<Doc, 'scale' | 'items'>,
  seg: Segment,
  height: number,
  ceilingHeight: number,
): Box3[] {
  const lenUnits = Math.hypot(seg.q[0] - seg.p[0], seg.q[1] - seg.p[1]);
  if (lenUnits < 1) return [];
  const dx = (seg.q[0] - seg.p[0]) / lenUnits;
  const dz = (seg.q[1] - seg.p[1]) / lenUnits;
  const L = toMeters(doc.scale, lenUnits);

  // Ouvertures situées sur ce segment.
  const holes: Hole[] = [];
  for (const it of doc.items) {
    if (it.type !== 'symbol' || !isOpeningKind(it.kind)) continue;
    const vx = it.x - seg.p[0];
    const vz = it.y - seg.p[1];
    const t = vx * dx + vz * dz;
    const s = Math.abs(-vx * dz + vz * dx);
    if (s > OPENING_SNAP || t < 0 || t > lenUnits) continue;
    const m = mountingOf(it.kind);
    const center = toMeters(doc.scale, t);
    const half = m.w / 200;
    const sill = effectiveHeightM(it);
    holes.push({
      s0: Math.max(0, center - half),
      s1: Math.min(L, center + half),
      sill,
      top: Math.min(ceilingHeight, sill + m.h / 100),
      glass: it.kind === 'fenetre',
    });
  }
  holes.sort((a, b) => a.s0 - b.s0);

  const rotY = Math.atan2(-dz, dx);
  const px = toMeters(doc.scale, seg.p[0]);
  const pz = toMeters(doc.scale, seg.p[1]);
  const wx = toMeters(doc.scale, dx * lenUnits) / L;
  const wz = toMeters(doc.scale, dz * lenUnits) / L;

  const boxes: Box3[] = [];
  const piece = (s0: number, s1: number, y0: number, y1: number, role: BoxRole, color: string, depth = WALL_THICKNESS): void => {
    const w = s1 - s0;
    const h = Math.min(y1, height) - y0;
    if (w < 0.005 || h < 0.005) return;
    const mid = (s0 + s1) / 2;
    boxes.push({
      cx: px + wx * mid,
      cy: y0 + h / 2,
      cz: pz + wz * mid,
      w,
      h,
      d: depth,
      rotY,
      color,
      role,
    });
  };

  const WALL = '#e9edf3';
  let cursor = 0;
  for (const hole of holes) {
    if (hole.s0 > cursor) piece(cursor, hole.s0, 0, height, 'wall', WALL);
    if (hole.sill > 0) piece(hole.s0, hole.s1, 0, hole.sill, 'wall', WALL);
    if (hole.top < height) piece(hole.s0, hole.s1, hole.top, height, 'wall', WALL);
    if (hole.glass) piece(hole.s0, hole.s1, hole.sill, Math.min(hole.top, height), 'glass', '#9ec5ee', 0.03);
    cursor = Math.max(cursor, hole.s1);
  }
  if (cursor < L) piece(cursor, L, 0, height, 'wall', WALL);
  return boxes;
}

const effectiveHeightM = (s: Pick<SymbolItem, 'kind' | 'height'>): number => effectiveHeight(s) / 100;

/** Point du mur le plus proche d'un point du plan : pied de la perpendiculaire, distance et normale. */
function nearestWall(segs: Segment[], x: number, y: number): { foot: Point; dist: number; n: [number, number] } | null {
  let best: { foot: Point; dist: number; n: [number, number] } | null = null;
  for (const { p, q } of segs) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1) continue;
    const dx = (q[0] - p[0]) / len;
    const dy = (q[1] - p[1]) / len;
    const t = Math.min(len, Math.max(0, (x - p[0]) * dx + (y - p[1]) * dy));
    const foot: Point = [p[0] + dx * t, p[1] + dy * t];
    const dist = Math.hypot(x - foot[0], y - foot[1]);
    if (dist <= WALL_SNAP && (!best || dist < best.dist)) best = { foot, dist, n: [-dy, dx] };
  }
  return best;
}

/** Construit le modèle 3D du plan. */
export function buildScene3D(doc: Pick<Doc, 'items' | 'scale' | 'ceiling'>, opts: SceneOptions = {}): Scene3D {
  const ceiling = doc.ceiling / 100;
  const wallHeight = Math.min(ceiling, Math.max(0.1, opts.wallHeight ?? ceiling));
  const m = (u: number): number => toMeters(doc.scale, u);
  const rooms = doc.items.filter((i): i is Room => i.type === 'room');

  const boxes: Box3[] = [];

  // Sols
  for (const room of rooms) {
    const color = getRoomKind(room.kind).color;
    for (const r of roomRects(room)) {
      boxes.push({
        cx: m(r.x + r.w / 2),
        cy: -0.01,
        cz: m(r.y + r.h / 2),
        w: m(r.w),
        h: 0.02,
        d: m(r.h),
        rotY: 0,
        color,
        role: 'floor',
        roomId: room.id,
      });
    }
  }

  // Murs
  const segs = wallSegments(doc);
  for (const seg of segs) boxes.push(...segmentBoxes(doc, seg, wallHeight, ceiling));

  // Appareillage
  const marks: Mark3[] = [];
  for (const it of doc.items) {
    if (it.type !== 'symbol' || isOpeningKind(it.kind)) continue;
    const def = getSymbol(it.kind);
    const mount = mountingOf(it.kind);
    const color = CATEGORY_COLORS[def?.category ?? ''] ?? '#6b7385';
    const base = {
      id: it.id,
      kind: it.kind,
      name: def?.name ?? it.kind,
      label: it.label,
      w: mount.w / 100,
      h: mount.h / 100,
      breaker: it.breaker,
      color,
    };

    if (isCeilingKind(it.kind)) {
      marks.push({ ...base, x: m(it.x), y: ceiling - 0.012, z: m(it.y), nx: 0, nz: 0, ceiling: true, onWall: false });
      continue;
    }

    const y = effectiveHeightM(it);
    const wall = nearestWall(segs, it.x, it.y);
    if (wall) {
      // On pose l'objet sur la face du mur qui regarde une pièce.
      const probe = (sign: number) => roomContains2(rooms, wall.foot[0] + wall.n[0] * sign * 4, wall.foot[1] + wall.n[1] * sign * 4);
      const sign = probe(1) || !probe(-1) ? 1 : -1;
      const nx = wall.n[0] * sign;
      const nz = wall.n[1] * sign;
      const off = WALL_THICKNESS / 2 + 0.004;
      marks.push({
        ...base,
        x: m(wall.foot[0]) + nx * off,
        y,
        z: m(wall.foot[1]) + nz * off,
        nx,
        nz,
        ceiling: false,
        onWall: true,
      });
      continue;
    }

    // Pas de mur dessiné : on s'appuie sur le côté de la pièce le plus proche.
    const hit = faceOfSymbol(doc, it);
    if (hit) {
      const { t } = faceCoords(hit.face, it.x, it.y);
      const p = pointOnFace(hit.face, t, 0);
      marks.push({
        ...base,
        x: m(p[0]) + hit.face.inward[0] * 0.004,
        y,
        z: m(p[1]) + hit.face.inward[1] * 0.004,
        nx: hit.face.inward[0],
        nz: hit.face.inward[1],
        ceiling: false,
        onWall: true,
      });
      continue;
    }
    marks.push({ ...base, x: m(it.x), y, z: m(it.y), nx: 0, nz: 0, ceiling: false, onWall: false });
  }

  // Câbles : tracés au plafond, comme des goulottes
  const wires: Wire3[] = doc.items
    .filter((i) => i.type === 'wire')
    .map((w) => ({
      id: w.id,
      points: w.points.map(([x, y]): [number, number, number] => [m(x), ceiling - 0.05, m(y)]),
      color: getWireType(w.wtype).color,
      breaker: w.breaker,
    }));

  // Emprise
  const xs: number[] = [];
  const zs: number[] = [];
  for (const b of boxes) {
    xs.push(b.cx - b.w / 2, b.cx + b.w / 2);
    zs.push(b.cz - b.d / 2, b.cz + b.d / 2);
  }
  for (const k of marks) {
    xs.push(k.x);
    zs.push(k.z);
  }
  const bounds = xs.length
    ? { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
    : { minX: 0, maxX: 5, minZ: 0, maxZ: 5 };

  return { boxes, marks, wires, ceiling, wallHeight, bounds };
}

function roomContains2(rooms: readonly Room[], x: number, y: number): boolean {
  return rooms.some((r) => roomContains(r, x, y));
}
