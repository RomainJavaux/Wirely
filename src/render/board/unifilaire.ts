import { USAGES, getDeviceDef } from '../../domain/board/catalog';
import { deviceName, deviceSpec, fmtSection } from '../../domain/board/bom';
import { analyze, effectiveSection, effectiveUsage, isCircuitRole } from '../../domain/board/layout';
import type { Board, Device } from '../../domain/board/types';
import { esc } from '../../util/escape';
import { wrapText } from './boardSvg';
import type { RenderedBoard } from './boardSvg';

const FONT = 'Arial,sans-serif';
const COL_W = 88;
const BOX_W = 80;
const BOX_H = 116;
const GROUP_GAP = 30;
const MARGIN = 28;

const text = (x: number, y: number, s: string, size = 10, fill = '#1f2430', weight = 400, anchor = 'middle'): string =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="${FONT}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${esc(s)}</text>`;

const line = (x1: number, y1: number, x2: number, y2: number): string =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#374151" stroke-width="1.6"/>`;

function itemBox(d: Device, ref: string, cx: number, y: number, section: number | null): string {
  const def = getDeviceDef(d.kind);
  const circuit = def !== undefined && isCircuitRole(def);
  const color = circuit ? USAGES[effectiveUsage(d)].color : '#7b8794';
  const x = cx - BOX_W / 2;
  let s = `<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="5" fill="#fff" stroke="#9aa3b2"/>`;
  s += `<rect x="${x}" y="${y}" width="${BOX_W}" height="16" rx="5" fill="${color}"/>`;
  s += text(cx, y + 12, ref || def?.short || '', 10, '#fff', 700);
  const title = circuit && d.curve && d.rating !== null ? `${d.curve}${d.rating}` : (def?.short ?? deviceName(d));
  s += text(cx, y + 33, title, 13, '#111', 700);
  wrapText(d.label || (circuit ? '' : deviceName(d)), 13, 3).forEach((l, i) => {
    s += text(cx, y + 50 + i * 12, l, 10, '#222');
  });
  if (section !== null) s += text(cx, y + BOX_H - 20, fmtSection(section), 9.5, '#374151', 700);
  const dest = wrapText(d.dest, 14, 1)[0];
  if (dest) s += text(cx, y + BOX_H - 7, dest, 8.5, '#7a8394');
  return s;
}

/** Schéma unifilaire généré automatiquement depuis l'implantation du tableau. */
export function renderUnifilaire(board: Board): RenderedBoard {
  const a = analyze(board);
  const groups = a.groups.filter((g) => g.members.length > 0 || g.head);

  const widths = groups.map((g) => Math.max(g.members.length * COL_W, 168));
  const total = widths.reduce((sum, w) => sum + w, 0) + Math.max(0, groups.length - 1) * GROUP_GAP + MARGIN * 2;
  const width = Math.max(total, 320);

  let s = '';
  const midX = width / 2;
  let y = 22;

  const supply = board.supply === 'tri' ? 'Arrivée triphasée 400 V' : 'Arrivée monophasée 230 V';
  s += text(midX, y, supply, 11, '#374151', 700);
  let lastY = y + 6;

  for (const f of a.feeders) {
    s += line(midX, lastY, midX, lastY + 14);
    const top = lastY + 14;
    s += `<rect x="${midX - 90}" y="${top}" width="180" height="34" rx="5" fill="#fff" stroke="#374151" stroke-width="1.4"/>`;
    s += text(midX, top + 14, `${a.refs.get(f.id) ?? ''} · ${deviceName(f)}`, 10, '#111', 700);
    s += text(midX, top + 27, deviceSpec(f), 9.5, '#596070');
    lastY = top + 34;
  }

  const busY = lastY + 22;
  s += line(midX, lastY, midX, busY);

  const centers: number[] = [];
  let x = MARGIN;
  widths.forEach((w) => {
    centers.push(x + w / 2);
    x += w + GROUP_GAP;
  });

  if (centers.length > 1) s += line(centers[0] as number, busY, centers[centers.length - 1] as number, busY);
  else if (centers.length === 1) s += line(midX, busY, centers[0] as number, busY);

  let maxY = busY + 40;
  groups.forEach((g, gi) => {
    const gcx = centers[gi] as number;
    const headTop = busY + 18;
    s += line(gcx, busY, gcx, headTop);

    const head = g.head;
    if (head) {
      s += `<rect x="${gcx - 84}" y="${headTop}" width="168" height="44" rx="5" fill="#eaf1fd" stroke="#1d6fd6" stroke-width="1.5"/>`;
      s += text(gcx, headTop + 17, `${a.refs.get(head.id) ?? ''} · ${deviceName(head)}`, 10, '#0b3d91', 700);
      s += text(gcx, headTop + 32, deviceSpec(head), 9.5, '#0b3d91');
    } else {
      s += `<rect x="${gcx - 84}" y="${headTop}" width="168" height="44" rx="5" fill="#fff7ed" stroke="#ea580c" stroke-dasharray="4 3"/>`;
      s += text(gcx, headTop + 26, 'Sans différentiel amont', 10, '#9a3412', 700);
    }

    const bus2 = headTop + 44 + 20;
    s += line(gcx, headTop + 44, gcx, bus2);
    const n = g.members.length;
    const startX = gcx - (n * COL_W) / 2 + COL_W / 2;
    if (n > 1) s += line(startX, bus2, startX + (n - 1) * COL_W, bus2);

    g.members.forEach((d, i) => {
      const cx = startX + i * COL_W;
      s += line(cx, bus2, cx, bus2 + 18);
      s += itemBox(d, a.refs.get(d.id) ?? '', cx, bus2 + 18, effectiveSection(d));
    });
    maxY = Math.max(maxY, bus2 + 18 + BOX_H);
  });

  if (groups.length === 0) s += text(midX, busY + 30, 'Aucun appareil dans le tableau', 11, '#7a8394');

  return { svg: s, width, height: maxY + 24 };
}
