import { getDeviceDef, guessUsage, suggestSection, type DeviceDef, type Variant } from './catalog';
import type { Board, Device, UsageId } from './types';

/** Nombre de modules par rail : bornes de la saisie libre. */
export const MIN_COLS = 4;
export const MAX_COLS = 48;
/** Nombre maximal de rails d'un tableau. */
export const MAX_ROWS = 12;

/** Repérage des circuits : lettres (A, B, C… usage belge) ou numéros (1, 2, 3…). */
export type RefScheme = 'letters' | 'numbers';

/** Repère du n-ième circuit (n à partir de 1) : « 3 » ou « C » ; au-delà de Z : AA, AB… */
export function circuitRef(n: number, scheme: RefScheme): string {
  if (scheme === 'numbers') return String(n);
  let s = '';
  let k = n;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}

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
    outputs: [],
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
  /** Modules de domotique sur bus : hors des groupes protégés par un différentiel. */
  busModules: Device[];
  totalModules: number;
  usedModules: number;
}

/**
 * Déduit la structure électrique de l'implantation, lue rail après rail, de gauche à droite : un
 * interrupteur différentiel protège les disjoncteurs qui le suivent (y compris sur les rails
 * suivants, comme avec un peigne ou un pontage) jusqu'au prochain différentiel.
 */
export function analyze(board: Board, scheme: RefScheme = 'numbers'): Analysis {
  const refs = new Map<number, string>();
  const protectedBy = new Map<number, Device | null>();
  const circuits: Device[] = [];
  const feeders: Device[] = [];
  const groups: Group[] = [];
  const busModules: Device[] = [];
  const counters = new Map<string, number>();
  let circuitNo = 0;
  let usedModules = 0;
  let current: Group | null = null;

  for (let row = 0; row < board.rows; row++) {
    for (const d of devicesInRow(board, row)) {
      const def = getDeviceDef(d.kind);
      if (!def) continue;
      usedModules += deviceWidth(d);

      if (isCircuitRole(def)) {
        refs.set(d.id, circuitRef(++circuitNo, scheme));
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
      } else if (def.system) {
        busModules.push(d);
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
  return { refs, protectedBy, circuits, feeders, groups, busModules, totalModules: board.rows * board.cols, usedModules };
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

/** Vrai pour un différentiel « général » : en tête, de sensibilité supérieure à 30 mA (300 mA en Belgique). */
export function generalRcd(board: Board): Device | null {
  const a = analyze(board);
  const first = a.groups.find((g) => g.head)?.head ?? null;
  return first && (first.sensitivity ?? 30) > 30 ? first : null;
}

/**
 * Ajoute un appareil à la fin du groupe d'un différentiel (`headId` null : à la fin du tableau).
 * S'il n'y a plus de place sur le rail, l'appareil passe au rail suivant, inséré si nécessaire.
 * Retourne le tableau modifié (les autres appareils sont décalés d'un rail si besoin).
 */
export function appendToGroup(board: Board, headId: number | null, device: Device): Board {
  const width = deviceWidth(device);
  const ordered = [...board.devices].sort((p, q) => p.row - q.row || p.col - q.col);

  // Dernier appareil du groupe, dans l'ordre de lecture.
  let last: Device | null = null;
  if (headId === null) {
    last = ordered[ordered.length - 1] ?? null;
  } else {
    let inside = false;
    for (const d of ordered) {
      const role = getDeviceDef(d.kind)?.role;
      if (d.id === headId) {
        inside = true;
        last = d;
      } else if (inside) {
        if (role === 'rcd' || role === 'feeder') break;
        last = d;
      }
    }
  }

  const cols = Math.max(board.cols, width);
  if (!last) return { ...board, cols, devices: [...board.devices, { ...device, row: 0, col: 0 }] };

  const end = last.col + deviceWidth(last);
  const sameRow = { ...board, cols };
  if (canPlace(sameRow, last.row, end, width)) {
    return { ...board, cols, devices: [...board.devices, { ...device, row: last.row, col: end }] };
  }

  // Rail suivant : libre s'il est vide, sinon on insère un rail (les suivants descendent d'un cran).
  const row = last.row + 1;
  const occupied = board.devices.some((d) => d.row === row);
  const devices = occupied ? board.devices.map((d) => (d.row >= row ? { ...d, row: d.row + 1 } : d)) : board.devices;
  const rows = Math.max(board.rows + (occupied ? 1 : 0), row + 1);
  return { ...board, cols, rows, devices: [...devices, { ...device, row, col: 0 }] };
}
