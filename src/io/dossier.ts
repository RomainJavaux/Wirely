import { runChecks } from '../domain/board/checks';
import { circuitsCsv } from '../domain/board/bom';
import type { Board } from '../domain/board/types';
import { allLinks, linksSummary, isElectrical, unlinkedItems } from '../domain/link/links';
import { planSubtitle } from '../domain/plan/export';
import { planNeeds } from '../domain/plan/needs';
import type { Doc } from '../domain/types';
import { buildPlanSections } from './exporter';
import { buildBoardSections } from './boardSheet';
import { downloadBlob, downloadPng, downloadSvg, printHtml, safeName } from './files';
import { composeSheet, sheetHtml, type SheetHeader, type SheetSection } from './sheet';

/**
 * Dossier remis à l'électricien ou au client : une seule pièce regroupant le plan, les murs
 * équipés, la liste des points, les circuits, le matériel, puis chaque tableau. L'utilisateur
 * choisit ce qu'il y met ; l'aperçu est le document exporté.
 */

export interface DossierPart {
  /** « plan:walls », « board:12:front »… */
  key: string;
  /** Regroupement dans la liste de choix. */
  group: string;
  title: string;
  section: SheetSection;
}

/** Toutes les sections disponibles pour ce projet, dans l'ordre du dossier. */
export function dossierParts(doc: Doc): DossierPart[] {
  const parts: DossierPart[] = [];
  for (const s of buildPlanSections(doc)) {
    parts.push({ key: `plan:${s.key ?? s.title}`, group: 'Plan et pièces', title: s.title, section: s });
  }
  for (const board of doc.boards) {
    for (const s of buildBoardSections(board, doc)) {
      parts.push({
        key: `board:${board.id}:${s.key ?? s.title}`,
        group: board.name,
        title: s.title,
        section: { ...s, title: `${board.name} · ${s.title}` },
      });
    }
  }
  return parts;
}

export interface DossierIssue {
  severity: 'warn' | 'info';
  text: string;
  /** Où aller le corriger. */
  fix: 'plan' | 'board';
}

/** Points à régler avant de remettre le dossier. */
export function dossierIssues(doc: Doc): DossierIssue[] {
  const out: DossierIssue[] = [];
  const rooms = planNeeds(doc);
  const incomplete = rooms.filter((r) => !r.complete);
  if (incomplete.length > 0) {
    const missing = incomplete.reduce((n, r) => n + r.missing, 0);
    out.push({
      severity: 'info',
      text: `${incomplete.length} pièce${incomplete.length > 1 ? 's' : ''} sous l’équipement conseillé (${missing} point${missing > 1 ? 's' : ''}).`,
      fix: 'plan',
    });
  }
  if (doc.boards.length > 0) {
    const u = unlinkedItems(doc).symbols.length;
    if (u > 0) out.push({ severity: 'warn', text: `${u} appareil${u > 1 ? 's' : ''} sans circuit.`, fix: 'plan' });
  } else if (doc.items.some((i) => i.type === 'symbol' && isElectrical(i))) {
    out.push({ severity: 'info', text: 'Aucun tableau : les circuits ne sont pas encore définis.', fix: 'board' });
  }
  for (const b of doc.boards) {
    const checks = runChecks(b);
    const errors = checks.filter((c) => c.severity === 'error').length;
    const warns = checks.filter((c) => c.severity === 'warn').length;
    if (errors + warns > 0) {
      out.push({ severity: 'warn', text: `${b.name} : ${errors + warns} point${errors + warns > 1 ? 's' : ''} d’attention.`, fix: 'board' });
    }
  }
  return out;
}

export function dossierHeader(doc: Doc, keys: ReadonlySet<string>, date = new Date()): SheetHeader {
  const sections = dossierParts(doc)
    .filter((p) => keys.has(p.key))
    .map((p) => p.section);
  const boards = doc.boards.length > 0 ? ` · ${doc.boards.length} tableau${doc.boards.length > 1 ? 'x' : ''}` : '';
  return { title: doc.name, subtitle: planSubtitle(doc, date) + boards, sections };
}

export const dossierSvg = (doc: Doc, keys: ReadonlySet<string>): string => composeSheet(dossierHeader(doc, keys));

export const exportDossierSvg = (doc: Doc, keys: ReadonlySet<string>): void =>
  downloadSvg(dossierSvg(doc, keys), safeName(`${doc.name} - dossier`, 'svg'));

export const exportDossierPng = (doc: Doc, keys: ReadonlySet<string>): void =>
  downloadPng(dossierSvg(doc, keys), safeName(`${doc.name} - dossier`, 'png'));

/** PDF : une section par bloc, sans coupure au milieu d'un tableau. */
export function exportDossierPdf(doc: Doc, keys: ReadonlySet<string>): void {
  const { css, body } = sheetHtml(dossierHeader(doc, keys));
  printHtml(`${doc.name} - dossier`, css, body);
}

/** CSV des circuits d'un tableau, avec ce qui est raccordé sur le plan. */
export function exportDossierCircuitsCsv(doc: Doc, board: Board): void {
  const links = allLinks(doc);
  const wired = (id: number): string => {
    const l = links.get(id);
    return l ? linksSummary(l) : '';
  };
  downloadBlob(
    new Blob([circuitsCsv(board, wired)], { type: 'text/csv;charset=utf-8' }),
    safeName(`${doc.name} - ${board.name} - circuits`, 'csv'),
  );
}
