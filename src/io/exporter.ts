import { getSymbol, getWireType } from '../domain/catalog';
import { unionBounds } from '../domain/geometry';
import type { Doc } from '../domain/types';
import { GLYPH_ATTRS, renderScene } from '../render/items';
import { esc } from '../util/escape';

const PAD = 30;
const HEADER = 46;
const ROW = 28;

interface LegendRow {
  text: string;
  glyph: string;
}

function legendRows(doc: Doc): LegendRow[] {
  const rows: LegendRow[] = [];
  const kinds = new Set(doc.items.flatMap((i) => (i.type === 'symbol' ? [i.kind] : [])));
  for (const kind of kinds) {
    const def = getSymbol(kind);
    if (def) rows.push({ text: def.name, glyph: `<g transform="translate(16 0) scale(.8)" ${GLYPH_ATTRS}>${def.svg}</g>` });
  }
  const wires = new Set(doc.items.flatMap((i) => (i.type === 'wire' ? [i.wtype] : [])));
  for (const id of wires) {
    const w = getWireType(id);
    const dash = w.dash ? ` stroke-dasharray="${w.dash}"` : '';
    rows.push({ text: w.name, glyph: `<line x1="0" y1="0" x2="32" y2="0" stroke="${w.color}" stroke-width="2.4"${dash}/>` });
  }
  return rows;
}

/** Construit un SVG autonome (titre, plan, légende) prêt à être exporté. */
export function buildExportSvg(doc: Doc, date = new Date()): string {
  const b = unionBounds(doc.items) ?? { x0: 0, y0: 0, x1: 400, y1: 300 };
  const planW = b.x1 - b.x0;
  const planH = b.y1 - b.y0;
  const rows = legendRows(doc);
  const perCol = Math.ceil(rows.length / 2);
  const legendH = rows.length ? 34 + perCol * ROW : 0;

  const width = Math.round(Math.max(planW + PAD * 2, rows.length ? 460 : 0, 320));
  const height = Math.round(PAD + HEADER + planH + (rows.length ? 30 : 0) + legendH + PAD);
  const offX = (width - planW) / 2 - b.x0;
  const offY = PAD + HEADER - b.y0;

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  out += `<rect width="100%" height="100%" fill="#fff"/>`;
  out += `<text x="${PAD}" y="${PAD + 14}" font-size="20" font-weight="700" font-family="Arial,sans-serif" fill="#111">${esc(doc.name)}</text>`;
  out += `<text x="${PAD}" y="${PAD + 32}" font-size="11" font-family="Arial,sans-serif" fill="#777">${esc(date.toLocaleDateString('fr-FR'))}</text>`;
  out += `<g transform="translate(${offX} ${offY})">${renderScene(doc, { interactive: false })}</g>`;

  if (rows.length) {
    const top = PAD + HEADER + planH + 30;
    out += `<line x1="${PAD}" y1="${top - 8}" x2="${width - PAD}" y2="${top - 8}" stroke="#ccc"/>`;
    out += `<text x="${PAD}" y="${top + 10}" font-size="13" font-weight="700" font-family="Arial,sans-serif" fill="#111">Légende</text>`;
    rows.forEach((row, i) => {
      const x = PAD + Math.floor(i / perCol) * ((width - PAD * 2) / 2);
      const y = top + 34 + (i % perCol) * ROW;
      out += `<g transform="translate(${x} ${y})">${row.glyph}`;
      out += `<text x="42" y="4" font-size="12" font-family="Arial,sans-serif" fill="#222">${esc(row.text)}</text></g>`;
    });
  }
  return out + `</svg>`;
}
