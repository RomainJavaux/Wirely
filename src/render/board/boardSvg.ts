import { getDeviceDef, type DeviceDef } from '../../domain/board/catalog';
import { analyze, deviceWidth, type Analysis } from '../../domain/board/layout';
import type { Board, Device } from '../../domain/board/types';
import { esc } from '../../util/escape';
import { ACCENT } from '../items';
import { DEV_H, MOD_W, deviceGlyph, deviceTone } from './deviceGlyph';

/** Marges et gabarits de la face avant (unités du plan). */
export const PAD_X = 44;
const TOP = 58;
const ROW_TOP = 36;
const STRIP_H = 84;
const ROW_GAP = 30;
export const PITCH = ROW_TOP + DEV_H + STRIP_H + ROW_GAP;
const FONT = 'Arial,sans-serif';

export interface Ghost {
  row: number;
  col: number;
  width: number;
  valid: boolean;
  /** Appareil dessiné en transparence sous le curseur. */
  device?: Device;
}

export interface BoardRenderOptions {
  /** true : ajoute les zones cliquables (data-dev) de l'éditeur. */
  interactive: boolean;
  selectedId?: number | null;
  ghost?: Ghost | null;
  /** Appareil en cours de déplacement (affiché estompé à sa place d'origine). */
  dragId?: number | null;
}

export interface RenderedBoard {
  svg: string;
  width: number;
  height: number;
}

export const boardWidth = (board: Board): number => PAD_X * 2 + board.cols * MOD_W;
export const boardHeight = (board: Board): number => TOP + board.rows * PITCH - ROW_GAP + 20;
const slotX = (col: number): number => PAD_X + col * MOD_W;
const deviceTop = (row: number): number => TOP + row * PITCH + ROW_TOP;

/** Emplacement (rail, module) correspondant à un point du plan, pour un appareil de `width` modules. */
export function slotFromPoint(board: Board, x: number, y: number, width: number): { row: number; col: number } {
  const row = Math.min(board.rows - 1, Math.max(0, Math.floor((y - TOP) / PITCH)));
  const col = Math.round((x - PAD_X) / MOD_W - width / 2);
  return { row, col: Math.min(Math.max(0, board.cols - width), Math.max(0, col)) };
}

/** Coupe un texte en lignes de `maxChars` caractères, la dernière finissant par « … » si besoin. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const w = word.length > maxChars ? word.slice(0, maxChars - 1) + '…' : word;
    if (!line) line = w;
    else if ((line + ' ' + w).length <= maxChars) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1] as string;
    kept[maxLines - 1] = last.length >= maxChars ? last.slice(0, maxChars - 1) + '…' : last + '…';
    return kept;
  }
  return lines;
}

function labelStrip(device: Device, def: DeviceDef, ref: string, x: number, y: number, selected: boolean): string {
  const modules = deviceWidth(device);
  const w = modules * MOD_W - 2;
  const tone = deviceTone(device, def);
  let s =
    `<rect x="${x + 1}" y="${y}" width="${w}" height="${STRIP_H}" rx="3" fill="#fff" ` +
    `stroke="${selected ? ACCENT : '#cfd5df'}" stroke-width="${selected ? 2 : 1}"/>`;
  if (ref) {
    s +=
      `<rect x="${x + 1}" y="${y}" width="${w}" height="15" rx="3" fill="${tone}"/>` +
      `<text x="${x + 1 + w / 2}" y="${y + 11}" font-size="9.5" font-family="${FONT}" font-weight="700" text-anchor="middle" fill="#fff">${esc(ref.length > 6 ? ref.slice(0, 5) + '…' : ref)}</text>`;
  }
  const text = device.label.trim();
  if (!text) return s;
  if (modules < 3) {
    // Appareil étroit : texte vertical, sur deux colonnes si besoin.
    const lines = wrapText(text, 14, 2);
    const cx = x + 1 + w / 2;
    lines.forEach((line, i) => {
      const dx = lines.length === 1 ? 3.2 : i === 0 ? -1.5 : 8.5;
      s += `<text transform="translate(${cx + dx} ${y + STRIP_H - 6}) rotate(-90)" font-size="9" font-family="${FONT}" fill="#222">${esc(line)}</text>`;
    });
  } else {
    const chars = Math.max(4, Math.floor((w - 8) / 5.4));
    wrapText(text, chars, 3).forEach((line, i) => {
      s += `<text x="${x + 1 + w / 2}" y="${y + 29 + i * 12}" font-size="10" font-family="${FONT}" text-anchor="middle" fill="#222">${esc(line)}</text>`;
    });
    const dest = wrapText(device.dest, chars, 1)[0];
    if (dest) s += `<text x="${x + 1 + w / 2}" y="${y + STRIP_H - 7}" font-size="8.5" font-family="${FONT}" text-anchor="middle" fill="#7a8394">${esc(dest)}</text>`;
  }
  return s;
}

function combs(a: Analysis): string {
  let s = '';
  for (const g of a.groups) {
    const head = g.head;
    if (!head) continue;
    const last = [head, ...g.members].reduce((m, d) => Math.max(m, d.col + deviceWidth(d)), 0);
    const x0 = slotX(head.col) + 1;
    const x1 = slotX(last) - 1;
    const y = deviceTop(head.row) - 10;
    const info = [a.refs.get(head.id), head.rating !== null ? `${head.rating} A` : '', head.sensitivity !== null ? `${head.sensitivity} mA` : '', head.diffType ? `type ${head.diffType}` : '']
      .filter(Boolean)
      .join(' · ');
    s += `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="5" rx="2.5" fill="#1d6fd6" opacity=".9"/>`;
    const maxChars = Math.floor((x1 - x0) / 5);
    s += `<text x="${x0}" y="${y - 5}" font-size="9" font-family="${FONT}" font-weight="700" fill="#1d6fd6">${esc(info.length > maxChars ? info.slice(0, Math.max(0, maxChars - 1)) + '…' : info)}</text>`;
  }
  return s;
}

/** Face avant d'un tableau : enclos, rails, appareils, peignes par groupe et étiquettes. */
export function renderBoard(board: Board, opts: BoardRenderOptions): RenderedBoard {
  const width = boardWidth(board);
  const height = boardHeight(board);
  const a = analyze(board);
  const supply = board.supply === 'tri' ? 'Triphasé 400 V' : 'Monophasé 230 V';

  let s =
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="12" fill="#e7ebf1" stroke="#9aa3b2" stroke-width="2"/>` +
    `<rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="8" fill="#f8f9fb" stroke="#d2d8e2"/>` +
    `<text x="${PAD_X}" y="38" font-size="16" font-weight="700" font-family="${FONT}" fill="#1f2430">${esc(board.name)}${board.location ? ` — ${esc(board.location)}` : ''}</text>` +
    `<text x="${width - PAD_X}" y="38" font-size="11" font-family="${FONT}" text-anchor="end" fill="#6b7385">${supply} · ${board.cols * board.rows} modules</text>`;

  for (let row = 0; row < board.rows; row++) {
    const top = deviceTop(row);
    const mid = top + DEV_H / 2;
    const railX = PAD_X - 14;
    const railW = board.cols * MOD_W + 28;
    s += `<text transform="translate(26 ${mid}) rotate(-90)" font-size="9" font-family="${FONT}" text-anchor="middle" fill="#9aa3b2">Rail ${row + 1}</text>`;
    s += `<rect x="${railX}" y="${mid - 7}" width="${railW}" height="14" rx="2" fill="#cdd2db" stroke="#a9b1be"/>`;
    s += `<line x1="${railX + 6}" y1="${mid}" x2="${railX + railW - 6}" y2="${mid}" stroke="#8f98a8" stroke-dasharray="10 6"/>`;
    for (let c = 0; c <= board.cols; c++) {
      s += `<line x1="${slotX(c)}" y1="${top}" x2="${slotX(c)}" y2="${top + DEV_H}" stroke="#d9dee7" stroke-dasharray="2 4"/>`;
    }
    if (opts.interactive) {
      s += `<rect data-rail="${row}" x="${railX}" y="${top - ROW_TOP + 6}" width="${railW}" height="${ROW_TOP + DEV_H + STRIP_H}" fill="transparent"/>`;
    }
  }

  s += combs(a);

  for (const d of board.devices) {
    const def = getDeviceDef(d.kind);
    if (!def) continue;
    const x = slotX(d.col);
    const y = deviceTop(d.row);
    const selected = opts.interactive && d.id === opts.selectedId;
    const dragging = opts.dragId === d.id;
    const attr = opts.interactive ? ` data-dev="${d.id}" style="cursor:grab"` : '';
    s += `<g${attr}${dragging ? ' opacity=".3"' : ''}><g transform="translate(${x} ${y})">${deviceGlyph(d, def)}</g>`;
    if (def.id !== 'vide') s += labelStrip(d, def, a.refs.get(d.id) ?? '', x, y + DEV_H + 6, selected);
    if (selected) {
      const w = deviceWidth(d) * MOD_W;
      s += `<rect x="${x - 1}" y="${y - 2}" width="${w}" height="${DEV_H + 4}" rx="5" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>`;
    }
    s += `</g>`;
  }

  const g = opts.ghost;
  if (g) {
    const x = slotX(g.col);
    const y = deviceTop(g.row);
    const color = g.valid ? '#16a34a' : '#dc2626';
    const def = g.device ? getDeviceDef(g.device.kind) : undefined;
    s += `<g pointer-events="none">`;
    if (g.device && def) s += `<g transform="translate(${x} ${y})" opacity=".7">${deviceGlyph(g.device, def)}</g>`;
    s += `<rect x="${x}" y="${y - 3}" width="${g.width * MOD_W}" height="${DEV_H + 6}" rx="5" fill="${color}" fill-opacity=".12" stroke="${color}" stroke-width="2.5"/>`;
    s += `</g>`;
  }

  return { svg: s, width, height };
}
