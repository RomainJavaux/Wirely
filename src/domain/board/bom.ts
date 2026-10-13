import { USAGES, getDeviceDef } from './catalog';
import { analyze, deviceWidth, effectiveSection, effectiveUsage, variantOf } from './layout';
import type { Board, Device } from './types';

export const fmtSection = (s: number): string => `${String(s).replace('.', ',')} mm²`;

/** Caractéristiques lisibles d'un appareil : « 1P+N · C16 », « 2P · 40 A · 30 mA · type A »… */
export function deviceSpec(d: Device): string {
  const def = getDeviceDef(d.kind);
  if (!def) return d.kind;
  const parts: string[] = [];
  if (def.id !== 'vide' || d.variant !== '1') parts.push(variantOf(d).label);
  if (def.curves && d.curve && d.rating !== null) parts.push(`${d.curve}${d.rating}`);
  else if (d.rating !== null) parts.push(`${d.rating} A`);
  if (def.sensitivities && d.sensitivity !== null) parts.push(`${d.sensitivity} mA`);
  if (def.diffTypes && d.diffType) parts.push(`type ${d.diffType}`);
  return parts.join(' · ');
}

export const deviceName = (d: Device): string => getDeviceDef(d.kind)?.name ?? d.kind;

export interface BomLine {
  name: string;
  spec: string;
  qty: number;
  /** Modules occupés au total par cette ligne. */
  modules: number;
}

/** Nomenclature : appareils regroupés par référence identique. */
export function bomLines(board: Board): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const d of board.devices) {
    const name = deviceName(d);
    const spec = deviceSpec(d);
    const key = `${d.kind}|${spec}`;
    const line = lines.get(key) ?? { name, spec, qty: 0, modules: 0 };
    line.qty += 1;
    line.modules += deviceWidth(d);
    lines.set(key, line);
  }
  return [...lines.values()];
}

export interface CircuitRow {
  ref: string;
  label: string;
  dest: string;
  device: string;
  protection: string;
  rcd: string;
  section: string;
  usage: string;
  note: string;
}

/** Tableau de repérage des circuits (un par disjoncteur / disjoncteur différentiel). */
export function circuitRows(board: Board): CircuitRow[] {
  const a = analyze(board);
  return a.circuits.map((d) => {
    const rcd = a.protectedBy.get(d.id) ?? null;
    const section = effectiveSection(d);
    return {
      ref: a.refs.get(d.id) ?? '',
      label: d.label,
      dest: d.dest,
      device: deviceName(d),
      protection: deviceSpec(d),
      rcd: rcd ? (rcd.id === d.id ? 'intégré' : `${a.refs.get(rcd.id)} · ${deviceSpec(rcd)}`) : '—',
      section: section === null ? '' : fmtSection(section),
      usage: USAGES[effectiveUsage(d)].name,
      note: d.note,
    };
  });
}

const csvCell = (v: string): string => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV (séparateur « ; », UTF-8 avec BOM) ouvrable directement dans Excel. */
export function circuitsCsv(board: Board): string {
  const head = ['Repère', 'Désignation', 'Destination', 'Appareil', 'Protection', 'Différentiel amont', 'Section', 'Usage', 'Remarque'];
  const rows = circuitRows(board).map((r) =>
    [r.ref, r.label, r.dest, r.device, r.protection, r.rcd, r.section, r.usage, r.note].map(csvCell).join(';'),
  );
  return '﻿' + [head.join(';'), ...rows].join('\r\n') + '\r\n';
}
