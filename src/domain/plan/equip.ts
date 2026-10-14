import { toUnits } from './metrics';
import { roomNeeds, hasSmokeDetector, WORKTOP_HEIGHT, type NeedStatus } from './needs';
import { largestRect, roomRects } from './rooms';
import type { Doc, Item, NewItem, Room, RoomKind, SymbolItem } from '../types';
import { faceLengthCm, roomFaces, symbolsOnFace, type WallFace } from '../walls/faces';
import { mountingOf } from '../walls/mounting';
import { placeOnFace, STEP_CM } from '../walls/snap';

/**
 * Équipement automatique : propose, pour une pièce, les appareils qui lui manquent, déjà posés sur
 * ses murs à une position et une hauteur raisonnables. Le résultat est un point de départ à ajuster,
 * pas une étude : tout reste déplaçable (plan, murs, 3D).
 */

/** Distance minimale d'un appareil à un coin (cm). */
const CORNER_MARGIN = 25;
/** Jeu laissé autour d'une porte (cm) et entre deux appareils (cm). */
const DOOR_CLEAR = 12;
const DEVICE_CLEAR = 20;
/** Écart d'un interrupteur au chambranle de la porte (cm). */
const SWITCH_FROM_DOOR = 22;

type Work = Pick<Doc, 'items' | 'scale'>;

export interface EquipResult {
  items: NewItem[];
  /** Nombre de points ajoutés par type d'appareil. */
  byKind: Record<string, number>;
  /** Points demandés mais sans emplacement disponible (murs saturés). */
  unplaced: number;
}

const symbol = (kind: string, x: number, y: number, rot: number, label = '', height: number | null = null): NewItem => ({
  type: 'symbol',
  kind,
  x,
  y,
  rot: rot as SymbolItem['rot'],
  label,
  breaker: null,
  board: null,
  height,
});

interface Interval {
  from: number;
  to: number;
}

function subtract(base: Interval, blocked: Interval[]): Interval[] {
  let pieces: Interval[] = [base];
  for (const b of blocked) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (b.to <= p.from || b.from >= p.to) next.push(p);
      else {
        if (b.from > p.from) next.push({ from: p.from, to: b.from });
        if (b.to < p.to) next.push({ from: b.to, to: p.to });
      }
    }
    pieces = next;
  }
  return pieces.filter((p) => p.to - p.from >= 10);
}

/** Zones occupées d'un mur à la hauteur donnée : portes, fenêtres gênantes et appareils déjà posés. */
function blockedOn(work: Work, face: WallFace, heightCm: number): Interval[] {
  const out: Interval[] = [];
  for (const p of symbolsOnFace(work, face)) {
    if (p.mounting.where === 'opening') {
      const half = p.mounting.w / 2 + DOOR_CLEAR;
      const isDoor = p.item.kind === 'porte';
      const top = p.v + p.mounting.h;
      const overlaps = heightCm + 10 > p.v && heightCm - 10 < top;
      if (isDoor || overlaps) out.push({ from: p.u - half, to: p.u + half });
    } else {
      out.push({ from: p.u - DEVICE_CLEAR, to: p.u + DEVICE_CLEAR });
    }
  }
  return out;
}

interface Seg {
  face: WallFace;
  from: number;
  to: number;
}

function freeSegments(work: Work, faces: WallFace[], heightCm: number): Seg[] {
  const segs: Seg[] = [];
  for (const face of faces) {
    const length = faceLengthCm(work, face);
    if (length < CORNER_MARGIN * 2 + 10) continue;
    for (const piece of subtract({ from: CORNER_MARGIN, to: length - CORNER_MARGIN }, blockedOn(work, face, heightCm))) {
      segs.push({ face, from: piece.from, to: piece.to });
    }
  }
  return segs;
}

/** Répartit `n` points régulièrement le long de l'ensemble des segments libres. */
function distribute(segs: Seg[], n: number): { face: WallFace; u: number }[] {
  const total = segs.reduce((t, s) => t + (s.to - s.from), 0);
  if (total <= 0 || n <= 0) return [];
  const out: { face: WallFace; u: number }[] = [];
  for (let i = 0; i < n; i++) {
    let t = (total * (i + 0.5)) / n;
    for (const s of segs) {
      const len = s.to - s.from;
      if (t <= len) {
        const u = Math.round((s.from + t) / STEP_CM) * STEP_CM;
        out.push({ face: s.face, u: Math.min(s.to, Math.max(s.from, u)) });
        break;
      }
      t -= len;
    }
  }
  return out;
}

/** Positions des interrupteurs : à côté de la porte (côté dégagé), sinon près d'un coin du plus long mur. */
function switchSlots(work: Work, faces: WallFace[], n: number): { face: WallFace; u: number }[] {
  const heightCm = mountingOf('inter').height;
  const doors: { face: WallFace; u: number; w: number }[] = [];
  for (const face of faces) {
    for (const p of symbolsOnFace(work, face)) {
      if (p.item.kind === 'porte') doors.push({ face, u: p.u, w: p.mounting.w });
    }
  }
  const out: { face: WallFace; u: number }[] = [];
  const taken: { face: WallFace; u: number }[] = [];

  const free = (face: WallFace, u: number): boolean => {
    const length = faceLengthCm(work, face);
    if (u < CORNER_MARGIN || u > length - CORNER_MARGIN) return false;
    if (blockedOn(work, face, heightCm).some((b) => u > b.from && u < b.to)) return false;
    return !taken.some((t) => t.face.key === face.key && Math.abs(t.u - u) < 10);
  };

  for (let i = 0; i < n; i++) {
    const door = doors[0];
    if (door) {
      const length = faceLengthCm(work, door.face);
      const side = [door.u + door.w / 2 + SWITCH_FROM_DOOR, door.u - door.w / 2 - SWITCH_FROM_DOOR];
      // Côté le plus dégagé (le plus loin du coin) en premier.
      side.sort((a, b) => Math.min(length - b, b) - Math.min(length - a, a));
      const stepOut = (door.w / 2 + SWITCH_FROM_DOOR) + 12 * out.filter((o) => o.face.key === door.face.key).length;
      const candidates = [door.u + stepOut, door.u - stepOut, ...side].map((u) => Math.round(u / STEP_CM) * STEP_CM);
      const pick = candidates.find((u) => free(door.face, u));
      if (pick !== undefined) {
        out.push({ face: door.face, u: pick });
        taken.push({ face: door.face, u: pick });
        continue;
      }
    }
    const longest = [...faces].sort((a, b) => b.length - a.length)[0];
    if (!longest) break;
    const u = CORNER_MARGIN + 10 + 12 * i;
    if (free(longest, u)) {
      out.push({ face: longest, u });
      taken.push({ face: longest, u });
    }
  }
  return out;
}

/** Positions de points de plafond (unités du plan), alignés sur le grand axe du plus grand rectangle. */
function ceilingSlots(room: Room, n: number): [number, number][] {
  const r = largestRect(roomRects(room));
  const horizontal = r.w >= r.h;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    out.push(horizontal ? [Math.round(r.x + r.w * f), Math.round(r.y + r.h / 2)] : [Math.round(r.x + r.w / 2), Math.round(r.y + r.h * f)]);
  }
  return out;
}

const usedLabels = (items: readonly Item[], ids: ReadonlySet<number>, kind: string): Set<string> =>
  new Set(
    items
      .filter((i): i is SymbolItem => i.type === 'symbol' && i.kind === kind && ids.has(i.id) && i.label.trim() !== '')
      .map((i) => i.label.trim().toLowerCase()),
  );

class Equipper {
  readonly out: NewItem[] = [];
  readonly byKind: Record<string, number> = {};
  unplaced = 0;
  private temp = 0;
  readonly work: { items: Item[]; scale: number };

  constructor(doc: Work) {
    this.work = { items: [...doc.items], scale: doc.scale };
  }

  private add(item: NewItem): void {
    this.out.push(item);
    this.work.items.push({ ...item, id: --this.temp } as Item);
    if (item.type === 'symbol') this.byKind[item.kind] = (this.byKind[item.kind] ?? 0) + 1;
  }

  /** Pose un appareil de mur à `u` cm du coin gauche de `face`. */
  private onWall(face: WallFace, u: number, kind: string, label: string, height: number | null): void {
    const p = placeOnFace(this.work, face, u, kind);
    this.add(symbol(kind, p.x, p.y, p.rot, label, height));
  }

  /** Comble les manques d'une pièce, besoin par besoin. */
  room(room: Room, needs: readonly NeedStatus[], roomSymbolIds: ReadonlySet<number>): void {
    const faces = roomFaces(room);
    for (const n of needs) {
      if (n.missing > 0) this.fill(room, faces, n, n.missing, roomSymbolIds);
    }
  }

  private fill(room: Room, faces: WallFace[], n: NeedStatus, count: number, ids: ReadonlySet<number>): void {
    const mount = mountingOf(n.kind);
    const labels = (n.pointLabels ?? []).filter((l) => !usedLabels(this.work.items, ids, n.kind).has(l.toLowerCase()));

    if (mount.where === 'ceiling') {
      ceilingSlots(room, count).forEach(([x, y], i) => {
        this.add(symbol(n.kind, x, y, 0, labels[i] ?? ''));
      });
      return;
    }

    if (n.group === 'commandes') {
      const slots = switchSlots(this.work, faces, count);
      slots.forEach((s, i) => this.onWall(s.face, s.u, n.kind, labels[i] ?? '', null));
      this.unplaced += count - slots.length;
      return;
    }

    // Appareils de mur : deux passes quand une partie est posée en plan de travail.
    const worktop = Math.min(n.worktop ?? 0, count);
    const groups: { count: number; height: number | null }[] = [];
    if (worktop > 0) groups.push({ count: worktop, height: WORKTOP_HEIGHT });
    if (count - worktop > 0) groups.push({ count: count - worktop, height: null });

    let labelIndex = 0;
    for (const g of groups) {
      const heightCm = g.height ?? mount.height;
      const slots = distribute(freeSegments(this.work, faces, heightCm), g.count);
      for (const s of slots) {
        this.onWall(s.face, s.u, n.kind, labels[labelIndex++] ?? '', g.height);
      }
      this.unplaced += g.count - slots.length;
    }
  }
}

/**
 * Équipe les pièces demandées (dans l'ordre), en tenant compte de ce qui est déjà posé.
 * `only` limite l'ajout à un type d'appareil (« + 1 prise » dans une pièce).
 */
export function equipRooms(doc: Work, roomIds: readonly number[], only?: string): EquipResult {
  const eq = new Equipper(doc);
  const rooms = doc.items.filter((i): i is Room => i.type === 'room');

  for (const id of roomIds) {
    const room = rooms.find((r) => r.id === id);
    if (!room) continue;
    const report = roomNeeds(eq.work, id);
    if (!report) continue;
    // Symboles déjà dans la pièce : sert à ne pas redonner un libellé déjà utilisé.
    const ids = new Set(
      eq.work.items
        .filter((i): i is SymbolItem => i.type === 'symbol' && containsPoint(room, i.x, i.y))
        .map((i) => i.id),
    );
    eq.room(room, only ? report.needs.filter((n) => n.kind === only) : report.needs, ids);
  }
  return { items: eq.out, byKind: eq.byKind, unplaced: eq.unplaced };
}

function containsPoint(room: Room, x: number, y: number): boolean {
  return roomRects(room).some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
}

/** Pièces dont l'équipement est incomplet (ou toutes, si `all`). */
export function incompleteRooms(doc: Work): number[] {
  const rooms = doc.items.filter((i): i is Room => i.type === 'room');
  return rooms
    .filter((r) => {
      const report = roomNeeds(doc, r.id);
      return report !== undefined && report.missing > 0;
    })
    .map((r) => r.id);
}

/** Ordre de préférence pour poser le détecteur de fumée et le tableau (pièces de circulation d'abord). */
const CIRCULATION: RoomKind[] = ['couloir', 'entree', 'sejour'];
const BOARD_ROOMS: RoomKind[] = ['entree', 'couloir', 'garage', 'cave', 'sejour', 'cuisine'];

/**
 * Équipement de toute la maison : les pièces incomplètes, un détecteur de fumée s'il n'y en a pas
 * et un tableau s'il n'y en a pas non plus.
 */
export function equipPlan(doc: Work & Partial<Pick<Doc, 'boards'>>): EquipResult {
  const result = equipRooms(doc, incompleteRooms(doc));
  const rooms = doc.items.filter((i): i is Room => i.type === 'room');
  const extra: NewItem[] = [];

  const work: { items: Item[]; scale: number } = {
    items: [...doc.items, ...result.items.map((it, i) => ({ ...it, id: -(i + 1000) }) as Item)],
    scale: doc.scale,
  };

  if (!hasSmokeDetector(work)) {
    const room = pickRoom(rooms, CIRCULATION);
    if (room) {
      const r = largestRect(roomRects(room));
      // À côté du point lumineux, au centre de la pièce.
      const dx = Math.min(r.w / 4, toUnits(doc.scale, 0.6));
      extra.push(symbol('fumee', Math.round(r.x + r.w / 2 + dx), Math.round(r.y + r.h / 2), 0));
    }
  }

  const hasBoard = work.items.some((i) => i.type === 'symbol' && i.kind === 'tableau');
  if (!hasBoard) {
    const room = pickRoom(rooms, BOARD_ROOMS);
    if (room) {
      const faces = roomFaces(room);
      const heightCm = mountingOf('tableau').height;
      const slots = distribute(freeSegments(work, faces, heightCm), 1);
      const s = slots[0];
      if (s) {
        const p = placeOnFace(work, s.face, s.u, 'tableau');
        extra.push(symbol('tableau', p.x, p.y, p.rot));
      }
    }
  }

  const byKind = { ...result.byKind };
  for (const it of extra) if (it.type === 'symbol') byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
  return { items: [...result.items, ...extra], byKind, unplaced: result.unplaced };
}

function pickRoom(rooms: readonly Room[], order: readonly RoomKind[]): Room | undefined {
  for (const kind of order) {
    const r = rooms.find((x) => x.kind === kind);
    if (r) return r;
  }
  return rooms[0];
}

/** Noms au singulier et au pluriel, pour les messages (« 6 prises 16 A, 2 points lumineux… »). */
const COUNT_NAMES: Readonly<Record<string, [string, string]>> = {
  prise: ['prise 16 A', 'prises 16 A'],
  prise_s: ['prise spécialisée', 'prises spécialisées'],
  rj45: ['prise RJ45', 'prises RJ45'],
  tv: ['prise TV', 'prises TV'],
  lampe: ['point lumineux', 'points lumineux'],
  inter: ['interrupteur', 'interrupteurs'],
  applique: ['applique', 'appliques'],
  fumee: ['détecteur de fumée', 'détecteurs de fumée'],
  tableau: ['tableau', 'tableaux'],
};

/**
 * Libellé court d'un résultat : « 6 prises 16 A, 2 points lumineux, 1 interrupteur ».
 * `fallback` donne le nom d'un type inconnu du tableau ci-dessus.
 */
export function describeEquip(byKind: Record<string, number>, fallback: (kind: string) => string): string {
  return Object.entries(byKind)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => {
      const names = COUNT_NAMES[kind];
      const label = names ? names[n > 1 ? 1 : 0] : fallback(kind).toLowerCase();
      return `${n} ${label}`;
    })
    .join(', ');
}
