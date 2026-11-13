import { BUS_SYSTEMS, USAGES, getDeviceDef } from '../../domain/board/catalog';
import { deviceName, deviceSpec } from '../../domain/board/bom';
import { analyze, effectiveSection, effectiveUsage, isCircuitRole, variantOf } from '../../domain/board/layout';
import type { Board, Device } from '../../domain/board/types';
import { FIXED_KINDS, LIGHT_KINDS, SOCKET_KINDS, SWITCH_KINDS, getSymbol } from '../../domain/catalog';
import { allLinks } from '../../domain/link/links';
import { pointRefs } from '../../domain/points';
import { rulesOf } from '../../domain/rules';
import type { Doc, SymbolItem } from '../../domain/types';
import { esc } from '../../util/escape';

/**
 * Schéma unifilaire d'un tableau, tel qu'on le remet au contrôle : l'arrivée, les différentiels,
 * puis chaque circuit avec sa protection, son câble et les points qu'il alimente, repérés comme
 * sur le schéma de position (A1, A2…). Généré depuis les circuits et les points : il ne peut pas
 * contredire le plan.
 *
 * Disposition « en échelle » : une colonne montante à gauche, et un jeu de barres horizontal par
 * différentiel (prolongé sur une nouvelle ligne quand il porte beaucoup de circuits).
 */

const FONT = 'Arial,sans-serif';
const INK = '#1f2430';
const MUTED = '#5b6474';
const COL_W = 108;
/** Nombre de circuits par ligne du schéma. */
const PER_LINE = 10;
const MARGIN = 24;
const RISER_X = MARGIN + 14;
const HEAD_W = 176;
const BUS_X = RISER_X + 26 + HEAD_W + 18;

export interface RenderedSchema {
  svg: string;
  width: number;
  height: number;
}

const text = (
  x: number,
  y: number,
  s: string,
  o: { size?: number; fill?: string; weight?: number; anchor?: 'start' | 'middle' | 'end' } = {},
): string =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 10}" font-family="${FONT}" font-weight="${o.weight ?? 400}" ` +
  `text-anchor="${o.anchor ?? 'middle'}" fill="${o.fill ?? INK}">${esc(s)}</text>`;

const line = (x1: number, y1: number, x2: number, y2: number, w = 1.6, dash = ''): string =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

/** Coupe un texte en lignes d'au plus `max` caractères (sur les espaces quand c'est possible). */
function wrap(s: string, max: number, lines: number): string[] {
  const words = s.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    kept[lines - 1] = `${(kept[lines - 1] as string).slice(0, Math.max(1, max - 1))}…`;
    return kept;
  }
  return out;
}

/** « A1–A4 », « A1, A3 », ou « A1, A3… » : les repères d'un groupe de points. */
function refRange(refs: string[]): string {
  if (refs.length === 0) return '';
  const parsed = refs.map((r) => {
    const m = /^(.*?)(\d+)$/.exec(r);
    return m ? { prefix: m[1] as string, n: Number(m[2]) } : null;
  });
  if (parsed.some((p) => p === null)) return refs.slice(0, 2).join(', ') + (refs.length > 2 ? '…' : '');
  const list = (parsed as { prefix: string; n: number }[]).sort((a, b) => a.n - b.n);
  const first = list[0] as { prefix: string; n: number };
  const last = list[list.length - 1] as { prefix: string; n: number };
  const consecutive = list.every((p, i) => p.n === first.n + i);
  if (list.length === 1) return `${first.prefix}${first.n}`;
  if (consecutive) return `${first.prefix}${first.n}–${last.prefix}${last.n}`;
  const shown = list.slice(0, 3).map((p) => `${p.prefix}${p.n}`).join(', ');
  return list.length > 3 ? `${shown}…` : shown;
}

interface PointRow {
  kind: string;
  count: number;
  label: string;
  refs: string;
}

/** Ce qu'alimente un circuit, regroupé par type de point (un appareil fixe nommé a sa ligne). */
function pointRows(symbols: SymbolItem[], refs: ReadonlyMap<number, string>): PointRow[] {
  const order = (kind: string): number =>
    SOCKET_KINDS.has(kind) ? 0 : LIGHT_KINDS.has(kind) ? 1 : SWITCH_KINDS.has(kind) ? 2 : FIXED_KINDS.has(kind) ? 3 : 4;
  const groups = new Map<string, SymbolItem[]>();
  for (const s of symbols) {
    const key = s.kind === 'prise_s' && s.label.trim() ? `${s.kind}:${s.label.trim().toLowerCase()}` : s.kind;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.values()]
    .map((list): PointRow => {
      const first = list[0] as SymbolItem;
      const named = first.kind === 'prise_s' && first.label.trim() !== '';
      return {
        kind: first.kind,
        count: list.length,
        label: named ? first.label.trim() : (getSymbol(first.kind)?.name ?? first.kind),
        refs: refRange(list.map((s) => refs.get(s.id) ?? '').filter(Boolean)),
      };
    })
    .sort((a, b) => order(a.kind) - order(b.kind) || a.label.localeCompare(b.label, 'fr'));
}

const ROW_H = 30;
const LEAF_TOP = 118;

/** Hauteur d'une colonne de circuit, selon le nombre de lignes de points. */
const leafHeight = (rows: number): number => LEAF_TOP + Math.max(1, rows) * ROW_H + 44;

/** Symbole de disjoncteur : contact incliné surmonté d'une croix. */
function breakerGlyph(cx: number, y: number): string {
  return (
    line(cx, y, cx, y + 6) +
    `<path d="M${cx - 3.5} ${y + 3}L${cx + 3.5} ${y + 10}M${cx + 3.5} ${y + 3}L${cx - 3.5} ${y + 10}" stroke="${INK}" stroke-width="1.4"/>` +
    `<line x1="${cx}" y1="${y + 26}" x2="${cx - 9}" y2="${y + 9}" stroke="${INK}" stroke-width="1.8"/>` +
    line(cx, y + 26, cx, y + 32)
  );
}

function circuitLeaf(
  d: Device,
  ref: string,
  cx: number,
  y: number,
  rows: PointRow[],
  cable: string,
  laying: string | null,
): string {
  const def = getDeviceDef(d.kind);
  const color = USAGES[effectiveUsage(d)].color;
  const section = effectiveSection(d);
  let s = line(cx, y, cx, y + 8) + breakerGlyph(cx, y + 8);

  const poles = variantOf(d).label;
  const rating = d.rating !== null ? `${d.curve ?? ''}${d.rating} A` : '';
  s += text(cx + 12, y + 22, rating, { size: 10.5, weight: 700, anchor: 'start' });
  s += text(cx + 12, y + 34, def?.role === 'rcbo' ? `${poles} · ${d.sensitivity ?? 30} mA` : poles, { size: 8.5, fill: MUTED, anchor: 'start' });

  // Câble : type, nombre de conducteurs et section.
  s += line(cx, y + 40, cx, y + 86);
  if (section !== null) {
    const cores = /^(3P|3P\+N|4P)$/.test(d.variant) ? 5 : 3;
    s += text(cx + 8, y + 56, `${cable} ${cores}G${String(section).replace('.', ',')}`, { size: 9, anchor: 'start' });
    if (laying) wrap(laying, 15, 2).forEach((l, i) => (s += text(cx + 8, y + 67 + i * 9, l, { size: 7.5, fill: MUTED, anchor: 'start' })));
  }

  // Repère du circuit.
  s += `<circle cx="${cx}" cy="${y + 98}" r="12" fill="${color}"/>`;
  s += text(cx, y + 102, ref, { size: ref.length > 2 ? 9 : 11.5, fill: '#fff', weight: 700 });

  // Points alimentés : pictogramme, nombre et repères.
  const top = y + LEAF_TOP;
  if (rows.length === 0) {
    s += text(cx, top + 16, 'aucun point', { size: 8.5, fill: MUTED });
  } else {
    s += line(cx, y + 110, cx, top + (rows.length - 1) * ROW_H + 14, 1.2);
    rows.forEach((r, i) => {
      const ry = top + i * ROW_H + 14;
      const glyph = getSymbol(r.kind);
      s += `<line x1="${cx}" y1="${ry}" x2="${cx + 10}" y2="${ry}" stroke="${INK}" stroke-width="1.2"/>`;
      if (glyph) {
        s += `<g transform="translate(${cx + 22} ${ry}) scale(.62)" stroke="${INK}" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round">${glyph.svg}</g>`;
      }
      s += text(cx + 36, ry - 1, `× ${r.count}`, { size: 10, weight: 700, anchor: 'start' });
      if (r.refs) s += text(cx + 36, ry + 9, r.refs, { size: 7.5, fill: MUTED, anchor: 'start' });
      // Un appareil fixe nommé se lit mieux par son nom.
      if (r.kind === 'prise_s') s += text(cx - 6, ry + 3, wrap(r.label, 9, 1)[0] ?? '', { size: 7.5, fill: MUTED, anchor: 'end' });
    });
  }

  // Désignation et pièces desservies.
  const bottom = top + Math.max(1, rows.length) * ROW_H + 10;
  wrap(d.label || '', 18, 2).forEach((l, i) => (s += text(cx + 10, bottom + i * 11, l, { size: 9.5, weight: 700 })));
  const dest = wrap(d.dest, 20, 1)[0];
  if (dest) s += text(cx + 10, bottom + 24, dest, { size: 8, fill: MUTED });
  return s;
}

/** Appareil qui n'est pas un circuit (contacteur, télérupteur, module de bus…). */
function auxLeaf(d: Device, ref: string, cx: number, y: number): string {
  const def = getDeviceDef(d.kind);
  const tone = def?.tone ?? '#7b8794';
  let s = line(cx, y, cx, y + 26);
  s += `<rect x="${cx - 44}" y="${y + 26}" width="88" height="58" rx="5" fill="#fff" stroke="${tone}" stroke-width="1.4"/>`;
  s += text(cx, y + 42, ref || def?.short || '', { size: 10, weight: 700, fill: tone });
  wrap(d.label || deviceName(d), 15, 2).forEach((l, i) => (s += text(cx, y + 56 + i * 11, l, { size: 8.5 })));
  if (def?.outputs) s += text(cx, y + 80, `${def.outputs} sorties`, { size: 7.5, fill: MUTED });
  return s;
}

interface Leaf {
  device: Device;
  circuit: boolean;
  rows: PointRow[];
}

interface Segment {
  /** Différentiel en tête de cette ligne (null : alimentation directe). */
  head: Device | null;
  /** Ligne qui prolonge le jeu de barres du même différentiel. */
  continued: boolean;
  /** Circuits sans différentiel en amont. */
  unprotected: boolean;
  leaves: Leaf[];
}

/** Schéma unifilaire d'un tableau du chantier. */
export function renderSchema(doc: Doc, board: Board): RenderedSchema {
  const rules = rulesOf(doc);
  const a = analyze(board, rules.refScheme);
  const links = allLinks(doc);
  const refs = pointRefs(doc);

  const leafOf = (d: Device): Leaf => {
    const def = getDeviceDef(d.kind);
    const circuit = def !== undefined && isCircuitRole(def);
    return { device: d, circuit, rows: circuit ? pointRows(links.get(d.id)?.symbols ?? [], refs) : [] };
  };

  // Belgique : le premier différentiel, s'il est de plus de 30 mA, est le différentiel général.
  const heads = a.groups.filter((g) => g.head !== null);
  const first = heads[0]?.head ?? null;
  const general = rules.country === 'BE' && first && (first.sensitivity ?? 30) > 30 ? first : null;

  const segments: Segment[] = [];
  for (const g of a.groups) {
    const leaves = g.members.map(leafOf);
    const isGeneral = general !== null && g.head?.id === general.id;
    if (leaves.length === 0 && (g.head === null || isGeneral)) continue;
    const chunks: Leaf[][] = [];
    for (let i = 0; i < Math.max(1, leaves.length); i += PER_LINE) chunks.push(leaves.slice(i, i + PER_LINE));
    chunks.forEach((chunk, i) =>
      segments.push({
        // Les circuits du différentiel général partent directement de la colonne montante.
        head: isGeneral ? null : g.head,
        continued: i > 0,
        unprotected: g.head === null,
        leaves: chunk,
      }),
    );
  }
  if (a.busModules.length > 0) {
    for (let i = 0; i < a.busModules.length; i += PER_LINE) {
      segments.push({ head: null, continued: i > 0, unprotected: false, leaves: a.busModules.slice(i, i + PER_LINE).map(leafOf) });
    }
  }

  const widest = Math.max(1, ...segments.map((s) => s.leaves.length));
  const width = Math.max(BUS_X + widest * COL_W + MARGIN, 640);

  let s = '';
  let y = MARGIN;

  // --- En-tête : réseau, câbles par défaut
  const supply = board.supply === 'tri' ? '3N 400 V ~ 50 Hz' : '230 V ~ 50 Hz';
  s += text(MARGIN, y + 10, `Réseau : ${supply}`, { size: 11, weight: 700, anchor: 'start' });
  s += text(
    MARGIN,
    y + 24,
    `Câbles : ${doc.project.cable}, pose ${doc.project.laying} (sauf mention contraire sur le circuit)`,
    { size: 9.5, fill: MUTED, anchor: 'start' },
  );
  y += 40;

  // --- Arrivée : appareils de tête puis différentiel général
  const top = y;
  const headBox = (d: Device, label: string, at: number, tone = INK): string => {
    let b = `<rect x="${RISER_X - 12}" y="${at}" width="${HEAD_W + 24}" height="40" rx="5" fill="#fff" stroke="${tone}" stroke-width="1.5"/>`;
    b += text(RISER_X, at + 16, label, { size: 10, weight: 700, anchor: 'start', fill: tone });
    b += text(RISER_X, at + 30, deviceSpec(d), { size: 9, fill: MUTED, anchor: 'start' });
    return b;
  };
  for (const f of a.feeders) {
    s += headBox(f, `${a.refs.get(f.id) ?? ''} · ${deviceName(f)}`, y);
    y += 40;
    s += line(RISER_X, y, RISER_X, y + 14);
    y += 14;
  }
  if (general) {
    s += headBox(general, `${a.refs.get(general.id) ?? ''} · Différentiel général`, y, '#0b3d91');
    y += 40;
  }
  const riserTop = y;
  if (a.feeders.length === 0 && !general) s += line(RISER_X, top, RISER_X, y + 6);

  // --- Une ligne par jeu de barres
  let lastBusY = riserTop;
  if (segments.length === 0) {
    s += text(RISER_X + 20, y + 30, 'Aucun circuit dans ce tableau.', { size: 11, fill: MUTED, anchor: 'start' });
    y += 50;
  }
  for (const seg of segments) {
    const busY = y + 34;
    lastBusY = busY;
    const startX = BUS_X;
    const endX = startX + (seg.leaves.length - 1) * COL_W + 30;

    s += line(RISER_X, busY, RISER_X + 26, busY);
    if (seg.head && !seg.continued) {
      const h = seg.head;
      s += `<rect x="${RISER_X + 26}" y="${busY - 22}" width="${HEAD_W}" height="44" rx="5" fill="#eaf1fd" stroke="#1d6fd6" stroke-width="1.5"/>`;
      s += text(RISER_X + 36, busY - 5, `${a.refs.get(h.id) ?? ''} · Différentiel ${h.sensitivity ?? 30} mA`, { size: 10, weight: 700, anchor: 'start', fill: '#0b3d91' });
      s += text(RISER_X + 36, busY + 9, `${variantOf(h).label} · ${h.rating ?? ''} A · type ${h.diffType ?? 'A'}`, { size: 9, anchor: 'start', fill: '#0b3d91' });
    } else {
      s += line(RISER_X + 26, busY, RISER_X + 26 + HEAD_W, busY, 1.6, seg.continued ? '5 4' : '');
      const label = seg.continued
        ? seg.head
          ? `suite de ${a.refs.get(seg.head.id) ?? 'ce différentiel'}`
          : 'suite'
        : seg.unprotected
          ? 'sans différentiel'
          : general
            ? `sous ${a.refs.get(general.id) ?? 'le différentiel général'}`
            : '';
      if (label) s += text(RISER_X + 36, busY - 6, label, { size: 8.5, fill: seg.unprotected ? '#b45309' : MUTED, anchor: 'start' });
    }
    s += line(RISER_X + 26 + HEAD_W, busY, startX, busY);
    if (seg.leaves.length > 0) s += line(startX, busY, endX, busY, 2.6);

    let tallest = 90;
    seg.leaves.forEach((leaf, i) => {
      const cx = startX + 14 + i * COL_W;
      const d = leaf.device;
      const ref = a.refs.get(d.id) ?? '';
      if (leaf.circuit) {
        const laying = d.laying && d.laying !== doc.project.laying ? d.laying : null;
        s += circuitLeaf(d, ref, cx, busY, leaf.rows, d.cable ?? doc.project.cable, laying);
        tallest = Math.max(tallest, leafHeight(leaf.rows.length));
      } else {
        s += auxLeaf(d, ref, cx + 30, busY);
        tallest = Math.max(tallest, 100);
      }
    });
    y = busY + tallest + 10;
  }

  // Colonne montante, du haut jusqu'au dernier jeu de barres.
  if (segments.length > 0) s += line(RISER_X, riserTop, RISER_X, lastBusY, 2.6);

  // Bus de domotique : rappel du système.
  const systems = [...new Set(a.busModules.map((d) => getDeviceDef(d.kind)?.system).filter((x): x is keyof typeof BUS_SYSTEMS => x !== undefined))];
  if (systems.length > 0) {
    s += text(MARGIN, y + 6, `Domotique : ${systems.map((k) => BUS_SYSTEMS[k].name).join(', ')}`, { size: 9, fill: MUTED, anchor: 'start' });
    y += 16;
  }

  return { svg: s, width, height: y + MARGIN - 8 };
}
