import { getSymbol } from '../../domain/catalog';
import { getRoomKind } from '../../domain/plan/roomKinds';
import type { Doc, Room } from '../../domain/types';
import { faceLabel, faceLengthCm, roomFaces, symbolsOnFace, type Placement, type WallFace } from '../../domain/walls/faces';
import { esc } from '../../util/escape';
import { ACCENT } from '../items';

/** Pixels par centimètre dans le repère du SVG. */
export const K = 1.2;
const ML = 58;
const MR = 26;
const MT = 40;
const MB = 84;
const FONT = 'Arial,sans-serif';

export interface ElevationOptions {
  /** true : zones de clic (data-id) pour l'éditeur ; false : rendu pur pour l'export. */
  interactive: boolean;
  selectedId?: number | null;
  /** Repère et couleur de chaque disjoncteur, pour étiqueter l'appareillage raccordé. */
  circuits?: ReadonlyMap<number, { ref: string; color: string }>;
  activeCircuit?: number | null;
  /** Titre dans le dessin (export). */
  title?: string;
}

export interface ElevationScene {
  svg: string;
  width: number;
  height: number;
  placements: Placement[];
  face: WallFace;
  lengthCm: number;
  ceilingCm: number;
  /** Convertit un point du SVG en (position le long du mur, hauteur), en cm. */
  toCm(px: number, py: number): { u: number; v: number };
  /** Convertit (u, v) en cm vers le SVG. */
  toPx(u: number, v: number): { x: number; y: number };
}

const fmt = (cm: number): string => String(Math.round(cm));

/** Élévation d'un mur : la face vue de l'intérieur, à l'échelle, avec les cotes de pose. */
export function renderElevation(
  doc: Pick<Doc, 'items' | 'scale' | 'ceiling'>,
  room: Room,
  face: WallFace,
  o: ElevationOptions,
): ElevationScene {
  const lengthCm = faceLengthCm(doc, face);
  const ceilingCm = doc.ceiling;
  const wallW = lengthCm * K;
  const wallH = ceilingCm * K;
  const width = Math.round(ML + wallW + MR);
  const height = Math.round(MT + wallH + MB);
  const floorY = MT + wallH;

  const toPx = (u: number, v: number) => ({ x: ML + u * K, y: floorY - v * K });
  const toCm = (px: number, py: number) => ({ u: (px - ML) / K, v: (floorY - py) / K });

  const placements = symbolsOnFace(doc, face);
  const kind = getRoomKind(room.kind);
  const active = o.activeCircuit ?? null;

  let s = '';

  // Titre
  const all = roomFaces(room);
  const title = o.title ?? `${room.label.trim() || kind.name} · ${faceLabel(face, all)} · ${(lengthCm / 100).toFixed(2).replace('.', ',')} m`;
  s += `<text x="${ML}" y="22" font-size="14" font-weight="700" font-family="${FONT}" fill="#1f2430">${esc(title)}</text>`;

  // Mur, sol et plafond
  const wallAttr = o.interactive ? ' data-wall="1"' : '';
  s += `<rect${wallAttr} x="${ML}" y="${MT}" width="${wallW}" height="${wallH}" fill="${kind.color}" fill-opacity=".55" stroke="#374151" stroke-width="1.5"/>`;
  s += `<rect x="${ML - 10}" y="${floorY}" width="${wallW + 20}" height="9" fill="#cfd5df"/>`;
  s += `<line x1="${ML - 10}" y1="${floorY}" x2="${ML + wallW + 10}" y2="${floorY}" stroke="#374151" stroke-width="2"/>`;

  // Quadrillage tous les 50 cm
  let grid = '';
  for (let u = 50; u < lengthCm; u += 50) {
    const x = ML + u * K;
    grid += `<line x1="${x}" y1="${MT}" x2="${x}" y2="${floorY}"/>`;
  }
  for (let v = 50; v < ceilingCm; v += 50) {
    const y = floorY - v * K;
    grid += `<line x1="${ML}" y1="${y}" x2="${ML + wallW}" y2="${y}"/>`;
  }
  s += `<g stroke="#9aa3b2" stroke-width=".6" stroke-dasharray="2 4" opacity=".7">${grid}</g>`;

  // Règle des hauteurs (à gauche)
  for (let v = 0; v <= ceilingCm; v += 50) {
    const y = floorY - v * K;
    s += `<line x1="${ML - 7}" y1="${y}" x2="${ML}" y2="${y}" stroke="#6b7385"/>`;
    s += `<text x="${ML - 10}" y="${y + 3.5}" font-size="10" font-family="${FONT}" text-anchor="end" fill="#6b7385">${v}</text>`;
  }
  s += `<text x="${ML - 10}" y="${MT - 10}" font-size="10" font-family="${FONT}" text-anchor="end" fill="#6b7385">cm</text>`;

  const dim = (id: number, breaker: number | null): { dim: boolean; hot: boolean } => {
    void id;
    const hot = active !== null && breaker === active;
    return { hot, dim: active !== null && !hot };
  };

  // Ouvertures d'abord (arrière-plan), puis appareillage
  const ordered = [...placements].sort((p, q) => Number(q.mounting.where === 'opening') - Number(p.mounting.where === 'opening'));
  for (const p of ordered) {
    const { item, mounting: m } = p;
    const def = getSymbol(item.kind);
    const state = dim(item.id, item.breaker);
    const selected = o.interactive && item.id === o.selectedId;
    const attr = (o.interactive ? ` data-id="${item.id}" style="cursor:grab"` : '') + (state.dim ? ' opacity=".25"' : '');
    const stroke = selected ? ACCENT : '#111';

    if (m.where === 'opening') {
      const x = ML + (p.u - m.w / 2) * K;
      const top = floorY - (p.v + m.h) * K;
      const w = m.w * K;
      const h = m.h * K;
      const isWindow = item.kind === 'fenetre';
      s += `<g${attr}>`;
      s += `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${isWindow ? '#dbeafe' : '#e7d8c4'}" stroke="${stroke}" stroke-width="${selected ? 2.4 : 1.4}"/>`;
      s += isWindow
        ? `<line x1="${x + w / 2}" y1="${top}" x2="${x + w / 2}" y2="${top + h}" stroke="${stroke}"/><line x1="${x}" y1="${top + h / 2}" x2="${x + w}" y2="${top + h / 2}" stroke="${stroke}" stroke-width=".7"/>`
        : `<circle cx="${x + w - 9}" cy="${top + h * 0.52}" r="3" fill="${stroke}"/>`;
      s += `<text x="${x + w / 2}" y="${top + h + 13}" font-size="9.5" font-family="${FONT}" text-anchor="middle" fill="#445">${esc(def?.name ?? item.kind)} · ${fmt(m.w)} × ${fmt(m.h)}${isWindow ? ` · allège ${fmt(p.v)}` : ''}</text>`;
      s += `</g>`;
      continue;
    }

    // Appareillage : plaque à la hauteur de pose, avec le pictogramme du plan
    const { x, y } = toPx(p.u, p.v);
    const size = Math.max(24, Math.min(46, m.w * K));
    const glyph = def
      ? `<g transform="scale(${(size * 0.72) / 28})" stroke="${stroke}" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${def.svg}</g>`
      : '';
    s += `<g${attr} transform="translate(${x} ${y})">`;
    if (state.hot) s += `<circle r="${size * 0.8}" fill="${o.circuits?.get(item.breaker ?? -1)?.color ?? ACCENT}" fill-opacity=".18"/>`;
    s += `<rect x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}" rx="5" fill="#fff" stroke="${stroke}" stroke-width="${selected ? 2.4 : 1.3}"/>${glyph}`;
    s += `<text y="${size / 2 + 12}" font-size="10" font-weight="700" font-family="${FONT}" text-anchor="middle" fill="${selected ? ACCENT : '#1f2430'}">h ${fmt(p.v)}</text>`;
    if (item.label.trim()) {
      s += `<text y="${-size / 2 - 5}" font-size="9.5" font-family="${FONT}" text-anchor="middle" fill="#445">${esc(item.label.trim())}</text>`;
    }
    const info = item.breaker !== null ? o.circuits?.get(item.breaker) : undefined;
    if (info) {
      s += `<rect x="${size / 2 - 8}" y="${-size / 2 - 7}" width="18" height="13" rx="6.5" fill="${info.color}"/>`;
      s += `<text x="${size / 2 + 1}" y="${-size / 2 + 3}" font-size="9" font-weight="700" font-family="${FONT}" text-anchor="middle" fill="#fff">${esc(info.ref)}</text>`;
    }
    s += `</g>`;

    if (selected) {
      // Cote de hauteur : du sol à l'appareil
      s += `<g pointer-events="none" stroke="${ACCENT}" stroke-width="1" fill="${ACCENT}" font-family="${FONT}" font-size="10">`;
      s += `<line x1="${x}" y1="${y + size / 2}" x2="${x}" y2="${floorY}" stroke-dasharray="3 3"/>`;
      s += `<line x1="${ML}" y1="${y}" x2="${x - size / 2}" y2="${y}" stroke-dasharray="3 3"/>`;
      s += `</g>`;
    }
  }

  // Chaîne de cotes le long du sol : coin → appareils → coin
  const stops: number[] = [0];
  for (const p of placements) {
    if (p.mounting.where === 'opening') {
      stops.push(p.u - p.mounting.w / 2, p.u + p.mounting.w / 2);
    } else {
      stops.push(p.u);
    }
  }
  stops.push(lengthCm);
  const points = [...new Set(stops.map((u) => Math.round(Math.min(lengthCm, Math.max(0, u)))))].sort((a, b) => a - b);
  const chainY = floorY + 34;
  s += `<g font-family="${FONT}" font-size="10" fill="#1f2430" stroke="#1f2430" stroke-width="1">`;
  s += `<line x1="${ML}" y1="${chainY}" x2="${ML + wallW}" y2="${chainY}"/>`;
  for (const u of points) {
    const x = ML + u * K;
    s += `<line x1="${x}" y1="${chainY - 5}" x2="${x}" y2="${chainY + 5}"/>`;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as number;
    const b = points[i] as number;
    const gap = b - a;
    if (gap * K < 22) continue; // trop étroit pour porter une cote lisible
    s += `<text x="${ML + ((a + b) / 2) * K}" y="${chainY + 17}" text-anchor="middle" stroke="none">${gap}</text>`;
  }
  s += `</g>`;
  s += `<text x="${ML + wallW}" y="${chainY - 8}" font-size="10" font-family="${FONT}" text-anchor="end" fill="#6b7385">cotes en cm, depuis le coin de gauche</text>`;

  return {
    svg: s,
    width,
    height,
    placements,
    face,
    lengthCm,
    ceilingCm,
    toCm,
    toPx,
  };
}
