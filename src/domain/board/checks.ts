import { MAX_RATING_FOR_SECTION, getDeviceDef } from './catalog';
import { analyze, devicesInRow, deviceWidth, effectiveSection, isCircuitRole } from './layout';
import type { Board } from './types';

export type Severity = 'error' | 'warn' | 'info';

export interface Check {
  severity: Severity;
  message: string;
  /** Appareil concerné (sélectionné au clic). */
  deviceId?: number;
}

/**
 * Nombre de circuits conseillé par différentiel 30 mA, selon son calibre.
 * Repères indicatifs inspirés de la NF C 15-100 : à vérifier pour chaque installation.
 */
const MAX_CIRCUITS_PER_RCD: Readonly<Record<number, number>> = { 25: 5, 40: 8, 63: 13 };
/** Réserve de place recommandée dans le tableau. */
export const RESERVE_RATIO = 0.2;

/**
 * Contrôles simples d'aide à la conception. Ils ne remplacent pas la vérification
 * d'un professionnel ni les règles de la norme en vigueur.
 */
export function runChecks(board: Board): Check[] {
  const checks: Check[] = [];
  const a = analyze(board);

  for (const d of board.devices) {
    const w = deviceWidth(d);
    if (d.row >= board.rows || d.col + w > board.cols) {
      checks.push({ severity: 'error', deviceId: d.id, message: `${a.refs.get(d.id) ?? getDeviceDef(d.kind)?.name ?? 'Appareil'} dépasse du rail.` });
    }
  }

  for (const d of a.circuits) {
    const ref = `Circuit ${a.refs.get(d.id)}`;
    const name = d.label ? ` « ${d.label} »` : '';
    const def = getDeviceDef(d.kind);
    if (!def || !isCircuitRole(def)) continue;

    const section = effectiveSection(d);
    if (section !== null && d.rating !== null) {
      const max = MAX_RATING_FOR_SECTION[section];
      if (max !== undefined && d.rating > max) {
        checks.push({
          severity: 'error',
          deviceId: d.id,
          message: `${ref}${name} : ${d.rating} A est trop élevé pour du ${String(section).replace('.', ',')} mm² (max ${max} A).`,
        });
      }
    }

    const rcd = a.protectedBy.get(d.id) ?? null;
    if (!rcd) {
      checks.push({ severity: 'warn', deviceId: d.id, message: `${ref}${name} : aucun différentiel en amont sur ce rail.` });
    } else if ((rcd.sensitivity ?? 30) > 30) {
      checks.push({ severity: 'warn', deviceId: d.id, message: `${ref}${name} : différentiel ${rcd.sensitivity} mA (30 mA attendu en habitation).` });
    }

    if (!d.label.trim()) {
      checks.push({ severity: 'info', deviceId: d.id, message: `${ref} : désignation manquante.` });
    }
  }

  for (const g of a.groups) {
    if (!g.head || g.head.rating === null) continue;
    const limit = MAX_CIRCUITS_PER_RCD[g.head.rating];
    const count = g.members.filter((m) => {
      const def = getDeviceDef(m.kind);
      return def !== undefined && isCircuitRole(def);
    }).length;
    if (limit !== undefined && count > limit) {
      checks.push({
        severity: 'warn',
        deviceId: g.head.id,
        message: `${a.refs.get(g.head.id)} (${g.head.rating} A) alimente ${count} circuits : ${limit} maximum conseillé (indicatif).`,
      });
    }
  }

  checks.push(...busChecks(board));

  for (const d of board.devices) {
    const def = getDeviceDef(d.kind);
    if (def?.unverified) {
      checks.push({ severity: 'info', deviceId: d.id, message: `${def.name} (${def.ref ?? ''}) : ${def.unverified}` });
    }
  }

  if (a.totalModules > 0 && board.devices.length > 0) {
    const free = a.totalModules - a.usedModules;
    if (free / a.totalModules < RESERVE_RATIO) {
      checks.push({
        severity: 'info',
        message: `Réserve de place : ${free} module${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''} sur ${a.totalModules} (${Math.round((free / a.totalModules) * 100)} %, 20 % recommandés).`,
      });
    }
  }

  return checks;
}

/** Modules qui doivent ouvrir un rail Niko Home Control (alimentation du bus). */
const NHC_RAIL_START = new Set(['nhc_cc', 'nhc_ps', 'nhc_rc']);

/**
 * Règles de montage du bus Niko Home Control II, d'après les fiches Niko :
 * un seul contrôleur connecté par installation, et une alimentation ou un accoupleur de rail
 * à l'extrémité gauche de chaque rail portant des modules du bus.
 */
function busChecks(board: Board): Check[] {
  const out: Check[] = [];
  const nhc = board.devices.filter((d) => getDeviceDef(d.kind)?.system === 'nhc2');
  if (nhc.length === 0) return out;

  const controllers = nhc.filter((d) => d.kind === 'nhc_cc');
  if (controllers.length === 0) {
    out.push({ severity: 'info', message: 'Niko Home Control : aucun contrôleur connecté (un seul est nécessaire par installation).' });
  }
  for (const extra of controllers.slice(1)) {
    out.push({ severity: 'warn', deviceId: extra.id, message: 'Niko Home Control : un seul contrôleur connecté par installation.' });
  }

  for (let row = 0; row < board.rows; row++) {
    const inRow = devicesInRow(board, row);
    if (!inRow.some((d) => getDeviceDef(d.kind)?.system === 'nhc2')) continue;
    const first = inRow[0];
    if (first && !NHC_RAIL_START.has(first.kind)) {
      out.push({
        severity: 'warn',
        deviceId: first.id,
        message: `Rail ${row + 1} : une alimentation ou un accoupleur de rail Niko doit être placé tout à gauche.`,
      });
    }
  }
  return out;
}
