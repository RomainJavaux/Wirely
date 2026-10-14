import { USAGES } from '../domain/board/catalog';
import { bomLines, circuitRows, circuitsCsv, outputRows } from '../domain/board/bom';
import { analyze, effectiveUsage } from '../domain/board/layout';
import type { Board } from '../domain/board/types';
import type { Doc } from '../domain/types';
import { renderBoard } from '../render/board/boardSvg';
import { renderUnifilaire } from '../render/board/unifilaire';
import { esc } from '../util/escape';
import { downloadBlob, downloadPng, downloadSvg, printHtml, safeName } from './files';
import { composeSheet, sheetHtml, table, type SheetSection } from './sheet';

const FONT = 'Arial,sans-serif';

export type { SheetSection };

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

/** Découpe la fiche du tableau en sections : face avant, unifilaire, circuits, sorties, nomenclature. */
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
  if (a.groups.length > 0 || a.busModules.length > 0) {
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

const sheetHeader = (doc: Doc, board: Board, date: Date) => ({
  title: board.name,
  subtitle: [board.location, supplyLabel(board), `Projet : ${doc.name}`, date.toLocaleDateString('fr-FR')]
    .filter(Boolean)
    .join(' · '),
  sections: buildBoardSections(board),
});

/** Fiche complète en un seul SVG autonome (PNG / SVG). */
export function buildBoardSheetSvg(doc: Doc, board: Board, date = new Date()): string {
  return composeSheet(sheetHeader(doc, board, date));
}

export const exportBoardSvg = (doc: Doc, board: Board): void =>
  downloadSvg(buildBoardSheetSvg(doc, board), safeName(board.name, 'svg'));

export const exportBoardPng = (doc: Doc, board: Board): void =>
  downloadPng(buildBoardSheetSvg(doc, board), safeName(board.name, 'png'));

export const exportBoardCsv = (board: Board): void =>
  downloadBlob(new Blob([circuitsCsv(board)], { type: 'text/csv;charset=utf-8' }), safeName(`${board.name} - circuits`, 'csv'));

/** PDF : une section par bloc, sans coupure au milieu d'un tableau. */
export function exportBoardPdf(doc: Doc, board: Board): void {
  const { css, body } = sheetHtml(sheetHeader(doc, board, new Date()));
  printHtml(board.name, css, body);
}
