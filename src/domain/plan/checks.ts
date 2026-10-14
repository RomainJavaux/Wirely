import { unlinkedItems } from '../link/links';
import type { Doc } from '../types';
import { getRoomKind } from './roomKinds';
import { fmtArea, roomStats } from './metrics';

export type PlanSeverity = 'warn' | 'info';

export interface PlanCheck {
  severity: PlanSeverity;
  message: string;
  /** Élément concerné (sélectionné au clic). */
  itemId?: number;
}

/**
 * Contrôles simples d'aide à la conception, pièce par pièce. Les minimums sont des repères
 * indicatifs inspirés de la NF C 15-100 : ils ne remplacent ni la norme ni un professionnel.
 */
export function runPlanChecks(doc: Pick<Doc, 'items' | 'scale'> & Partial<Pick<Doc, 'boards'>>): PlanCheck[] {
  const checks: PlanCheck[] = [];
  const stats = roomStats(doc);
  if (stats.length === 0) return checks;

  for (const s of stats) {
    const kind = getRoomKind(s.room.kind);
    const name = s.room.label.trim() || kind.name;
    const where = `${name} (${fmtArea(s.area)})`;

    if (kind.minSockets) {
      const min = kind.minSockets(s.area);
      if (s.sockets < min) {
        checks.push({
          severity: 'warn',
          itemId: s.room.id,
          message: `${where} : ${s.sockets} prise${s.sockets > 1 ? 's' : ''}, ${min} conseillée${min > 1 ? 's' : ''}.`,
        });
      }
    }
    if (kind.minLights > 0 && s.lights < kind.minLights) {
      checks.push({ severity: 'warn', itemId: s.room.id, message: `${where} : aucun point lumineux.` });
    }
    if (!s.room.label.trim() && kind.id === 'autre') {
      checks.push({ severity: 'info', itemId: s.room.id, message: `Pièce de ${fmtArea(s.area)} sans nom ni type.` });
    }
  }

  // Raccordement : n'a de sens que s'il existe un tableau auquel raccorder.
  if ((doc.boards?.length ?? 0) > 0) {
    const u = unlinkedItems(doc);
    const n = u.wires.length + u.symbols.length;
    if (n > 0) {
      const parts: string[] = [];
      if (u.wires.length) parts.push(`${u.wires.length} câble${u.wires.length > 1 ? 's' : ''}`);
      if (u.symbols.length) parts.push(`${u.symbols.length} appareil${u.symbols.length > 1 ? 's' : ''}`);
      checks.push({ severity: 'info', message: `${parts.join(' et ')} non raccordé${n > 1 ? 's' : ''} à un disjoncteur.` });
    }
  }

  const hasSmoke = doc.items.some((i) => i.type === 'symbol' && i.kind === 'fumee');
  if (!hasSmoke) {
    checks.push({ severity: 'info', message: 'Aucun détecteur de fumée sur le plan (obligatoire dans un logement).' });
  }
  return checks;
}
