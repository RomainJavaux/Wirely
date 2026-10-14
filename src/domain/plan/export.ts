import { toCsv } from '../../util/csv';
import { WIRE_TYPES, getSymbol } from '../catalog';
import type { Doc } from '../types';
import { fmtArea, fmtLength, planSummary, roomStats } from './metrics';
import { getRoomKind } from './roomKinds';

const num = (n: number, digits = 1): string => n.toFixed(digits).replace('.', ',');

export interface RoomRow {
  name: string;
  type: string;
  width: string;
  depth: string;
  area: string;
  sockets: number;
  lights: number;
  switches: number;
  equipment: number;
  /** Pièce composée de plusieurs rectangles : les dimensions sont hors tout. */
  merged: boolean;
}

/** Une ligne par pièce : dimensions, surface et équipements, du haut vers le bas du plan. */
export function roomRows(doc: Pick<Doc, 'items' | 'scale'>): RoomRow[] {
  return roomStats(doc).map((s) => {
    const kind = getRoomKind(s.room.kind);
    return {
      name: s.room.label.trim() || kind.name,
      type: kind.name,
      width: num(s.width, 2),
      depth: num(s.depth, 2),
      area: num(s.area, 1),
      sockets: s.sockets,
      lights: s.lights,
      switches: s.switches,
      equipment: s.symbols.length,
      merged: s.merged,
    };
  });
}

export interface BomRow {
  section: 'Appareillage' | 'Câbles';
  name: string;
  category: string;
  qty: number | null;
  /** Longueur en mètres (câbles). */
  length: number | null;
}

/** Nomenclature : appareils comptés par type, câbles mesurés par type. */
export function planBomRows(doc: Pick<Doc, 'items' | 'scale'>): BomRow[] {
  const s = planSummary(doc);
  const items: BomRow[] = s.byKind
    .map((k) => {
      const def = getSymbol(k.kind);
      return { section: 'Appareillage' as const, name: def?.name ?? k.kind, category: def?.category ?? 'Autre', qty: k.count, length: null };
    })
    .sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.name.localeCompare(b.name, 'fr'));
  const wires: BomRow[] = s.wires.map((w) => ({
    section: 'Câbles' as const,
    name: WIRE_TYPES[w.type].name,
    category: 'Câbles',
    qty: null,
    length: w.length,
  }));
  return [...items, ...wires];
}

export function planRoomsCsv(doc: Pick<Doc, 'items' | 'scale'>): string {
  return toCsv(
    ['Pièce', 'Type', 'Largeur (m)', 'Profondeur (m)', 'Surface (m²)', 'Prises', 'Points lumineux', 'Commandes', 'Équipements'],
    roomRows(doc).map((r) => [r.name, r.type, r.width, r.depth, r.area, String(r.sockets), String(r.lights), String(r.switches), String(r.equipment)]),
  );
}

export function planBomCsv(doc: Pick<Doc, 'items' | 'scale'>): string {
  return toCsv(
    ['Rubrique', 'Catégorie', 'Désignation', 'Quantité', 'Longueur (m)'],
    planBomRows(doc).map((r) => [r.section, r.category, r.name, r.qty === null ? '' : String(r.qty), r.length === null ? '' : num(r.length, 1)]),
  );
}

/** Texte de synthèse pour l'en-tête de la fiche. */
export function planSubtitle(doc: Pick<Doc, 'items' | 'scale'>, date: Date): string {
  const s = planSummary(doc);
  const parts = [`Échelle : 1 carreau = ${num(doc.scale, 2)} m`];
  if (s.rooms > 0) parts.push(`${s.rooms} pièce${s.rooms > 1 ? 's' : ''}`, fmtArea(s.area));
  if (s.wireLength > 0) parts.push(`${fmtLength(s.wireLength)} de câble`);
  parts.push(date.toLocaleDateString('fr-FR'));
  return parts.join(' · ');
}
