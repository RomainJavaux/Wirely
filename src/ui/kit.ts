import { USAGES } from '../domain/board/catalog';
import { analyze, effectiveSection, effectiveUsage, isCircuitRole } from '../domain/board/layout';
import { getDeviceDef } from '../domain/board/catalog';
import type { Board, Device } from '../domain/board/types';
import { getSymbol } from '../domain/catalog';
import { allLinks, type CircuitLinks } from '../domain/link/links';
import { rulesOf, type LoadLimit } from '../domain/rules';
import type { Country, Doc } from '../domain/types';
import { GLYPH_ATTRS } from '../render/items';
import { esc } from '../util/escape';

/** Petits outils partagés par les écrans : pluriels, événements délégués, pictogrammes, circuits. */

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;

/**
 * Écoute un événement sur `root` pour tous les éléments qui répondent à `selector`, présents ou à
 * venir : les écrans se redessinent sans avoir à rebrancher leurs boutons.
 */
export function delegate<K extends keyof HTMLElementEventMap>(
  root: HTMLElement,
  type: K,
  selector: string,
  handler: (el: HTMLElement, event: HTMLElementEventMap[K]) => void,
): void {
  root.addEventListener(type, (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
    if (target && root.contains(target)) handler(target, event);
  });
}

const PATHS: Readonly<Record<string, string>> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  warn: '<path d="M12 4 3 19h18L12 4Z"/><path d="M12 10v4M12 17v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  print: '<path d="M7 8V4h10v4M7 17H5a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/>',
  bolt: '<path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  wand: '<path d="m5 19 10-10M14 6l1-2 1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM6 5l.6 1.4L8 7l-1.4.6L6 9l-.6-1.4L4 7l1.4-.6L6 5Z"/>',
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  file: '<path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M15 3v4h4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

/** Petit drapeau dessiné (les drapeaux en caractères ne s'affichent pas partout). */
export function flag(country: Country): string {
  const c = country === 'BE' ? ['#1a1a1a', '#fdda24', '#ef3340'] : ['#0055a4', '#ffffff', '#ef4135'];
  return `<svg class="flag" viewBox="0 0 3 2" width="18" height="12" aria-hidden="true"><rect width="1" height="2" fill="${c[0]}"/><rect x="1" width="1" height="2" fill="${c[1]}"/><rect x="2" width="1" height="2" fill="${c[2]}"/></svg>`;
}

/** Pictogramme au trait (24 × 24). */
export const icon = (name: string, size = 18): string =>
  `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;

/** Pictogramme d'un symbole du plan (prise, lampe…). */
export function glyph(kind: string, size = 30): string {
  const def = getSymbol(kind);
  if (!def) return '';
  return `<svg class="glyph" viewBox="${def.viewBox ?? '-18 -18 36 36'}" width="${size}" height="${size}" ${GLYPH_ATTRS} aria-hidden="true">${def.svg}</svg>`;
}

/** Anneau d'avancement (0 à 1), avec un texte au centre. */
export function ring(ratio: number, label: string, size = 64, color = 'var(--accent)'): string {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, ratio));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="6"/>
    <circle class="ring-val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${v >= 1 ? 'var(--ok)' : color}" stroke-width="6"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dy=".35em" text-anchor="middle" class="ring-text">${esc(label)}</text>
  </svg>`;
}

// ---------------------------------------------------------------- circuits

export interface CircuitView {
  device: Device;
  board: Board;
  ref: string;
  color: string;
  /** Désignation, ou un libellé par défaut d'après l'usage. */
  name: string;
  /** Différentiel amont (null : aucun). */
  rcd: Device | null;
  links: CircuitLinks | undefined;
  section: number | null;
  load: LoadLimit;
  /** Vrai si le circuit dépasse la limite du pays. */
  over: boolean;
}

/** Tous les circuits du chantier, avec ce qu'il faut pour les afficher (repère, couleur, charge). */
export function circuitViews(doc: Doc): CircuitView[] {
  const rules = rulesOf(doc);
  const links = allLinks(doc);
  const out: CircuitView[] = [];
  for (const board of doc.boards) {
    const a = analyze(board, rules.refScheme);
    for (const d of a.circuits) {
      const def = getDeviceDef(d.kind);
      if (!def || !isCircuitRole(def)) continue;
      const usage = USAGES[effectiveUsage(d)];
      const l = links.get(d.id);
      const section = effectiveSection(d);
      const load = rules.limit({ sockets: l?.sockets ?? 0, lights: l?.lights ?? 0, fixed: l?.fixed ?? 0 }, section ?? 2.5);
      out.push({
        device: d,
        board,
        ref: a.refs.get(d.id) ?? '',
        color: usage.color,
        name: d.label.trim() || usage.name,
        rcd: a.protectedBy.get(d.id) ?? null,
        links: l,
        section,
        load,
        over: load.max !== null && load.used > load.max,
      });
    }
  }
  return out;
}

/** Pastille d'un circuit : sa lettre (ou son numéro) sur sa couleur. */
export const circuitBadge = (ref: string, color: string, extra = ''): string =>
  `<span class="cbadge${ref.length > 2 ? ' long' : ''} ${extra}" style="--c:${color}">${esc(ref)}</span>`;

/** Jauge de charge d'un circuit : « 5 / 8 points ». */
export function loadMeter(load: LoadLimit): string {
  if (load.max === null) {
    const unit = load.used > 1 ? load.unit : load.unit.replace(/s$/, '');
    return load.used > 0 ? `<span class="load">${load.used} ${esc(unit)}</span>` : '';
  }
  const ratio = Math.min(1, load.used / load.max);
  const state = load.used > load.max ? 'over' : load.used === load.max ? 'full' : '';
  return `<span class="load ${state}" title="${load.used} ${esc(load.unit)} sur ${load.max} au maximum">
    <i><b style="width:${Math.round(ratio * 100)}%"></b></i>${load.used} / ${load.max}</span>`;
}
