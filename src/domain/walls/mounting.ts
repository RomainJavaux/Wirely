import type { SymbolItem } from '../types';

/**
 * Où et à quelle hauteur se pose chaque type de symbole. Les valeurs sont des repères d'usage
 * courants (en cm) : elles servent de hauteur par défaut tant que l'utilisateur n'en a pas fixé une.
 */
export type MountPlace = 'wall' | 'ceiling' | 'opening';

export interface Mounting {
  where: MountPlace;
  /** Hauteur de pose en cm (pour une ouverture : hauteur d'allège, de 0 pour une porte). */
  height: number;
  /** Largeur et hauteur de l'objet, en cm (dessin des élévations et de la 3D). */
  w: number;
  h: number;
}

const wall = (height: number, w: number, h: number): Mounting => ({ where: 'wall', height, w, h });
const ceiling = (w: number, h: number): Mounting => ({ where: 'ceiling', height: 250, w, h });

const MOUNTING: Readonly<Record<string, Mounting>> = {
  prise: wall(30, 8, 8),
  prise_s: wall(30, 8, 8),
  rj45: wall(30, 8, 8),
  tv: wall(30, 8, 8),
  inter: wall(110, 8, 8),
  va: wall(110, 8, 8),
  poussoir: wall(110, 8, 8),
  thermo: wall(150, 10, 10),
  lampe: ceiling(24, 24),
  spot: ceiling(10, 10),
  fumee: ceiling(12, 12),
  vmc: ceiling(20, 20),
  applique: wall(190, 18, 14),
  radia: wall(15, 80, 50),
  ce: wall(150, 45, 60),
  vr: wall(220, 20, 20),
  sonnette: wall(150, 10, 10),
  tableau: wall(150, 40, 55),
  compteur: wall(140, 25, 35),
  deriv: wall(200, 10, 10),
  porte: { where: 'opening', height: 0, w: 90, h: 204 },
  fenetre: { where: 'opening', height: 90, w: 120, h: 120 },
};

const DEFAULT_MOUNTING: Mounting = wall(100, 12, 12);

export const mountingOf = (kind: string): Mounting => MOUNTING[kind] ?? DEFAULT_MOUNTING;

/** Hauteur de pose retenue (cm) : celle saisie, sinon la hauteur usuelle du type. */
export const effectiveHeight = (s: Pick<SymbolItem, 'kind' | 'height'>): number =>
  s.height ?? mountingOf(s.kind).height;

export const isOpeningKind = (kind: string): boolean => mountingOf(kind).where === 'opening';
export const isCeilingKind = (kind: string): boolean => mountingOf(kind).where === 'ceiling';
