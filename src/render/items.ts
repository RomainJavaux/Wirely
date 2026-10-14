import { getSymbol, getWireType } from '../domain/catalog';
import { sortedForDrawing } from '../domain/document';
import { fmtArea, fmtMeters, polylineLength, toMeters, toSquareMeters } from '../domain/plan/metrics';
import { largestRect, outlineSegments, roomArea, roomBox, roomRects } from '../domain/plan/rooms';
import { getRoomKind } from '../domain/plan/roomKinds';
import type { Doc, Item, Point, Room, SymbolItem, Wall, Wire } from '../domain/types';
import { esc } from '../util/escape';

export const ACCENT = '#2563eb';
/** Attributs de trait communs à tous les symboles. */
export const GLYPH_ATTRS =
  'stroke="#111" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"';

const FONT = 'Arial,sans-serif';
const WALL_OUTER = '#374151';
const WALL_INNER = '#fafbfc';

export interface RenderOptions {
  /** true : ajoute les zones de clic (data-id) pour l'éditeur ; false : rendu pur pour l'export. */
  interactive: boolean;
  selectedId?: number | null;
  /** Échelle du plan (m par carreau) : active l'affichage des cotes des pièces. */
  scale?: number;
  /** Calques masqués. */
  hide?: { wires?: boolean; symbols?: boolean; texts?: boolean };
}

const points = (pts: readonly (readonly number[])[]): string => pts.map((p) => p.join(',')).join(' ');

/** Point situé à la moitié de la longueur d'une ligne brisée (pour poser une étiquette). */
function midPoint(pts: readonly Point[]): Point {
  const half = polylineLength(pts) / 2;
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1] as Point;
    const [x1, y1] = pts[i] as Point;
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (walked + seg >= half && seg > 0) {
      const t = (half - walked) / seg;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    walked += seg;
  }
  return (pts[0] ?? [0, 0]) as Point;
}

/** Étiquette à fond blanc : reste lisible par-dessus pièces, murs et câbles. */
function pill(x: number, y: number, text: string, opts: { size?: number; fill?: string; color?: string } = {}): string {
  const size = opts.size ?? 10;
  const w = text.length * size * 0.58 + 10;
  return (
    `<rect x="${x - w / 2}" y="${y - size * 0.95}" width="${w}" height="${size * 1.45}" rx="${size * 0.7}" ` +
    `fill="${opts.fill ?? '#fff'}" fill-opacity=".92" stroke="#cfd5df" stroke-width=".8"/>` +
    `<text x="${x}" y="${y + size * 0.1}" font-size="${size}" font-family="${FONT}" text-anchor="middle" ` +
    `fill="${opts.color ?? '#333'}">${esc(text)}</text>`
  );
}

function renderRoom(it: Room, o: RenderOptions, selected: boolean): string {
  const kind = getRoomKind(it.kind);
  const attr = o.interactive ? ` data-id="${it.id}"` : '';
  const rects = roomRects(it);
  const stroke = selected ? ACCENT : '#aab3c2';
  const sw = selected ? 2.5 : 1;
  let out = `<g${attr}>`;

  if (rects.length === 1) {
    out += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${kind.color}" stroke="${stroke}" stroke-width="${sw}"/>`;
  } else {
    // Pièce composée : les parties sont remplies sans bordure, puis le contour de l'union est tracé :
    // les arêtes communes entre deux parties disparaissent.
    for (const r of rects) out += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${kind.color}"/>`;
    const d = outlineSegments(rects)
      .map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`)
      .join('');
    out += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>`;
  }

  // Nom et surface : dans le plus grand rectangle de la pièce.
  const main = largestRect(rects);
  const name = it.label.trim() || (it.kind === 'autre' ? '' : kind.name);
  const cx = main.x + main.w / 2;
  if (name) {
    out += `<text x="${cx}" y="${main.y + 20}" font-size="13" font-weight="700" text-anchor="middle" font-family="${FONT}" fill="#374151">${esc(name)}</text>`;
  }
  if (o.scale !== undefined && main.w >= 80 && main.h >= 60) {
    let text: string;
    if (rects.length === 1) {
      const w = toMeters(o.scale, it.w);
      const d = toMeters(o.scale, it.h);
      text = `${w.toFixed(1).replace('.', ',')} × ${d.toFixed(1).replace('.', ',')} m · ${fmtArea(w * d)}`;
    } else {
      const m2 = toSquareMeters(o.scale, roomArea(it));
      text = `${fmtArea(m2)} · ${rects.length} parties`;
    }
    out += `<text x="${cx}" y="${main.y + (name ? 35 : 20)}" font-size="10" text-anchor="middle" font-family="${FONT}" fill="#6b7385">${esc(text)}</text>`;
  }
  return out + '</g>';
}

/** Cotes d'une pièce sélectionnée : deux lignes de cote avec leurs longueurs, hors de la pièce. */
function renderRoomDims(it: Room, scale: number): string {
  const col = ACCENT;
  const box = roomBox(it); // hors tout, pour une pièce composée
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const w = fmtMeters(toMeters(scale, bw));
  const h = fmtMeters(toMeters(scale, bh));
  const yTop = box.y0 - 16;
  const xLeft = box.x0 - 16;
  return (
    `<g pointer-events="none" stroke="${col}" stroke-width="1" fill="${col}" font-family="${FONT}" font-size="10.5">` +
    `<line x1="${box.x0}" y1="${yTop}" x2="${box.x1}" y2="${yTop}"/>` +
    `<line x1="${box.x0}" y1="${yTop - 5}" x2="${box.x0}" y2="${yTop + 5}"/>` +
    `<line x1="${box.x1}" y1="${yTop - 5}" x2="${box.x1}" y2="${yTop + 5}"/>` +
    `<text x="${box.x0 + bw / 2}" y="${yTop - 5}" text-anchor="middle" stroke="none">${esc(w)}</text>` +
    `<line x1="${xLeft}" y1="${box.y0}" x2="${xLeft}" y2="${box.y1}"/>` +
    `<line x1="${xLeft - 5}" y1="${box.y0}" x2="${xLeft + 5}" y2="${box.y0}"/>` +
    `<line x1="${xLeft - 5}" y1="${box.y1}" x2="${xLeft + 5}" y2="${box.y1}"/>` +
    `<text transform="translate(${xLeft - 5} ${box.y0 + bh / 2}) rotate(-90)" text-anchor="middle" stroke="none">${esc(h)}</text>` +
    `</g>`
  );
}

/** Mur : trait sombre ; le cœur clair est dessiné à part pour que les jonctions se fondent. */
function renderWallOuter(it: Wall, o: RenderOptions, selected: boolean): string {
  const attr = o.interactive ? ` data-id="${it.id}"` : '';
  const p = points(it.points);
  const hit = o.interactive ? `<polyline points="${p}" fill="none" stroke="transparent" stroke-width="18"/>` : '';
  return (
    `<g${attr}><polyline points="${p}" fill="none" stroke="${selected ? ACCENT : WALL_OUTER}" ` +
    `stroke-width="9" stroke-linejoin="miter" stroke-linecap="square"/>${hit}</g>`
  );
}

const renderWallInner = (it: Wall): string =>
  `<polyline points="${points(it.points)}" fill="none" stroke="${WALL_INNER}" stroke-width="4.5" ` +
  `stroke-linejoin="miter" stroke-linecap="square" pointer-events="none"/>`;

function renderWire(it: Wire, o: RenderOptions, selected: boolean): string {
  const attr = o.interactive ? ` data-id="${it.id}"` : '';
  const w = getWireType(it.wtype);
  const p = points(it.points);
  const dash = w.dash ? ` stroke-dasharray="${w.dash}"` : '';
  const hit = o.interactive ? `<polyline points="${p}" fill="none" stroke="transparent" stroke-width="14"/>` : '';
  const dots = it.points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${w.color}"/>`).join('');
  let out =
    `<g${attr}><polyline points="${p}" fill="none" stroke="${w.color}" stroke-width="${selected ? 3.6 : 2.4}" ` +
    `stroke-linejoin="round" stroke-linecap="round"${dash}/>${dots}${hit}`;
  if (it.circuit.trim()) {
    const [mx, my] = midPoint(it.points);
    out += pill(mx, my, it.circuit.trim(), { size: 9.5, fill: '#fff', color: w.color });
  }
  return out + '</g>';
}

function renderSymbol(it: SymbolItem, o: RenderOptions, selected: boolean): string {
  const def = getSymbol(it.kind);
  if (!def) return '';
  const attr = o.interactive ? ` data-id="${it.id}"` : '';
  const stroke = selected ? ACCENT : '#111';
  const transform = `translate(${it.x} ${it.y}) rotate(${it.rot})`;

  // Les ouvertures interrompent le mur ; les autres symboles reçoivent un halo clair.
  const backdrop = def.gap
    ? `<rect x="${def.gap[0]}" y="${def.gap[1]}" width="${def.gap[2]}" height="${def.gap[3]}" fill="${WALL_INNER}"/>`
    : `<circle r="13" fill="#fff" fill-opacity=".78"/>`;

  let out =
    `<g${attr}><g transform="${transform}"><g>${backdrop}</g>` +
    `<g stroke="${stroke}" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${def.svg}</g></g>`;

  if (selected) out += `<circle cx="${it.x}" cy="${it.y}" r="20" fill="none" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
  if (it.label.trim()) out += pill(it.x, it.y + 31, it.label.trim(), { size: 9.5 });
  if (it.circuit.trim()) out += pill(it.x + 17, it.y - 15, it.circuit.trim(), { size: 8.5, fill: '#fff7e6', color: '#8a4b00' });
  if (o.interactive) out += `<rect x="${it.x - 17}" y="${it.y - 17}" width="34" height="34" fill="transparent"/>`;
  return out + '</g>';
}

function renderText(it: Extract<Item, { type: 'text' }>, o: RenderOptions, selected: boolean): string {
  const attr = o.interactive ? ` data-id="${it.id}"` : '';
  return (
    `<g${attr}><text x="${it.x}" y="${it.y}" font-size="14" font-family="${FONT}" ` +
    `fill="${selected ? ACCENT : '#111'}" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(it.text)}</text></g>`
  );
}

export function renderItem(it: Item, opts: RenderOptions): string {
  const selected = opts.interactive && it.id === opts.selectedId;
  switch (it.type) {
    case 'room':
      return renderRoom(it, opts, selected);
    case 'wall':
      return renderWallOuter(it, opts, selected) + renderWallInner(it);
    case 'wire':
      return renderWire(it, opts, selected);
    case 'symbol':
      return renderSymbol(it, opts, selected);
    case 'text':
      return renderText(it, opts, selected);
  }
}

export function renderScene(doc: Pick<Doc, 'items'>, opts: RenderOptions): string {
  const items = sortedForDrawing(doc.items);
  const hide = opts.hide ?? {};
  const sel = (type: Item['type']) => items.filter((i) => i.type === type);

  let out = '';
  for (const r of sel('room')) out += renderItem(r, opts);

  // Murs en deux passes : tous les traits sombres, puis tous les cœurs clairs.
  const walls = sel('wall') as Wall[];
  for (const w of walls) out += renderWallOuter(w, opts, opts.interactive && w.id === opts.selectedId);
  for (const w of walls) out += renderWallInner(w);

  if (!hide.wires) for (const w of sel('wire')) out += renderItem(w, opts);
  if (!hide.symbols) for (const s of sel('symbol')) out += renderItem(s, opts);
  if (!hide.texts) for (const t of sel('text')) out += renderItem(t, opts);

  const selected = opts.interactive ? items.find((i) => i.id === opts.selectedId) : undefined;
  if (selected?.type === 'room' && opts.scale !== undefined) out += renderRoomDims(selected, opts.scale);
  return out;
}
