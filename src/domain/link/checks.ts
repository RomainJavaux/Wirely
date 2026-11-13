import type { Check } from '../board/checks';
import { analyze, effectiveSection } from '../board/layout';
import type { Board } from '../board/types';
import { roomAt, roomsOf } from '../plan/metrics';
import { TYPE_A_APPLIANCE, WET_APPLIANCE, rulesOf } from '../rules';
import type { Doc } from '../types';
import { allLinks } from './links';

const fmtSection = (s: number): string => `${String(s).replace('.', ',')} mm²`;

/**
 * Contrôles qui croisent le tableau et les points : ce qui est réellement raccordé à chaque
 * disjoncteur, comparé aux règles du pays du chantier. Repères indicatifs.
 */
export function runLinkChecks(doc: Pick<Doc, 'items' | 'boards' | 'scale' | 'project'>, board: Board): Check[] {
  const checks: Check[] = [];
  const rules = rulesOf(doc);
  const be = rules.country === 'BE';
  const links = allLinks(doc);
  const a = analyze(board, rules.refScheme);
  const rooms = roomsOf(doc.items);

  for (const d of a.circuits) {
    const l = links.get(d.id);
    if (!l) continue;
    const section = effectiveSection(d);
    const name = d.label.trim() ? ` « ${d.label.trim()} »` : '';
    const ref = `Circuit ${a.refs.get(d.id)}${name}`;

    const limit = rules.limit({ sockets: l.sockets, lights: l.lights, fixed: l.fixed }, section ?? 2.5);
    if (limit.max !== null && limit.used > limit.max) {
      checks.push({
        severity: 'warn',
        deviceId: d.id,
        message: `${ref} : ${limit.used} ${limit.unit}, ${limit.max} au maximum (${rules.code}).`,
      });
    }

    if (l.sockets > 0 && section !== null && section < rules.socketMinSection) {
      checks.push({
        severity: 'error',
        deviceId: d.id,
        message: `${ref} : des prises en ${fmtSection(section)}, ${fmtSection(rules.socketMinSection)} au minimum (${rules.code}).`,
      });
    }

    const rcd = a.protectedBy.get(d.id) ?? null;
    const labels = [d.label, ...l.symbols.map((s) => s.label)].join(' ');
    if (be) {
      // Salle de bains, douche, lave-linge, sèche-linge, lave-vaisselle : différentiel de 30 mA.
      const wetRoom = l.symbols.some((s) => roomAt(rooms, s.x, s.y)?.kind === 'sdb');
      const needs30 = wetRoom || WET_APPLIANCE.test(labels);
      if (needs30 && (!rcd || (rcd.sensitivity ?? 30) > 30)) {
        checks.push({
          severity: 'warn',
          deviceId: d.id,
          message: `${ref} : ${wetRoom ? 'alimente une salle de bains' : 'appareil en milieu humide'}, différentiel de 30 mA attendu (${rules.code}).`,
        });
      }
    } else if (rcd && rcd.diffType === 'AC' && TYPE_A_APPLIANCE.test(labels)) {
      checks.push({
        severity: 'warn',
        deviceId: d.id,
        message: `${ref} : différentiel de type A attendu pour cet appareil (${rules.code}).`,
      });
    }
  }
  return checks;
}
