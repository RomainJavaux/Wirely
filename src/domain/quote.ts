import { analyze } from './board/layout';
import { getDeviceDef } from './board/catalog';
import { allPoints, pointTypes, typeOf } from './points';
import { rulesOf } from './rules';
import type { Country, Doc } from './types';

/**
 * Devis au point : chaque type de point a un prix unitaire, le tableau se chiffre au circuit.
 * Les prix par défaut sont des exemples à remplacer par les siens ; ils sont enregistrés dans le
 * chantier.
 */

export interface QuoteLine {
  /** Clé du prix (type de point, ou « circuit », « rcd », « board », « control »). */
  key: string;
  label: string;
  qty: number;
  unit: number;
  total: number;
  group: 'points' | 'tableau' | 'forfaits';
}

export interface Quote {
  lines: QuoteLine[];
  subtotal: number;
  vatRate: number;
  vat: number;
  total: number;
}

/** Prix d'exemple, hors taxes, en euros. */
const BASE_PRICES: Readonly<Record<string, number>> = {
  prise: 55,
  prise2: 70,
  lampe: 60,
  applique: 60,
  spot: 45,
  inter: 50,
  va: 65,
  poussoir: 50,
  four: 95,
  plaque: 130,
  lavelinge: 95,
  sechelinge: 95,
  lavevaisselle: 95,
  hotte: 75,
  frigo: 75,
  chaudiere: 95,
  prise_s: 95,
  ce: 110,
  radia: 95,
  vmc: 110,
  vr: 90,
  rj45: 75,
  tv: 70,
  thermo: 80,
  sonnette: 70,
  fumee: 45,
  circuit: 45,
  rcd: 110,
  board: 250,
  control: 180,
};

export const defaultPrices = (_country: Country): Record<string, number> => ({ ...BASE_PRICES });

export const priceOf = (doc: Pick<Doc, 'project'>, key: string): number =>
  doc.project.prices[key] ?? BASE_PRICES[key] ?? 0;

export function buildQuote(doc: Doc): Quote {
  const rules = rulesOf(doc);
  const types = pointTypes(doc.project.country);
  const counts = new Map<string, number>();
  for (const p of allPoints(doc)) {
    const t = typeOf(p, types);
    if (t) counts.set(t.key, (counts.get(t.key) ?? 0) + 1);
  }

  const lines: QuoteLine[] = [];
  const add = (key: string, label: string, qty: number, group: QuoteLine['group']): void => {
    if (qty <= 0) return;
    const unit = priceOf(doc, key);
    lines.push({ key, label, qty, unit, total: qty * unit, group });
  };

  for (const t of types) add(t.key, t.label, counts.get(t.key) ?? 0, 'points');

  let circuits = 0;
  let rcds = 0;
  for (const b of doc.boards) {
    circuits += analyze(b).circuits.length;
    rcds += b.devices.filter((d) => getDeviceDef(d.kind)?.role === 'rcd').length;
  }
  add('circuit', 'Circuit au tableau (disjoncteur posé, raccordé, repéré)', circuits, 'tableau');
  add('rcd', 'Différentiel', rcds, 'tableau');
  add('board', 'Coffret, peignes et mise en œuvre', doc.boards.length, 'tableau');
  if (lines.length > 0) {
    add('control', rules.country === 'BE' ? 'Schémas et contrôle par un organisme agréé' : 'Schémas et attestation de conformité', 1, 'forfaits');
  }

  const subtotal = lines.reduce((t, l) => t + l.total, 0);
  const vatRate = doc.project.vat;
  const vat = (subtotal * vatRate) / 100;
  return { lines, subtotal, vatRate, vat, total: subtotal + vat };
}

/** « 1 234,50 € » */
export const fmtMoney = (n: number): string =>
  `${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
