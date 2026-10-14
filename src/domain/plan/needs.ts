import { getRoomKind } from './roomKinds';
import { roomAt, roomStats, roomsOf } from './metrics';
import type { Doc, Room, RoomKind, SymbolItem } from '../types';

/**
 * Ce qu'une pièce demande, par type et par surface. Les minimums sont des repères indicatifs
 * inspirés de la NF C 15-100 : ils servent à proposer un équipement de départ, pas à certifier
 * une installation.
 */

export type NeedGroup = 'prises' | 'commandes' | 'eclairage' | 'specialise' | 'communication';

export interface RoomNeed {
  /** Identifiant stable : « prise », « prise_s », « lampe »… */
  id: string;
  kind: string;
  /** Libellé affiché : « Prises 16 A ». */
  label: string;
  group: NeedGroup;
  min: number;
  /** Libellé de chaque point créé, dans l'ordre (« Four », « Lave-vaisselle »…). */
  pointLabels?: string[];
  /** Les n premiers points sont posés à `worktopHeight` (au-dessus d'un plan de travail). */
  worktop?: number;
}

export const WORKTOP_HEIGHT = 110;

interface Rule {
  /** Besoins pour cette pièce, en fonction de sa surface (m²). */
  (areaM2: number): RoomNeed[];
}

const need = (id: string, kind: string, label: string, group: NeedGroup, min: number, extra: Partial<RoomNeed> = {}): RoomNeed => ({
  id,
  kind,
  label,
  group,
  min,
  ...extra,
});

const sockets = (n: number, extra: Partial<RoomNeed> = {}): RoomNeed => need('prise', 'prise', 'Prises 16 A', 'prises', n, extra);
const light = (n = 1): RoomNeed => need('lampe', 'lampe', 'Point lumineux', 'eclairage', n);
const sw = (n = 1): RoomNeed => need('inter', 'inter', 'Interrupteur', 'commandes', n);
const net = (n = 1): RoomNeed => need('rj45', 'rj45', 'Prise RJ45', 'communication', n);
const tv = (n = 1): RoomNeed => need('tv', 'tv', 'Prise TV', 'communication', n);

const RULES: Readonly<Record<RoomKind, Rule>> = {
  sejour: (a) => [sockets(Math.max(5, Math.ceil(a / 4))), light(a > 28 ? 2 : 1), sw(), net(), tv()],
  cuisine: (a) => [
    sockets(a <= 4 ? 3 : 6, a <= 4 ? {} : { worktop: 4 }),
    need('prise_s', 'prise_s', 'Prises spécialisées (20 / 32 A)', 'specialise', 3, {
      pointLabels: ['Four', 'Plaque de cuisson', 'Lave-vaisselle'],
    }),
    light(),
    sw(),
  ],
  chambre: () => [sockets(3), light(), sw(), net()],
  bureau: () => [sockets(3), light(), sw(), net(2)],
  sdb: () => [sockets(2), light(), need('applique', 'applique', 'Applique miroir', 'eclairage', 1), sw()],
  wc: () => [light(), sw()],
  entree: () => [sockets(1), light(), sw()],
  couloir: (a) => [sockets(1), light(a > 12 ? 2 : 1), sw()],
  garage: () => [sockets(1), light(), sw()],
  cave: () => [sockets(1), light(), sw()],
  exterieur: () => [sockets(1), light()],
  autre: () => [],
};

export const needsFor = (kind: RoomKind, areaM2: number): RoomNeed[] => (RULES[kind] ?? RULES.autre)(areaM2);

export interface NeedStatus extends RoomNeed {
  have: number;
  missing: number;
}

export interface RoomNeedsReport {
  room: Room;
  name: string;
  areaM2: number;
  needs: NeedStatus[];
  /** Nombre de points manquants (toutes lignes confondues). */
  missing: number;
  /** Nombre de points demandés par la norme. */
  required: number;
  complete: boolean;
}

/** Point du plan : à quelle pièce appartient-il (celle qui le contient, la plus petite si plusieurs) ? */
export function symbolsByRoom(doc: Pick<Doc, 'items'>): Map<number, SymbolItem[]> {
  const rooms = roomsOf(doc.items);
  const out = new Map<number, SymbolItem[]>(rooms.map((r) => [r.id, []]));
  for (const it of doc.items) {
    if (it.type !== 'symbol') continue;
    const room = roomAt(rooms, it.x, it.y);
    if (room) out.get(room.id)?.push(it);
  }
  return out;
}

/** Besoins de chaque pièce, comparés à ce qui est déjà posé. */
export function planNeeds(doc: Pick<Doc, 'items' | 'scale'>): RoomNeedsReport[] {
  const placed = symbolsByRoom(doc);
  return roomStats(doc).map((s) => {
    const kind = getRoomKind(s.room.kind);
    const symbols = placed.get(s.room.id) ?? [];
    const needs = needsFor(s.room.kind, s.area).map((n): NeedStatus => {
      const have = symbols.filter((x) => x.kind === n.kind).length;
      return { ...n, have, missing: Math.max(0, n.min - have) };
    });
    const missing = needs.reduce((t, n) => t + n.missing, 0);
    const required = needs.reduce((t, n) => t + n.min, 0);
    return {
      room: s.room,
      name: s.room.label.trim() || kind.name,
      areaM2: s.area,
      needs,
      missing,
      required,
      complete: missing === 0,
    };
  });
}

/** Rapport d'une seule pièce. */
export const roomNeeds = (doc: Pick<Doc, 'items' | 'scale'>, roomId: number): RoomNeedsReport | undefined =>
  planNeeds(doc).find((r) => r.room.id === roomId);

/** Vrai si le plan possède déjà un détecteur de fumée. */
export const hasSmokeDetector = (doc: Pick<Doc, 'items'>): boolean =>
  doc.items.some((i) => i.type === 'symbol' && i.kind === 'fumee');
