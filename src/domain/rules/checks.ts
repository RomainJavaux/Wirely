import { runChecks } from '../board/checks';
import { analyze } from '../board/layout';
import { runLinkChecks } from '../link/checks';
import { allLinks, isElectrical, tableauSymbols } from '../link/links';
import { LIGHT_KINDS } from '../catalog';
import { planNeeds, symbolsByRoom } from '../plan/needs';
import { allPoints } from '../points';
import type { Doc } from '../types';
import { rulesOf } from './index';

/**
 * Liste de contrôle du chantier : ce que le contrôleur relèverait, selon les règles du pays, avec
 * l'endroit où le corriger. Repères indicatifs : ils ne remplacent pas l'organisme de contrôle.
 */

export type Where = 'home' | 'rooms' | 'board' | 'plan' | 'dossier';

export interface ProjectCheck {
  severity: 'error' | 'warn' | 'info';
  text: string;
  /** Espace de l'outil où l'on corrige. */
  where: Where;
  roomId?: number;
  deviceId?: number;
  /** Action directe proposée : raccorder automatiquement, valider les positions. */
  action?: 'connect' | 'verify';
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;

export function runProjectChecks(doc: Doc): ProjectCheck[] {
  const rules = rulesOf(doc);
  const be = rules.country === 'BE';
  const out: ProjectCheck[] = [];
  const points = allPoints(doc);
  const electrical = points.filter(isElectrical);
  const unlinked = electrical.filter((p) => p.breaker === null);

  // --- Points et circuits
  if (electrical.length > 0 && doc.boards.length === 0) {
    out.push({
      severity: 'warn',
      text: `Aucun tableau : ${plural(electrical.length, 'point')} sans circuit.`,
      where: 'board',
      action: 'connect',
    });
  } else if (unlinked.length > 0) {
    out.push({
      severity: 'warn',
      text: `${plural(unlinked.length, 'point')} sans circuit : ${unlinked.length > 1 ? 'ils n’apparaîtront' : 'il n’apparaîtra'} pas sur le schéma unifilaire.`,
      where: 'rooms',
      action: 'connect',
    });
  }

  // --- Tableaux : protections, sections, différentiels, charge des circuits
  const links = allLinks(doc);
  let lightingCircuits = 0;
  for (const board of doc.boards) {
    for (const c of [...runChecks(board, rules), ...runLinkChecks(doc, board)]) {
      // La réserve de place et les désignations manquantes sont rappelées dans le tableau lui-même.
      if (c.severity === 'info') continue;
      out.push({ severity: c.severity, text: c.message, where: 'board', ...(c.deviceId !== undefined ? { deviceId: c.deviceId } : {}) });
    }
    const a = analyze(board, rules.refScheme);
    for (const d of a.circuits) {
      const l = links.get(d.id);
      if ((l?.lights ?? 0) > 0) lightingCircuits += 1;
      if (points.length > 0 && (l?.symbols.length ?? 0) === 0) {
        const name = d.label.trim() ? ` « ${d.label.trim()} »` : '';
        out.push({ severity: 'info', text: `Circuit ${a.refs.get(d.id)}${name} : aucun point raccordé.`, where: 'board', deviceId: d.id });
      }
      if (!d.label.trim()) {
        out.push({ severity: 'info', text: `Circuit ${a.refs.get(d.id)} : désignation manquante.`, where: 'board', deviceId: d.id });
      }
    }
  }

  // --- Éclairage réparti sur plusieurs circuits
  let litRooms = 0;
  for (const list of symbolsByRoom(doc).values()) if (list.some((x) => LIGHT_KINDS.has(x.kind))) litRooms += 1;
  if (lightingCircuits > 0 && lightingCircuits < rules.minLightingCircuits && litRooms > 2) {
    out.push({
      severity: be ? 'warn' : 'info',
      text: `Un seul circuit d’éclairage : ${rules.minLightingCircuits} au minimum (${rules.code}).`,
      where: 'board',
    });
  }

  // --- France : minimums par pièce
  if (!be) {
    for (const r of planNeeds(doc)) {
      if (r.missing > 0 && r.required > 0) {
        out.push({
          severity: 'info',
          text: `${r.name} : ${plural(r.missing, 'point')} sous les minimums (${rules.code}).`,
          where: 'rooms',
          roomId: r.room.id,
        });
      }
    }
  }

  // --- Plan : positions et tableau situé
  const rough = points.filter((p) => p.rough === true).length;
  if (rough > 0) {
    out.push({
      severity: 'info',
      text: `${plural(rough, 'position')} à vérifier sur le plan (${rough > 1 ? 'points posés' : 'point posé'} automatiquement).`,
      where: 'plan',
      action: 'verify',
    });
  }
  if (doc.boards.length > 0 && points.length > 0 && tableauSymbols(doc).length === 0) {
    out.push({ severity: 'info', text: `Le tableau n’est pas situé sur le plan : il doit figurer sur le ${rules.docs.position.toLowerCase()}.`, where: 'plan' });
  }

  // --- Mentions portées sur les documents
  if (points.length > 0) {
    if (!doc.project.address.trim()) {
      out.push({ severity: 'warn', text: 'Adresse de l’installation manquante : elle figure sur chaque schéma.', where: 'home' });
    }
    if (!doc.project.installer.trim()) {
      out.push({ severity: 'info', text: 'Installateur non renseigné (cartouche des documents).', where: 'home' });
    }
  }

  const rank = { error: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface Step {
  key: 'points' | 'circuits' | 'plan' | 'dossier';
  label: string;
  /** Avancement de 0 à 1. */
  ratio: number;
  done: boolean;
  text: string;
  where: Where;
}

export interface Progress {
  rooms: number;
  points: number;
  circuits: number;
  steps: Step[];
  /** Avancement global, en pourcentage. */
  percent: number;
  /** Remarques bloquantes ou importantes restantes. */
  issues: number;
}

/** Avancement du chantier : points comptés, circuits raccordés, plan vérifié, dossier prêt. */
export function projectProgress(doc: Doc): Progress {
  const points = allPoints(doc);
  const electrical = points.filter(isElectrical);
  const linked = electrical.filter((p) => p.breaker !== null).length;
  const verified = points.filter((p) => p.rough !== true).length;
  const rooms = doc.items.filter((i) => i.type === 'room').length;
  const circuits = doc.boards.reduce((n, b) => n + analyze(b).circuits.length, 0);
  const checks = runProjectChecks(doc);
  const issues = checks.filter((c) => c.severity !== 'info').length;
  const filled = doc.project.address.trim() !== '' && doc.project.installer.trim() !== '';

  const ratio = (a: number, b: number): number => (b === 0 ? 0 : a / b);
  const steps: Step[] = [
    {
      key: 'points',
      label: 'Pièces et points',
      ratio: points.length > 0 ? 1 : rooms > 0 ? 0.3 : 0,
      done: points.length > 0,
      text: points.length > 0 ? `${plural(points.length, 'point')} dans ${plural(rooms, 'pièce')}` : rooms > 0 ? `${plural(rooms, 'pièce')}, aucun point` : 'Rien de compté',
      where: 'rooms',
    },
    {
      key: 'circuits',
      label: 'Circuits',
      ratio: ratio(linked, electrical.length),
      done: electrical.length > 0 && linked === electrical.length,
      text: electrical.length === 0 ? `${plural(circuits, 'circuit')}` : `${linked} / ${electrical.length} points raccordés · ${plural(circuits, 'circuit')}`,
      where: 'board',
    },
    {
      key: 'plan',
      label: 'Plan',
      ratio: ratio(verified, points.length),
      done: points.length > 0 && verified === points.length,
      text: points.length === 0 ? 'Aucun point à situer' : `${verified} / ${points.length} positions vérifiées`,
      where: 'plan',
    },
    {
      key: 'dossier',
      label: 'Dossier',
      ratio: points.length === 0 ? 0 : (issues === 0 ? 0.6 : 0) + (filled ? 0.4 : 0),
      done: points.length > 0 && issues === 0 && filled,
      text: points.length === 0 ? 'À préparer' : issues > 0 ? `${plural(issues, 'remarque')} à lever` : filled ? 'Prêt à imprimer' : 'Mentions à compléter',
      where: 'dossier',
    },
  ];
  const percent = Math.round((steps.reduce((t, s) => t + s.ratio, 0) / steps.length) * 100);
  return { rooms, points: points.length, circuits, steps, percent, issues };
}
