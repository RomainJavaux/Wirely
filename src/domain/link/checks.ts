import type { Check } from '../board/checks';
import { effectiveSection } from '../board/layout';
import { analyze } from '../board/layout';
import type { Board } from '../board/types';
import type { Doc } from '../types';
import { MAX_SOCKETS_BY_SECTION, allLinks } from './links';

/**
 * Contrôles qui croisent le tableau et le plan : ce qui est réellement raccordé à chaque
 * disjoncteur. Repères indicatifs inspirés de la NF C 15-100.
 */
export function runLinkChecks(doc: Pick<Doc, 'items' | 'boards' | 'scale'>, board: Board): Check[] {
  const checks: Check[] = [];
  const links = allLinks(doc);
  const a = analyze(board);

  for (const d of a.circuits) {
    const l = links.get(d.id);
    if (!l) continue;
    const section = effectiveSection(d);
    const max = section === null ? undefined : MAX_SOCKETS_BY_SECTION[section];
    if (max !== undefined && l.sockets > max) {
      const name = d.label.trim() ? ` « ${d.label.trim()} »` : '';
      checks.push({
        severity: 'warn',
        deviceId: d.id,
        message: `Circuit ${a.refs.get(d.id)}${name} : ${l.sockets} prises raccordées, ${max} conseillées au maximum en ${String(section).replace('.', ',')} mm² (indicatif).`,
      });
    }
  }
  return checks;
}
