import { effectiveSection } from '../board/layout';
import type { Board, Device } from '../board/types';
import { toMeters } from '../plan/metrics';
import type { Doc, Point, SymbolItem } from '../types';
import { effectiveHeight, isCeilingKind } from '../walls/mounting';
import { allLinks, locateDevice, symbolOfBoard, tableauSymbols } from './links';

/**
 * Longueur de câble estimée d'un circuit, sans tracé manuel : on part du tableau, on relie les
 * appareils de proche en proche (distances en L, comme un câble qui suit les murs), on ajoute les
 * descentes depuis le plafond et une marge de pose. Une estimation de métré, pas un tirage de câble.
 */

/** Marge de pose (coupes, boucles, chutes). */
const SLACK = 1.15;
/** Hauteur de départ du câble au-dessus du tableau et dans le plafond (cm sous plafond). */
const CEILING_RUN = 15;

export interface CircuitRoute {
  /** Tracé en plan : du tableau aux appareils, en segments horizontaux puis verticaux. */
  points: Point[];
  /** Longueur de câble estimée, en mètres, descentes comprises. */
  length: number;
  /** Appareils desservis. */
  count: number;
}

const manhattan = (a: Point, b: Point): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Appareils raccordés à un disjoncteur (hors ouvertures, qui n'ont pas de câble). */
const served = (doc: Pick<Doc, 'items'>, deviceId: number): SymbolItem[] =>
  doc.items.filter((i): i is SymbolItem => i.type === 'symbol' && i.breaker === deviceId);

/** Tableau d'où part le circuit : le symbole du tableau qui le porte, à défaut le premier du plan. */
function originOf(doc: Pick<Doc, 'items' | 'boards'>, device: Device): SymbolItem | undefined {
  const located = locateDevice(doc, device.id);
  const own = located ? symbolOfBoard(doc, (located.board as Board).id) : undefined;
  return own ?? tableauSymbols(doc)[0];
}

/** Estimation du circuit ; null s'il n'y a rien de raccordé. */
export function estimateRoute(doc: Pick<Doc, 'items' | 'boards' | 'scale' | 'ceiling'>, device: Device): CircuitRoute | null {
  const targets = served(doc, device.id);
  if (targets.length === 0) return null;

  const origin = originOf(doc, device);
  const remaining = targets.map((s) => ({ s, p: [s.x, s.y] as Point }));
  const startPoint: Point | null = origin ? [origin.x, origin.y] : null;

  const path: Point[] = [];
  let cursor: Point;
  let horizontal = 0;
  if (startPoint) {
    path.push(startPoint);
    cursor = startPoint;
  } else {
    // Sans tableau sur le plan, le premier appareil sert de départ : la longueur reste une borne basse.
    const first = remaining.shift();
    if (!first) return null;
    path.push(first.p);
    cursor = first.p;
  }

  while (remaining.length > 0) {
    let bestIndex = 0;
    let best = Infinity;
    remaining.forEach((r, i) => {
      const d = manhattan(cursor, r.p);
      if (d < best) {
        best = d;
        bestIndex = i;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    if (!next) break;
    // Coude : on longe d'abord horizontalement, puis verticalement.
    if (cursor[0] !== next.p[0] && cursor[1] !== next.p[1]) path.push([next.p[0], cursor[1]]);
    path.push(next.p);
    horizontal += best;
    cursor = next.p;
  }

  // Descentes : le câble court au plafond puis descend à chaque appareil de mur.
  const ceiling = doc.ceiling;
  let vertical = 0;
  for (const s of targets) {
    vertical += isCeilingKind(s.kind) ? CEILING_RUN : Math.max(0, ceiling - effectiveHeight(s));
  }
  if (origin) vertical += Math.max(0, ceiling - effectiveHeight(origin));

  const length = (toMeters(doc.scale, horizontal) + vertical / 100) * SLACK;
  return { points: path, length, count: targets.length };
}

export interface CableEstimate {
  section: number;
  /** Longueur totale estimée pour cette section, en mètres. */
  length: number;
  circuits: number;
}

/**
 * Câble à prévoir par section, d'après les circuits raccordés qui n'ont pas de tracé manuel
 * (un câble dessiné est déjà mesuré ailleurs).
 */
export function estimateCables(doc: Pick<Doc, 'items' | 'boards' | 'scale' | 'ceiling'>): CableEstimate[] {
  const links = allLinks(doc);
  const bySection = new Map<number, CableEstimate>();
  for (const board of doc.boards) {
    for (const d of board.devices) {
      const l = links.get(d.id);
      if (!l || l.symbols.length === 0 || l.wires.length > 0) continue;
      const section = effectiveSection(d);
      const route = estimateRoute(doc, d);
      if (section === null || !route) continue;
      const entry = bySection.get(section) ?? { section, length: 0, circuits: 0 };
      entry.length += route.length;
      entry.circuits += 1;
      bySection.set(section, entry);
    }
  }
  return [...bySection.values()].sort((a, b) => a.section - b.section);
}
