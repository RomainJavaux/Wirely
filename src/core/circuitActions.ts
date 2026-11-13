import { getDeviceDef, guessUsage } from '../domain/board/catalog';
import { analyze, appendToGroup, createDevice, lastUsedRow } from '../domain/board/layout';
import type { Board, Device, DiffType, UsageId } from '../domain/board/types';
import { tableauSymbols } from '../domain/link/links';
import { roomAt, roomsOf } from '../domain/plan/metrics';
import { getRoomKind } from '../domain/plan/roomKinds';
import { rulesOf, sectionFor, type RuleSet } from '../domain/rules';
import type { Store } from './store';

/**
 * Actions sur les circuits, pensées pour la liste (saisie rapide au pouce) : ajouter un circuit
 * d'un geste, ajouter un différentiel, partir du tableau type du pays. L'implantation sur les rails
 * est tenue à jour automatiquement.
 */

/** Usage supposé d'un circuit d'après son calibre, selon les habitudes du pays. */
function usageForRating(rules: RuleSet, rating: number): UsageId {
  if (rules.country !== 'BE') return guessUsage(rating);
  if (rating <= 16) return 'eclairage';
  if (rating <= 20) return 'prises';
  return 'special';
}

/**
 * Tableau actif, créé s'il n'y en a pas (vide, à la largeur usuelle du pays). Le symbole « tableau »
 * du plan, s'il existe et n'est pas lié, le représente. Ne valide pas l'historique.
 */
export function ensureBoard(store: Store): Board {
  const existing = store.activeBoard ?? store.state.doc.boards[0];
  if (existing) {
    store.state.boardId = existing.id;
    return existing;
  }
  const { doc } = store.state;
  const rules = rulesOf(doc);
  const board: Board = {
    id: doc.nextId++,
    name: 'Tableau principal',
    location: '',
    supply: 'mono',
    cols: rules.boardCols,
    rows: 1,
    devices: [],
  };
  const symbol = tableauSymbols(doc).find((s) => s.board === null);
  if (symbol) {
    doc.items = doc.items.map((i) => (i.id === symbol.id && i.type === 'symbol' ? { ...i, board: board.id } : i));
    const room = roomAt(roomsOf(doc.items), symbol.x, symbol.y);
    if (room) board.location = room.label.trim() || getRoomKind(room.kind).name;
  }
  doc.boards.push(board);
  store.state.boardId = board.id;
  store.state.deviceSelection = null;
  return board;
}

function replaceBoard(store: Store, board: Board): void {
  const { doc } = store.state;
  doc.boards = doc.boards.map((b) => (b.id === board.id ? board : b));
}

export interface NewCircuit {
  rating: number;
  /** Différentiel derrière lequel placer le circuit (absent : le dernier ; null : sans différentiel). */
  headId?: number | null;
  label?: string;
}

/** Ajoute un circuit (disjoncteur) à la fin du groupe d'un différentiel. Retourne son identifiant. */
export function addCircuit(store: Store, opts: NewCircuit): number | null {
  const def = getDeviceDef('disj');
  if (!def) return null;
  const { doc } = store.state;
  const rules = rulesOf(doc);
  const board = ensureBoard(store);

  let headId = opts.headId;
  if (headId === undefined) {
    const heads = analyze(board).groups.filter((g) => g.head !== null);
    headId = heads[heads.length - 1]?.head?.id ?? null;
  }
  const device = createDevice(def, doc.nextId++, 0, 0, {
    rating: opts.rating,
    label: opts.label ?? '',
    usage: usageForRating(rules, opts.rating),
    section: sectionFor(rules, opts.rating),
    variant: rules.breakerVariant,
  });
  replaceBoard(store, appendToGroup(board, headId, device));
  store.state.deviceSelection = device.id;
  store.commit();
  return device.id;
}

export interface NewRcd {
  sensitivity: number;
  rating?: number;
  diffType?: DiffType;
}

/** Ajoute un différentiel, qui ouvre un nouveau rail. Retourne son identifiant. */
export function addRcd(store: Store, opts: NewRcd): number | null {
  const def = getDeviceDef('idiff');
  if (!def) return null;
  const { doc } = store.state;
  const board = ensureBoard(store);
  const row = board.devices.length === 0 ? 0 : lastUsedRow(board) + 1;
  const device = createDevice(def, doc.nextId++, row, 0, {
    sensitivity: opts.sensitivity,
    rating: opts.rating ?? 40,
    diffType: opts.diffType ?? 'A',
  });
  replaceBoard(store, { ...board, rows: Math.max(board.rows, row + 1), devices: [...board.devices, device] });
  store.state.deviceSelection = device.id;
  store.commit();
  return device.id;
}

/**
 * Tableau type du pays, prêt à recevoir des circuits. Belgique : différentiel général 300 mA
 * type A, puis différentiel 30 mA. France : deux différentiels 30 mA (type A et type AC).
 */
export function createStandardBoard(store: Store): void {
  const def = getDeviceDef('idiff');
  if (!def) return;
  const { doc } = store.state;
  const rules = rulesOf(doc);
  const board = ensureBoard(store);
  if (board.devices.length > 0) return;
  const heads: Partial<Device>[] =
    rules.country === 'BE'
      ? [
          { sensitivity: 300, rating: 40, diffType: 'A', note: 'Différentiel général' },
          { sensitivity: 30, rating: 40, diffType: 'A', note: 'Salle de bains, lave-linge, lave-vaisselle' },
        ]
      : [
          { sensitivity: 30, rating: 40, diffType: 'A', note: 'Plaque, lave-linge, circuits spécialisés' },
          { sensitivity: 30, rating: 40, diffType: 'AC', note: 'Éclairage et prises' },
        ];
  const devices = heads.map((patch, row) => createDevice(def, doc.nextId++, row, 0, patch));
  replaceBoard(store, { ...board, rows: Math.max(board.rows, devices.length), devices });
  store.commit();
}

/** Modifie un circuit ou un différentiel du tableau actif (sans valider : pour la saisie en cours). */
export function patchCircuit(store: Store, id: number, patch: Partial<Device>): void {
  const board = store.activeBoard;
  if (!board) return;
  store.updateBoard({ ...board, devices: board.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
}
