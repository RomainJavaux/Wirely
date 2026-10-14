import { getDeviceDef } from './catalog';
import { createDevice, lastUsedRow } from './layout';
import type { Board, DiffType, UsageId } from './types';

/**
 * Saisie rapide d'un tableau au clavier : une ligne par appareil, sans souris.
 *
 *   ID 40 A type A
 *   32 Plaque de cuisson @ Cuisine
 *   20 Lave-linge
 *   ID 25 AC
 *   10 Éclairage
 *   16 Prises chambres
 *
 * « ID » ouvre un nouveau rail avec son différentiel ; les autres lignes sont des disjoncteurs
 * (calibre, désignation, « @ destination » facultatif).
 */

export interface QuickLine {
  kind: 'rcd' | 'breaker';
  rating: number | null;
  label: string;
  dest: string;
  diffType: DiffType | null;
  usage: UsageId | null;
}

export interface QuickParse {
  lines: QuickLine[];
  /** Lignes non comprises : numéro de ligne (à partir de 1) et texte. */
  errors: { line: number; text: string }[];
}

const RCD = /^(?:id|diff|différentiel|differentiel|interrupteur\s+diff\w*)\b/i;
const BREAKER = /^(\d+(?:[.,]\d+)?)\s*(?:a\b|amp\w*)?\s*[-–:]*\s*(.*)$/i;

/** Usage supposé d'après la désignation (le calibre seul ne suffit pas toujours). */
export function guessUsageFromLabel(label: string): UsageId | null {
  const t = label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/chauffe.?eau|cumulus|ballon|eau chaude/.test(t)) return 'eau';
  if (/radiateur|chauffage|convecteur|seche.?serviette|clim|pac\b/.test(t)) return 'chauffage';
  if (/lave|four|plaque|cuisson|seche.?linge|congel|frigo|hotte|piscine|borne/.test(t)) return 'special';
  if (/eclairage|lumiere|luminaire|lampe|spot/.test(t)) return 'eclairage';
  if (/prise/.test(t)) return 'prises';
  if (/vmc|volet|portail|alarme|sonnette|domotique|reseau|box/.test(t)) return 'autre';
  return null;
}

export function parseQuickEntry(text: string): QuickParse {
  const lines: QuickLine[] = [];
  const errors: { line: number; text: string }[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    if (RCD.test(line)) {
      const rest = line.replace(RCD, '');
      const rating = Number(/\b(\d{2,3})\b/.exec(rest)?.[1] ?? 40);
      const type = /\b(AC|HI|F|A)\b/i.exec(rest.replace(/\b\d+\s*a\b/gi, ''))?.[1]?.toUpperCase() as DiffType | undefined;
      lines.push({ kind: 'rcd', rating, label: '', dest: '', diffType: type ?? 'A', usage: null });
      return;
    }

    const m = BREAKER.exec(line);
    if (!m) {
      errors.push({ line: i + 1, text: raw });
      return;
    }
    const rating = Number((m[1] as string).replace(',', '.'));
    if (!Number.isFinite(rating) || rating < 1 || rating > 125) {
      errors.push({ line: i + 1, text: raw });
      return;
    }
    const [labelPart, destPart] = (m[2] ?? '').split('@');
    const label = (labelPart ?? '').trim();
    lines.push({
      kind: 'breaker',
      rating,
      label,
      dest: (destPart ?? '').trim(),
      diffType: null,
      usage: guessUsageFromLabel(label),
    });
  });

  return { lines, errors };
}

const STANDARD_COLS = [13, 18, 24, 36, 48];
const colsFor = (needed: number): number => STANDARD_COLS.find((c) => c >= needed) ?? 48;

/**
 * Ajoute les lignes saisies à un tableau : chaque « ID » ouvre un rail. Sans différentiel en tête,
 * un différentiel 40 A type A est créé pour le premier groupe. Retourne le nombre de circuits créés.
 */
export function applyQuickEntry(board: Board, lines: QuickLine[], nextId: () => number): number {
  const idiff = getDeviceDef('idiff');
  const disj = getDeviceDef('disj');
  if (!idiff || !disj || lines.length === 0) return 0;

  const hasDevices = board.devices.length > 0;
  let row = hasDevices ? lastUsedRow(board) + 1 : 0;
  let col = 0;
  let railOpen = false;
  let created = 0;
  let widest = board.cols;

  const openRail = (rating: number, diffType: DiffType | null): void => {
    if (railOpen) row += 1;
    board.devices.push(
      createDevice(idiff, nextId(), row, 0, { rating, diffType: diffType ?? 'A', sensitivity: 30 }),
    );
    col = 2;
    railOpen = true;
  };

  for (const l of lines) {
    if (l.kind === 'rcd') {
      openRail(l.rating ?? 40, l.diffType);
      continue;
    }
    if (!railOpen) openRail(40, 'A');
    board.devices.push(
      createDevice(disj, nextId(), row, col, {
        rating: l.rating,
        label: l.label,
        dest: l.dest,
        usage: l.usage,
      }),
    );
    col += 1;
    created += 1;
    widest = Math.max(widest, colsFor(col));
  }

  board.rows = Math.max(board.rows, row + 1);
  board.cols = Math.max(board.cols, widest);
  return created;
}
