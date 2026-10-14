import { esc } from '../util/escape';

/** Mise en page commune des fiches exportées (plan et tableau) : sections empilées dans un SVG. */

const FONT = 'Arial,sans-serif';
const MARGIN = 30;
const MIN_WIDTH = 900;
const MAX_CONTENT = 1200;
const ROW_H = 22;

export interface SheetSection {
  /** Identifiant stable (choix des sections d'un dossier). */
  key?: string;
  title: string;
  /** Contenu SVG de la section, dans son propre repère (origine en haut à gauche). */
  svg: string;
  width: number;
  height: number;
}

export interface Column<T> {
  title: string;
  /** Part de la largeur du tableau. */
  frac: number;
  get(row: T): string;
}

const cut = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s);

/** Tableau SVG simple : en-tête grisé, lignes zébrées, textes tronqués à la largeur de colonne. */
export function table<T>(width: number, columns: Column<T>[], rows: T[]): { svg: string; height: number } {
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

export interface SheetHeader {
  title: string;
  /** Ligne d'informations sous le titre. */
  subtitle: string;
  sections: SheetSection[];
}

/** Assemble titre, informations et sections en un SVG autonome (PNG / SVG). */
export function composeSheet({ title, subtitle, sections }: SheetHeader): string {
  const widest = Math.max(0, ...sections.map((s) => Math.min(s.width, MAX_CONTENT)));
  const width = Math.round(Math.max(MIN_WIDTH, widest + MARGIN * 2));
  const inner = width - MARGIN * 2;

  let y = MARGIN;
  let out = '';
  out += `<text x="${MARGIN}" y="${y + 20}" font-size="24" font-weight="700" font-family="${FONT}" fill="#111">${esc(title)}</text>`;
  out += `<text x="${MARGIN}" y="${y + 40}" font-size="12" font-family="${FONT}" fill="#6b7385">${esc(subtitle)}</text>`;
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

/** Version HTML pour l'impression / PDF : une section par bloc, sans coupure au milieu d'un tableau. */
export function sheetHtml({ title, subtitle, sections }: SheetHeader): { css: string; body: string } {
  const css =
    `@page{size:A4 landscape;margin:10mm}body{margin:0;font-family:${FONT};color:#111}` +
    `h1{font-size:22px;margin:0}header p{margin:4px 0 14px;color:#6b7385;font-size:12px}` +
    `h2{font-size:14px;margin:0 0 6px;border-bottom:1px solid #cfd5df;padding-bottom:4px}` +
    `section{break-inside:avoid;margin-bottom:16px}svg{width:100%;height:auto;max-height:170mm}`;
  const body =
    `<header><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></header>` +
    sections
      .map(
        (s) =>
          `<section><h2>${esc(s.title)}</h2><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width} ${s.height}">${s.svg}</svg></section>`,
      )
      .join('');
  return { css, body };
}
