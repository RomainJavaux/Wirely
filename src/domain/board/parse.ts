import { getDeviceDef } from './catalog';
import { MAX_COLS, MIN_COLS } from './layout';
import type { Board, Curve, Device, DiffType, Supply, UsageId } from './types';
import { USAGES } from './catalog';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(v)));

const CURVES: readonly string[] = ['B', 'C', 'D'];
const DIFF_TYPES: readonly string[] = ['AC', 'A', 'F', 'HI'];

function parseDevice(raw: unknown): Device | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.id) || !isStr(r.kind) || !isNum(r.row) || !isNum(r.col)) return null;
  const def = getDeviceDef(r.kind);
  if (!def) return null;
  const variant = isStr(r.variant) && def.variants.some((v) => v.id === r.variant) ? r.variant : def.defaultVariant;
  return {
    id: r.id,
    kind: r.kind,
    variant,
    row: Math.max(0, Math.round(r.row)),
    col: Math.max(0, Math.round(r.col)),
    label: isStr(r.label) ? r.label : '',
    dest: isStr(r.dest) ? r.dest : '',
    outputs: Array.isArray(r.outputs) ? r.outputs.filter(isStr).slice(0, 24) : [],
    rating: numOrNull(r.rating),
    curve: isStr(r.curve) && CURVES.includes(r.curve) ? (r.curve as Curve) : null,
    sensitivity: numOrNull(r.sensitivity),
    diffType: isStr(r.diffType) && DIFF_TYPES.includes(r.diffType) ? (r.diffType as DiffType) : null,
    usage: isStr(r.usage) && r.usage in USAGES ? (r.usage as UsageId) : null,
    section: numOrNull(r.section),
    note: isStr(r.note) ? r.note : '',
  };
}

function parseBoard(raw: unknown): Board | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.id)) return null;
  const devices = Array.isArray(r.devices)
    ? r.devices.map(parseDevice).filter((d): d is Device => d !== null)
    : [];
  return {
    id: r.id,
    name: isStr(r.name) && r.name.trim() ? r.name : 'Tableau',
    location: isStr(r.location) ? r.location : '',
    supply: (r.supply === 'tri' ? 'tri' : 'mono') satisfies Supply,
    cols: isNum(r.cols) ? clamp(r.cols, MIN_COLS, MAX_COLS) : 13,
    rows: isNum(r.rows) ? clamp(r.rows, 1, 8) : 3,
    devices,
  };
}

/** Reconstruit les tableaux d'un document depuis des données non fiables. */
export function parseBoards(raw: unknown): Board[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseBoard).filter((b): b is Board => b !== null);
}
