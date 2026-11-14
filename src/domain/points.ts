import { analyze } from './board/layout';
import { isElectrical } from './link/links';
import { symbolsByRoom } from './plan/needs';
import { refSchemeOf } from './rules';
import type { Country, Doc, SymbolItem } from './types';

/**
 * Les « points » de l'électricien : ce qu'il compte pièce par pièce (une prise, un point lumineux,
 * un interrupteur, un appareil fixe). Un point est un symbole du plan ; ce module donne les types
 * proposés aux compteurs et les comptages par pièce et par circuit.
 */

export type PointGroup = 'prises' | 'eclairage' | 'commandes' | 'appareils' | 'divers';

export interface PointType {
  /** Clé stable du compteur. */
  key: string;
  /** Symbole du plan créé. */
  kind: string;
  label: string;
  /** Libellé donné au symbole (appareils fixes : « Four », « Lave-linge »…). */
  preset?: string;
  group: PointGroup;
  /** Affiché d'emblée dans les compteurs (les autres sont sous « Plus »). */
  main?: boolean;
}

const appliance = (key: string, label: string, main = false): PointType => ({
  key,
  kind: 'prise_s',
  label,
  preset: label,
  group: 'appareils',
  main,
});

const TYPES: readonly PointType[] = [
  { key: 'prise', kind: 'prise', label: 'Prise', group: 'prises', main: true },
  { key: 'prise2', kind: 'prise2', label: 'Prise double', group: 'prises', main: true },
  { key: 'prise3', kind: 'prise3', label: 'Prise triple', group: 'prises', main: true },
  { key: 'prise4', kind: 'prise4', label: 'Prise quadruple', group: 'prises', main: true },
  { key: 'lampe', kind: 'lampe', label: 'Point lumineux', group: 'eclairage', main: true },
  { key: 'applique', kind: 'applique', label: 'Applique', group: 'eclairage' },
  { key: 'spot', kind: 'spot', label: 'Spot', group: 'eclairage' },
  { key: 'inter', kind: 'inter', label: 'Interrupteur', group: 'commandes', main: true },
  { key: 'va', kind: 'va', label: 'Va-et-vient', group: 'commandes', main: true },
  { key: 'poussoir', kind: 'poussoir', label: 'Bouton-poussoir', group: 'commandes' },
  appliance('four', 'Four'),
  appliance('plaque', 'Plaque de cuisson'),
  appliance('lavelinge', 'Lave-linge'),
  appliance('sechelinge', 'Sèche-linge'),
  appliance('lavevaisselle', 'Lave-vaisselle'),
  appliance('hotte', 'Hotte'),
  appliance('frigo', 'Réfrigérateur'),
  appliance('chaudiere', 'Chaudière'),
  { key: 'ce', kind: 'ce', label: 'Chauffe-eau', group: 'appareils' },
  { key: 'radia', kind: 'radia', label: 'Radiateur', group: 'appareils' },
  { key: 'vmc', kind: 'vmc', label: 'Ventilation', group: 'appareils' },
  { key: 'vr', kind: 'vr', label: 'Volet roulant', group: 'appareils' },
  { key: 'rj45', kind: 'rj45', label: 'Prise réseau', group: 'divers' },
  { key: 'tv', kind: 'tv', label: 'Prise TV', group: 'divers' },
  { key: 'thermo', kind: 'thermo', label: 'Thermostat', group: 'divers' },
  { key: 'sonnette', kind: 'sonnette', label: 'Sonnette', group: 'divers' },
  { key: 'fumee', kind: 'fumee', label: 'Détecteur de fumée', group: 'divers' },
  // Appareil fixe sans nom convenu : compté à part, à nommer ensuite.
  { key: 'prise_s', kind: 'prise_s', label: 'Autre appareil fixe', group: 'appareils' },
];

/** Vocabulaire du pays : en Belgique on dit « taque » et « deux directions ». */
const BELGIAN: Readonly<Record<string, Partial<PointType>>> = {
  plaque: { label: 'Taque de cuisson', preset: 'Taque de cuisson' },
  va: { label: 'Deux directions' },
};

export function pointTypes(country: Country): PointType[] {
  if (country !== 'BE') return [...TYPES];
  return TYPES.map((t) => ({ ...t, ...(BELGIAN[t.key] ?? {}) }));
}

export const POINT_GROUPS: Readonly<Record<PointGroup, string>> = {
  prises: 'Prises',
  eclairage: 'Éclairage',
  commandes: 'Commandes',
  appareils: 'Appareils fixes',
  divers: 'Divers',
};

const norm = (s: string): string => s.trim().toLowerCase();

/** Libellé d'appareil fixe → clé du compteur, quel que soit le vocabulaire du pays. */
const PRESET_KEYS = new Map<string, string>();
for (const t of TYPES) if (t.preset) PRESET_KEYS.set(norm(t.preset), t.key);
for (const [key, v] of Object.entries(BELGIAN)) if (v.preset) PRESET_KEYS.set(norm(v.preset), key);

/** Type de compteur auquel appartient un symbole (null : ouverture, tableau, texte…). */
export function typeOf(item: SymbolItem, types: readonly PointType[]): PointType | null {
  const candidates = types.filter((t) => t.kind === item.kind);
  if (candidates.length <= 1) return candidates[0] ?? null;
  const key = PRESET_KEYS.get(norm(item.label));
  return candidates.find((t) => t.key === key) ?? candidates.find((t) => t.preset === undefined) ?? null;
}

export interface RoomCount {
  type: PointType;
  total: number;
  /** Nombre par circuit (identifiant du disjoncteur, ou null : sans circuit). */
  byCircuit: Map<number | null, number>;
  items: SymbolItem[];
}

/** Comptage des points d'une pièce, par type. Seuls les types présents sont retournés. */
export function roomCounts(doc: Pick<Doc, 'items' | 'project'>, roomId: number): RoomCount[] {
  const types = pointTypes(doc.project.country);
  const symbols = symbolsByRoom(doc).get(roomId) ?? [];
  const out = new Map<string, RoomCount>();
  for (const s of symbols) {
    const type = typeOf(s, types);
    if (!type) continue;
    let c = out.get(type.key);
    if (!c) {
      c = { type, total: 0, byCircuit: new Map(), items: [] };
      out.set(type.key, c);
    }
    c.total += 1;
    c.items.push(s);
    c.byCircuit.set(s.breaker, (c.byCircuit.get(s.breaker) ?? 0) + 1);
  }
  return types.map((t) => out.get(t.key)).filter((c): c is RoomCount => c !== undefined);
}

/** Points d'une pièce (symboles comptables), du plus ancien au plus récent. */
export function roomPoints(doc: Pick<Doc, 'items' | 'project'>, roomId: number): SymbolItem[] {
  const types = pointTypes(doc.project.country);
  return (symbolsByRoom(doc).get(roomId) ?? []).filter((s) => typeOf(s, types) !== null).sort((a, b) => a.id - b.id);
}

/** Tous les points du chantier. */
export function allPoints(doc: Pick<Doc, 'items' | 'project'>): SymbolItem[] {
  const types = pointTypes(doc.project.country);
  return doc.items.filter((i): i is SymbolItem => i.type === 'symbol' && typeOf(i, types) !== null);
}

/**
 * Repère de chaque point : la lettre (ou le numéro) de son circuit suivie de son rang dans le
 * circuit (« A1 », « A2 »… ou « 3.1 », « 3.2 »…). Le même repère figure sur le schéma unifilaire
 * et sur le schéma de position. Le rang suit l'ordre de saisie.
 */
export function pointRefs(doc: Pick<Doc, 'items' | 'boards' | 'project'>): Map<number, string> {
  const scheme = refSchemeOf(doc);
  const circuit = new Map<number, string>();
  for (const board of doc.boards) {
    const a = analyze(board, scheme);
    for (const d of a.circuits) circuit.set(d.id, a.refs.get(d.id) ?? '');
  }
  const rank = new Map<number, number>();
  const out = new Map<number, string>();
  const symbols = doc.items
    .filter((i): i is SymbolItem => i.type === 'symbol' && i.breaker !== null && isElectrical(i))
    .sort((a, b) => a.id - b.id);
  for (const s of symbols) {
    const ref = circuit.get(s.breaker as number);
    if (ref === undefined) continue;
    const n = (rank.get(s.breaker as number) ?? 0) + 1;
    rank.set(s.breaker as number, n);
    out.set(s.id, scheme === 'letters' ? `${ref}${n}` : `${ref}.${n}`);
  }
  return out;
}
