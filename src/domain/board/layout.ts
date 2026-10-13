import { getDeviceDef, guessUsage, suggestSection, type DeviceDef, type Variant } from './catalog';
import type { Board, Device, UsageId } from './types';

export const isCircuitRole = (def: DeviceDef): boolean => def.role === 'breaker' || def.role === 'rcbo';

export function variantOf(device: Device): Variant {
  const def = getDeviceDef(device.kind);
  const fallback: Variant = { id: device.variant, label: device.variant, width: 1 };
  if (!def) return fallback;
  return def.variants.find((v) => v.id === device.variant) ?? def.variants[0] ?? fallback;
}

export const deviceWidth = (device: Device): number => variantOf(device).width;

export function createDevice(def: DeviceDef, id: number, row: number, col: number, patch: Partial<Device> = {}): Device {
  return {
    id,
    kind: def.id,
    variant: def.defaultVariant,
    row,
    col,
    label: '',
    dest: '',
    rating: def.defaultRating ?? null,
    curve: def.defaultCurve ?? null,
    sensitivity: def.defaultSensitivity ?? null,
    diffType: def.defaultDiffType ?? null,
    usage: null,
    section: null,
    note: '',
    ...patch,
  };
}

export const effectiveUsage = (device: Device): UsageId => device.usage ?? guessUsage(device.rating);

/** Section de câble retenue : choisie, sinon déduite du calibre. null si l'appareil n'est pas un circuit. */
export function effectiveSection(device: Device): number | null {
  const def = getDeviceDef(device.kind);
  if (!def || !isCircuitRole(def) || device.rating === null) return null;
  return device.section ?? suggestSection(device.rating);
}

/** Vrai si un appareil de `width` modules tient en (row, col) sans en chevaucher un autre. */
export function canPlace(board: Board, row: number, col: number, width: number, ignoreId?: number): boolean {
  if (row < 0 || row >= board.rows || col < 0 || col + width > board.cols) return false;
  return !board.devices.some((d) => {
    if (d.id === ignoreId || d.row !== row) return false;
    const w = deviceWidth(d);
    return col < d.col + w && d.col < col + width;
  });
}

/** Premier emplacement libre (rail par rail, de gauche à droite). */
export function firstFreeSlot(board: Board, width: number, startRow = 0): { row: number; col: number } | null {
  for (let row = startRow; row < board.rows; row++) {
    for (let col = 0; col + width <= board.cols; col++) {
      if (canPlace(board, row, col, width)) return { row, col };
    }
  }
  return null;
}

export const devicesInRow = (board: Board, row: number): Device[] =>
  board.devices.filter((d) => d.row === row).sort((a, b) => a.col - b.col);

/** Groupe d'appareils alimentés par un même différentiel (ou sans différentiel amont). */
export interface Group {
  head: Device | null;
  members: Device[];
}

export interface Analysis {
  /** Repère affiché pour chaque appareil (1, 2, 3… pour les circuits ; ID1, KM1… sinon). */
  refs: Map<number, string>;
  /** Différentiel qui protège chaque circuit (null si aucun ; soi-même pour un disjoncteur différentiel). */
  protectedBy: Map<number, Device | null>;
  circuits: Device[];
  feeders: Device[];
  groups: Group[];
  totalModules: number;
  usedModules: number;
}

/**
 * Déduit la structure électrique de l'implantation : sur un rail, un interrupteur différentiel
 * protège les disjoncteurs situés à sa droite, jusqu'au prochain différentiel.
 */
export function analyze(board: Board): Analysis {
  const refs = new Map<number, string>();
  const protectedBy = new Map<number, Device | null>();
  const circuits: Device[] = [];
  const feeders: Device[] = [];
  const groups: Group[] = [];
  const counters = new Map<string, number>();
  let circuitNo = 0;
  let usedModules = 0;

  for (let row = 0; row < board.rows; row++) {
    let current: Group | null = null;
    for (const d of devicesInRow(board, row)) {
      const def = getDeviceDef(d.kind);
      if (!def) continue;
      usedModules += deviceWidth(d);

      if (isCircuitRole(def)) {
        refs.set(d.id, String(++circuitNo));
        circuits.push(d);
      } else if (def.refPrefix) {
        const n = (counters.get(def.refPrefix) ?? 0) + 1;
        counters.set(def.refPrefix, n);
        refs.set(d.id, `${def.refPrefix}${n}`);
      }

      if (def.role === 'feeder') {
        feeders.push(d);
        current = null;
      } else if (def.role === 'rcd') {
        current = { head: d, members: [] };
        groups.push(current);
      } else if (def.id !== 'vide') {
        if (!current) {
          current = { head: null, members: [] };
          groups.push(current);
        }
        current.members.push(d);
        if (def.role === 'breaker') protectedBy.set(d.id, current.head);
        if (def.role === 'rcbo') protectedBy.set(d.id, d);
      }
    }
  }
  return { refs, protectedBy, circuits, feeders, groups, totalModules: board.rows * board.cols, usedModules };
}

/** Aligne les appareils à gauche de chaque rail, en conservant leur ordre. */
export function compactDevices(board: Board): Device[] {
  const out: Device[] = [];
  for (let row = 0; row < board.rows; row++) {
    let col = 0;
    for (const d of devicesInRow(board, row)) {
      out.push({ ...d, col });
      col += deviceWidth(d);
    }
  }
  return out;
}

/** Plus petit nombre de modules par rail qui contient tous les appareils. */
export function minCols(board: Board): number {
  return board.devices.reduce((m, d) => Math.max(m, d.col + deviceWidth(d)), 1);
}

/** Dernier rail contenant un appareil (-1 si le tableau est vide). */
export const lastUsedRow = (board: Board): number => board.devices.reduce((m, d) => Math.max(m, d.row), -1);
