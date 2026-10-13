import { USAGES } from '../domain/board/catalog';
import { bomLines, circuitRows, circuitsCsv, outputRows } from '../domain/board/bom';
import { analyze, effectiveUsage } from '../domain/board/layout';
import type { Board } from '../domain/board/types';
import type { Doc } from '../domain/types';
import { renderBoard } from '../render/board/boardSvg';
import { renderUnifilaire } from '../render/board/unifilaire';
import { esc } from '../util/escape';
import { downloadBlob, downloadPng, downloadSvg, printHtml, safeName } from './files';

const FONT = 'Arial,sans-serif';
const MARGIN = 30;
const MIN_WIDTH = 900;
const ROW_H = 22;

export interface SheetSection {
  title: string;
  svg: string;
  width: number;
  height: number;
}

interface Column<T> {
  title: string;
  /** Part de la largeur du tableau. */
  frac: number;
  get(row: T): string;
}

const cut = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s);

/** Tableau SVG simple : en-tête grisé, lignes zébrées, textes tronqués à la largeur de colonne. */
function table<T>(width: number, columns: Column<T>[], rows: T[]): { svg: string; height: number } {
  const total = columns.reduce((s, c) => s + c.frac, 0);
  const widths = columns.map((c) => (c.frac / total) * width);
  let s = `<rect x="0" y="0" width="${width}" height="${ROW_H + 2}" fill="#e8ecf2"/>`;
  let x = 0;
  columns.forEach((c, i) => {
    s += `<text x="${x + 6}" y="16" font-size="11" font-weight="700" font-family="${FONT}" fill="#1f2430">${esc(c.title)}</text>`;
    x += widths[i] as number;
  });
  rows.forEach((row, r) => {
    const y = ROW_H + 2 + r * ROW_H;
    if (r % 2 === 1) s += `<rect x="0" y="${y}" width="${width}" height="${ROW_H}" fill="#f6f8fb"/>`;
    let cx = 0;
    columns.forEach((c, i) => {
      const w = widths[i] as number;
      s += `<text x="${cx + 6}" y="${y + 15}" font-size="10.5" font-family="${FONT}" fill="#222">${esc(cut(c.get(row), Math.floor((w - 10) / 5.6)))}</text>`;
      cx += w;
    });
  });
  const height = ROW_H + 2 + rows.length * ROW_H;
  s += `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#c4cbd6"/>`;
  return { svg: s, height };
}

function usageLegend(board: Board): string {
  const used = [...new Set(analyze(board).circuits.map((d) => effectiveUsage(d)))];
  let x = 0;
  return used
    .map((u) => {
      const def = USAGES[u];
      const item = `<rect x="${x}" y="0" width="14" height="14" rx="3" fill="${def.color}"/><text x="${x + 20}" y="11" font-size="11" font-family="${FONT}" fill="#222">${esc(def.name)}</text>`;
      x += 20 + def.name.length * 6 + 18;
      return item;
    })
    .join('');
}

/** Découpe la fiche du tableau en sections : face avant, unifilaire, circuits, nomenclature. */
export function buildBoardSections(board: Board): SheetSection[] {
  const sections: SheetSection[] = [];

  const front = renderBoard(board, { interactive: false });
  const legend = usageLegend(board);
  sections.push({
    title: 'Face avant',
    svg: front.svg + (legend ? `<g transform="translate(44 ${front.height + 14})">${legend}</g>` : ''),
    width: front.width,
    height: front.height + (legend ? 34 : 0),
  });

  const a = analyze(board);
  if (a.groups.length > 0) {
    const uni = renderUnifilaire(board);
    sections.push({ title: 'Schéma unifilaire', ...uni });
  }

  const circuits = circuitRows(board);
  if (circuits.length > 0) {
    const t = table(1200, [
      { title: 'Repère', frac: 0.06, get: (r) => r.ref },
      { title: 'Désignation', frac: 0.2, get: (r) => r.label },
      { title: 'Destination', frac: 0.15, get: (r) => r.dest },
      { title: 'Protection', frac: 0.15, get: (r) => `${r.device} ${r.protection}` },
      { title: 'Différentiel amont', frac: 0.17, get: (r) => r.rcd },
      { title: 'Section', frac: 0.08, get: (r) => r.section },
      { title: 'Usage', frac: 0.11, get: (r) => r.usage },
      { title: 'Remarque', frac: 0.15, get: (r) => r.note },
    ], circuits);
    sections.push({ title: 'Repérage des circuits', svg: t.svg, width: 1200, height: t.height });
  }

  const outputs = outputRows(board);
  if (outputs.length > 0) {
    const t = table(1200, [
      { title: 'Repère', frac: 0.08, get: (r) => r.ref },
      { title: 'Module', frac: 0.32, get: (r) => r.module },
      { title: 'Sortie', frac: 0.07, get: (r) => r.output },
      { title: 'Désignation', frac: 0.33, get: (r) => r.label || '—' },
      { title: 'Destination', frac: 0.2, get: (r) => r.dest },
    ], outputs);
    sections.push({ title: 'Sorties des modules de commande (bus)', svg: t.svg, width: 1200, height: t.height });
  }

  const bom = bomLines(board);
  if (bom.length > 0) {
    const t = table(1200, [
      { title: 'Désignation', frac: 0.4, get: (r) => r.name },
      { title: 'Caractéristiques', frac: 0.35, get: (r) => r.spec },
      { title: 'Qté', frac: 0.1, get: (r) => String(r.qty) },
      { title: 'Modules', frac: 0.15, get: (r) => String(r.modules) },
    ], bom);
    const total = bom.reduce((s, l) => s + l.qty, 0);
    const modules = bom.reduce((s, l) => s + l.modules, 0);
    sections.push({
      title: `Nomenclature · ${total} appareil${total > 1 ? 's' : ''}, ${modules} modules`,
      svg: t.svg,
      width: 1200,
      height: t.height,
    });
  }
  return sections;
}

const supplyLabel = (b: Board): string => (b.supply === 'tri' ? 'Triphasé 400 V' : 'Monophasé 230 V');

/** Fiche complète en un seul SVG autonome (PNG / SVG). */
export function buildBoardSheetSvg(doc: Doc, board: Board, date = new Date()): string {
  const sections = buildBoardSections(board);
  const widest = Math.max(...sections.map((s) => Math.min(s.width, 1200)));
  const width = Math.round(Math.max(MIN_WIDTH, widest + MARGIN * 2));
  const inner = width - MARGIN * 2;

  let y = MARGIN;
  let out = '';
  out += `<text x="${MARGIN}" y="${y + 20}" font-size="24" font-weight="700" font-family="${FONT}" fill="#111">${esc(board.name)}</text>`;
  const sub = [board.location, supplyLabel(board), `Projet : ${doc.name}`, date.toLocaleDateString('fr-FR')].filter(Boolean).join(' · ');
  out += `<text x="${MARGIN}" y="${y + 40}" font-size="12" font-family="${FONT}" fill="#6b7385">${esc(sub)}</text>`;
  y += 64;

  for (const sec of sections) {
    out += `<text x="${MARGIN}" y="${y + 14}" font-size="15" font-weight="700" font-family="${FONT}" fill="#1f2430">${esc(sec.title)}</text>`;
    out += `<line x1="${MARGIN}" y1="${y + 22}" x2="${width - MARGIN}" y2="${y + 22}" stroke="#cfd5df"/>`;
    y += 34;
    const scale = Math.min(1, inner / sec.width);
    const x = MARGIN + (inner - sec.width * scale) / 2;
    out += `<g transform="translate(${x} ${y}) scale(${scale})">${sec.svg}</g>`;
    y += sec.height * scale + 30;
  }
  const height = Math.round(y + MARGIN - 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="#fff"/>${out}</svg>`
  );
}

const baseName = (board: Board): string => board.name;

export const exportBoardSvg = (doc: Doc, board: Board): void =>
  downloadSvg(buildBoardSheetSvg(doc, board), safeName(baseName(board), 'svg'));

export const exportBoardPng = (doc: Doc, board: Board): void =>
  downloadPng(buildBoardSheetSvg(doc, board), safeName(baseName(board), 'png'));

export const exportBoardCsv = (board: Board): void =>
  downloadBlob(new Blob([circuitsCsv(board)], { type: 'text/csv;charset=utf-8' }), safeName(`${baseName(board)} - circuits`, 'csv'));

/** PDF : une section par bloc, sans coupure au milieu d'un tableau. */
export function exportBoardPdf(doc: Doc, board: Board): void {
  const sections = buildBoardSections(board);
  const head =
    `<header><h1>${esc(board.name)}</h1><p>${esc([board.location, supplyLabel(board), `Projet : ${doc.name}`, new Date().toLocaleDateString('fr-FR')].filter(Boolean).join(' · '))}</p></header>`;
  const body = sections
    .map(
      (s) =>
        `<section><h2>${esc(s.title)}</h2><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width} ${s.height}">${s.svg}</svg></section>`,
    )
    .join('');
  printHtml(
    board.name,
    `@page{size:A4 landscape;margin:10mm}body{margin:0;font-family:${FONT};color:#111}` +
      `h1{font-size:22px;margin:0}header p{margin:4px 0 14px;color:#6b7385;font-size:12px}` +
      `h2{font-size:14px;margin:0 0 6px;border-bottom:1px solid #cfd5df;padding-bottom:4px}` +
      `section{break-inside:avoid;margin-bottom:16px}svg{width:100%;height:auto;max-height:170mm}`,
    head + body,
  );
}
