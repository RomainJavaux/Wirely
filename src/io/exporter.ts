import { WIRE_TYPES, getSymbol } from '../domain/catalog';
import { GRID, unionBounds } from '../domain/geometry';
import { planBomRows, planSubtitle, roomRows } from '../domain/plan/export';
import { allLinks, circuitInfo, circuitOptions, circuitTitle, linksSummary } from '../domain/link/links';
import { estimateCables } from '../domain/link/route';
import { fmtLength, planSummary, roomsOf } from '../domain/plan/metrics';
import { symbolsByRoom } from '../domain/plan/needs';
import { getRoomKind } from '../domain/plan/roomKinds';
import type { Doc } from '../domain/types';
import { faceLabel, faceOfSymbol, roomFaces, symbolsOnFace } from '../domain/walls/faces';
import { effectiveHeight, isCeilingKind, isOpeningKind } from '../domain/walls/mounting';
import { GLYPH_ATTRS, renderScene } from '../render/items';
import { niceScaleBar } from '../render/scaleBar';
import { renderElevation } from '../render/walls/elevationSvg';
import { esc } from '../util/escape';
import { composeSheet, table, type SheetSection } from './sheet';

const FONT = 'Arial,sans-serif';
const PAD = 40;

/** Section « Plan » : le plan coté, avec sa barre d'échelle. */
function planSection(doc: Doc): SheetSection {
  const b = unionBounds(doc.items) ?? { x0: 0, y0: 0, x1: 400, y1: 300 };
  const w = b.x1 - b.x0 + PAD * 2;
  const h = b.y1 - b.y0 + PAD * 2;

  // La barre d'échelle représente une longueur « ronde » ; 1 m vaut GRID / scale unités du plan.
  const bar = niceScaleBar(GRID / doc.scale, 70);
  const barY = h + 14;
  const scaleBar =
    `<g transform="translate(${PAD} ${barY})">` +
    `<path d="M0 0V8H${bar.px}V0" fill="none" stroke="#374151" stroke-width="2"/>` +
    `<text x="${bar.px + 8}" y="9" font-size="12" font-weight="700" font-family="${FONT}" fill="#374151">${esc(bar.label)}</text>` +
    `</g>`;

  // Un petit plan est agrandi pour occuper la largeur de la fiche (jusqu'à 2,5×), texte compris.
  const zoom = Math.min(2.5, Math.max(1, 1000 / Math.max(w, 360)));
  const content =
    `<g transform="translate(${PAD - b.x0} ${PAD - b.y0})">${renderScene(doc, { interactive: false, scale: doc.scale })}</g>` +
    scaleBar;

  return {
    key: 'plan',
    title: 'Plan',
    svg: `<g transform="scale(${zoom})">${content}</g>`,
    width: Math.max(w, 360) * zoom,
    height: (h + 34) * zoom,
  };
}

/** Légende chiffrée : chaque symbole avec sa quantité, chaque type de câble avec sa longueur. */
function legendSection(doc: Doc): SheetSection | null {
  const s = planSummary(doc);
  interface Cell {
    glyph: string;
    text: string;
    value: string;
  }
  const cells: Cell[] = [];

  const symbols = [...s.byKind].sort((a, b) => b.count - a.count);
  for (const k of symbols) {
    const def = getSymbol(k.kind);
    if (!def) continue;
    cells.push({
      glyph: `<g transform="translate(18 ${def.viewBox ? 22 : 12}) scale(.85)" ${GLYPH_ATTRS}>${def.svg}</g>`,
      text: def.name,
      value: `× ${k.count}`,
    });
  }
  for (const w of s.wires) {
    const def = WIRE_TYPES[w.type];
    const dash = def.dash ? ` stroke-dasharray="${def.dash}"` : '';
    cells.push({
      glyph: `<line x1="0" y1="12" x2="36" y2="12" stroke="${def.color}" stroke-width="2.6"${dash}/>`,
      text: def.name,
      value: fmtLength(w.length),
    });
  }
  if (cells.length === 0) return null;

  const colW = 600;
  const rowH = 32;
  const perCol = Math.ceil(cells.length / 2);
  let svg = '';
  cells.forEach((c, i) => {
    const x = Math.floor(i / perCol) * colW;
    const y = (i % perCol) * rowH;
    svg += `<g transform="translate(${x} ${y})">${c.glyph}`;
    svg += `<text x="52" y="17" font-size="12.5" font-family="${FONT}" fill="#222">${esc(c.text)}</text>`;
    svg += `<text x="${colW - 40}" y="17" font-size="12.5" font-weight="700" font-family="${FONT}" text-anchor="end" fill="#111">${esc(c.value)}</text>`;
    svg += `<line x1="0" y1="${rowH - 2}" x2="${colW - 40}" y2="${rowH - 2}" stroke="#eceff4"/></g>`;
  });
  return { key: 'legend', title: 'Légende', svg, width: colW * 2, height: perCol * rowH };
}

function roomsSection(doc: Doc): SheetSection | null {
  const rows = roomRows(doc);
  if (rows.length === 0) return null;
  const t = table(
    1200,
    [
      { title: 'Pièce', frac: 0.2, get: (r) => r.name },
      { title: 'Type', frac: 0.15, get: (r) => r.type },
      { title: 'Dimensions', frac: 0.17, get: (r) => `${r.width} × ${r.depth} m${r.merged ? ' (hors tout)' : ''}` },
      { title: 'Surface', frac: 0.1, get: (r) => `${r.area} m²` },
      { title: 'Prises', frac: 0.09, get: (r) => String(r.sockets) },
      { title: 'Points lumineux', frac: 0.12, get: (r) => String(r.lights) },
      { title: 'Commandes', frac: 0.09, get: (r) => String(r.switches) },
      { title: 'Appareils', frac: 0.08, get: (r) => String(r.equipment) },
    ],
    rows,
  );
  return { key: 'rooms', title: 'Pièces', svg: t.svg, width: 1200, height: t.height };
}

/** Ce qu'il y a derrière chaque disjoncteur : appareils, longueur de câble et pièces desservies. */
function circuitsSection(doc: Doc): SheetSection | null {
  if (doc.boards.length === 0) return null;
  const links = allLinks(doc);
  const rows = circuitOptions(doc)
    .map((o) => ({ o, l: links.get(o.id) }))
    .filter((r) => r.l !== undefined);
  if (rows.length === 0) return null;

  const t = table(
    1200,
    [
      { title: 'Circuit', frac: 0.3, get: (r) => circuitTitle(doc, r.o) },
      { title: 'Différentiel', frac: 0.1, get: (r) => r.o.group ?? '' },
      { title: 'Raccordé au plan', frac: 0.3, get: (r) => (r.l ? linksSummary(r.l) : '') },
      { title: 'Pièces desservies', frac: 0.3, get: (r) => (r.l ? r.l.rooms.map((x) => `${x.label} (${x.count})`).join(', ') : '') },
    ],
    rows,
  );
  return { key: 'circuits', title: 'Circuits raccordés au plan', svg: t.svg, width: 1200, height: t.height };
}

function materialsSection(doc: Doc): SheetSection | null {
  const rows = planBomRows(doc);
  if (rows.length === 0) return null;
  const t = table(
    1200,
    [
      { title: 'Rubrique', frac: 0.15, get: (r) => r.section },
      { title: 'Catégorie', frac: 0.2, get: (r) => r.category },
      { title: 'Désignation', frac: 0.35, get: (r) => r.name },
      { title: 'Quantité', frac: 0.15, get: (r) => (r.qty === null ? '' : String(r.qty)) },
      { title: 'Longueur', frac: 0.15, get: (r) => (r.length === null ? '' : fmtLength(r.length)) },
    ],
    rows,
  );
  return { key: 'materials', title: 'Nomenclature', svg: t.svg, width: 1200, height: t.height };
}

const WALLS_WIDTH = 1200;
const WALLS_GAP = 24;

/**
 * Élévations des murs équipés : position et hauteur de chaque prise, interrupteur, etc.
 * Les élévations sont rangées côte à côte tant qu'elles tiennent dans la largeur de la fiche.
 */
function wallsSection(doc: Doc): SheetSection | null {
  const circuits = circuitInfo(doc);
  const rooms = roomsOf(doc.items).sort((a, b) => a.y - b.y || a.x - b.x);
  const cells: { svg: string; width: number; height: number }[] = [];
  for (const room of rooms) {
    for (const face of roomFaces(room)) {
      const equipped = symbolsOnFace(doc, face).some((p) => p.mounting.where !== 'opening');
      if (!equipped) continue;
      const scene = renderElevation(doc, room, face, { interactive: false, circuits });
      cells.push({ svg: scene.svg, width: scene.width, height: scene.height });
    }
  }
  if (cells.length === 0) return null;

  let svg = '';
  let x = 0;
  let y = 0;
  let rowH = 0;
  let widest = 0;
  for (const c of cells) {
    if (x > 0 && x + c.width > WALLS_WIDTH) {
      y += rowH + WALLS_GAP;
      x = 0;
      rowH = 0;
    }
    svg += `<g transform="translate(${x} ${y})">${c.svg}</g>`;
    x += c.width + WALLS_GAP;
    rowH = Math.max(rowH, c.height);
    widest = Math.max(widest, x - WALLS_GAP);
  }
  return { key: 'walls', title: 'Élévations des murs', svg, width: widest, height: y + rowH };
}

interface PointRow {
  room: string;
  name: string;
  label: string;
  wall: string;
  left: string;
  height: string;
  circuit: string;
}

/**
 * Liste des points, pièce par pièce : chaque appareil avec son mur, sa distance au coin gauche, sa
 * hauteur et son circuit. C'est le « cahier des points » que l'on remet à l'électricien.
 */
function pointsSection(doc: Doc): SheetSection | null {
  const bySymbols = symbolsByRoom(doc);
  const circuits = new Map(circuitOptions(doc).map((o) => [o.id, `${o.ref} · ${o.label}`] as const));
  const rows: PointRow[] = [];

  for (const room of roomsOf(doc.items).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const roomName = room.label.trim() || getRoomKind(room.kind).name;
    const faces = roomFaces(room);
    const symbols = (bySymbols.get(room.id) ?? []).filter((s) => !isOpeningKind(s.kind) && s.kind !== 'tableau');
    const placed = symbols.map((s) => {
      const found = isCeilingKind(s.kind) ? null : faceOfSymbol(doc, s);
      const p = found ? symbolsOnFace(doc, found.face).find((x) => x.item.id === s.id) : undefined;
      return { s, found, u: p?.u ?? 0, order: found ? faces.findIndex((f) => f.key === found.face.key) : 99 };
    });
    placed.sort((a, b) => a.order - b.order || a.u - b.u);
    for (const { s, found, u } of placed) {
      rows.push({
        room: roomName,
        name: getSymbol(s.kind)?.name ?? s.kind,
        label: s.label.trim(),
        wall: isCeilingKind(s.kind) ? 'Plafond' : found ? faceLabel(found.face, faces) : '—',
        left: found ? `${Math.round(u)} cm` : '',
        height: isCeilingKind(s.kind) ? '' : `${Math.round(effectiveHeight(s))} cm`,
        circuit: s.breaker !== null ? (circuits.get(s.breaker) ?? '') : '',
      });
    }
  }
  if (rows.length === 0) return null;

  const t = table(
    1200,
    [
      { title: 'Pièce', frac: 0.15, get: (r) => r.room },
      { title: 'Appareil', frac: 0.2, get: (r) => r.name },
      { title: 'Repère', frac: 0.15, get: (r) => r.label },
      { title: 'Mur', frac: 0.12, get: (r) => r.wall },
      { title: 'Du coin gauche', frac: 0.1, get: (r) => r.left },
      { title: 'Hauteur', frac: 0.08, get: (r) => r.height },
      { title: 'Circuit', frac: 0.2, get: (r) => r.circuit },
    ],
    rows,
  );
  return { key: 'points', title: 'Liste des points par pièce', svg: t.svg, width: 1200, height: t.height };
}

/** Câble à prévoir : tracés dessinés et estimation par circuit (tableau -> appareils, descentes comprises). */
function cablesSection(doc: Doc): SheetSection | null {
  interface Row {
    name: string;
    length: string;
    detail: string;
  }
  const rows: Row[] = [];
  for (const c of estimateCables(doc)) {
    const section = String(c.section).replace('.', ',');
    rows.push({
      name: `Câble U-1000 R2V 3G${section} mm²`,
      length: `≈ ${Math.ceil(c.length / 5) * 5} m`,
      detail: `Estimation : ${c.circuits} circuit${c.circuits > 1 ? 's' : ''}, ${fmtLength(c.length)} avec descentes et marge de pose`,
    });
  }
  for (const w of planSummary(doc).wires) {
    rows.push({ name: WIRE_TYPES[w.type].name, length: fmtLength(w.length), detail: 'Tracé sur le plan' });
  }
  if (rows.length === 0) return null;
  const t = table(
    1200,
    [
      { title: 'Câble', frac: 0.35, get: (r) => r.name },
      { title: 'Longueur', frac: 0.15, get: (r) => r.length },
      { title: 'Origine', frac: 0.5, get: (r) => r.detail },
    ],
    rows,
  );
  return { key: 'cables', title: 'Câbles à prévoir', svg: t.svg, width: 1200, height: t.height };
}

/** Sections de la fiche du plan, dans l'ordre : plan, légende, pièces, points, murs, circuits, câbles, matériel. */
export function buildPlanSections(doc: Doc): SheetSection[] {
  return [
    planSection(doc),
    legendSection(doc),
    roomsSection(doc),
    pointsSection(doc),
    wallsSection(doc),
    circuitsSection(doc),
    cablesSection(doc),
    materialsSection(doc),
  ].filter((s): s is SheetSection => s !== null);
}

export const planSheetHeader = (doc: Doc, date = new Date()) => ({
  title: doc.name,
  subtitle: planSubtitle(doc, date),
  sections: buildPlanSections(doc),
});

/** Construit un SVG autonome (titre, plan coté, légende, tableaux) prêt à être exporté. */
export function buildExportSvg(doc: Doc, date = new Date()): string {
  return composeSheet(planSheetHeader(doc, date));
}
