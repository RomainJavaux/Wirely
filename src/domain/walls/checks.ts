import type { Doc } from '../types';
import { faceLabel, roomFaces, symbolsOnFace, type WallFace } from './faces';
import type { Room } from '../types';

export interface WallCheck {
  severity: 'warn' | 'info';
  message: string;
  itemId: number;
}

/** Hauteurs de repère (cm), indicatives : le bas d'une prise et le haut d'une commande accessible. */
export const MIN_SOCKET_HEIGHT = 5;
export const MAX_SWITCH_HEIGHT = 130;

/**
 * Contrôles d'un mur : hauteurs de pose. Repères indicatifs inspirés de la NF C 15-100 et des règles
 * d'accessibilité, à vérifier pour chaque installation.
 */
export function runWallChecks(doc: Pick<Doc, 'items' | 'scale'>, room: Room, face: WallFace): WallCheck[] {
  const checks: WallCheck[] = [];
  const label = faceLabel(face, roomFaces(room));
  for (const p of symbolsOnFace(doc, face)) {
    const name = p.item.label.trim() || p.item.kind;
    if (['prise', 'prise_s', 'rj45', 'tv'].includes(p.item.kind) && p.v < MIN_SOCKET_HEIGHT) {
      checks.push({
        severity: 'warn',
        itemId: p.item.id,
        message: `${label} : « ${name} » à ${Math.round(p.v)} cm, ${MIN_SOCKET_HEIGHT} cm minimum du sol conseillés.`,
      });
    }
    if (['inter', 'va', 'poussoir', 'thermo'].includes(p.item.kind) && p.v > MAX_SWITCH_HEIGHT) {
      checks.push({
        severity: 'info',
        itemId: p.item.id,
        message: `${label} : « ${name} » à ${Math.round(p.v)} cm, au-dessus de ${MAX_SWITCH_HEIGHT} cm (commande peu accessible).`,
      });
    }
  }
  return checks;
}
