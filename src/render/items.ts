import { getSymbol, getWireType } from '../domain/catalog';
import { sortedForDrawing } from '../domain/document';
import type { Doc, Item, SymbolItem } from '../domain/types';
import { esc } from '../util/escape';

export const ACCENT = '#2563eb';
/** Attributs de trait communs à tous les symboles. */
export const GLYPH_ATTRS =
  'stroke="#111" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"';

export interface RenderOptions {
  /** true : ajoute les zones de clic (data-id) pour l'éditeur ; false : rendu pur pour l'export. */
  interactive: boolean;
  selectedId?: number | null;
}

const points = (pts: readonly (readonly number[])[]): string => pts.map((p) => p.join(',')).join(' ');

function renderSymbol(it: SymbolItem, selected: boolean, interactive: boolean): string {
  const def = getSymbol(it.kind);
  if (!def) return '';
  const stroke = selected ? ACCENT : '#111';
  let out =
    `<g transform="translate(${it.x} ${it.y}) rotate(${it.rot})" stroke="${stroke}" stroke-width="1.7" ` +
    `fill="none" stroke-linecap="round" stroke-linejoin="round">${def.svg}</g>`;
  if (it.label) {
    out += `<text x="${it.x}" y="${it.y + 27}" font-size="10.5" text-anchor="middle" font-family="Arial,sans-serif" fill="#333">${esc(it.label)}</text>`;
  }
  if (interactive) {
    const outline = selected ? ` stroke="${ACCENT}" stroke-dasharray="3 3"` : '';
    out += `<rect x="${it.x - 17}" y="${it.y - 17}" width="34" height="34" fill="transparent"${outline}/>`;
  }
  return out;
}

export function renderItem(it: Item, opts: RenderOptions): string {
  const attr = opts.interactive ? ` data-id="${it.id}"` : '';
  const selected = opts.interactive && it.id === opts.selectedId;
  switch (it.type) {
    case 'room': {
      const label = it.label
        ? `<text x="${it.x + it.w / 2}" y="${it.y + 18}" font-size="13" font-weight="600" text-anchor="middle" font-family="Arial,sans-serif" fill="#445">${esc(it.label)}</text>`
        : '';
      return (
        `<g${attr}><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="#f4f6fa" ` +
        `stroke="${selected ? ACCENT : '#7c879b'}" stroke-width="${selected ? 2.5 : 1.5}"/>${label}</g>`
      );
    }
    case 'wall': {
      const p = points(it.points);
      const hit = opts.interactive
        ? `<polyline points="${p}" fill="none" stroke="transparent" stroke-width="18"/>`
        : '';
      return (
        `<g${attr}><polyline points="${p}" fill="none" stroke="${selected ? ACCENT : '#1f2430'}" ` +
        `stroke-width="7" stroke-linejoin="miter" stroke-linecap="square"/>${hit}</g>`
      );
    }
    case 'wire': {
      const w = getWireType(it.wtype);
      const p = points(it.points);
      const dash = w.dash ? ` stroke-dasharray="${w.dash}"` : '';
      const hit = opts.interactive
        ? `<polyline points="${p}" fill="none" stroke="transparent" stroke-width="14"/>`
        : '';
      return (
        `<g${attr}><polyline points="${p}" fill="none" stroke="${w.color}" stroke-width="${selected ? 3.4 : 2.4}" ` +
        `stroke-linejoin="round" stroke-linecap="round"${dash}/>${hit}</g>`
      );
    }
    case 'symbol':
      return `<g${attr}>${renderSymbol(it, selected, opts.interactive)}</g>`;
    case 'text':
      return (
        `<g${attr}><text x="${it.x}" y="${it.y}" font-size="14" font-family="Arial,sans-serif" ` +
        `fill="${selected ? ACCENT : '#111'}">${esc(it.text)}</text></g>`
      );
  }
}

export const renderScene = (doc: Doc, opts: RenderOptions): string =>
  sortedForDrawing(doc.items).map((it) => renderItem(it, opts)).join('');
