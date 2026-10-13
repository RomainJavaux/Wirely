import type { Curve, DeviceKind, DiffType, UsageId } from './types';

export interface Variant {
  id: string;
  label: string;
  /** Largeur en modules de 17,5 mm. */
  width: number;
}

/**
 * Rôle électrique de l'appareil, utilisé pour déduire les groupes protégés :
 * - feeder : appareil d'arrivée (branchement, sectionneur)
 * - rcd    : interrupteur différentiel, protège les disjoncteurs à sa droite sur le rail
 * - rcbo   : disjoncteur différentiel (protège son propre circuit)
 * - breaker: disjoncteur de circuit
 * - aux    : appareil de commande, de signalisation ou de raccordement
 */
export type Role = 'feeder' | 'rcd' | 'rcbo' | 'breaker' | 'aux';

export interface DeviceDef {
  id: DeviceKind;
  category: string;
  name: string;
  /** Abréviation affichée sur l'appareil. */
  short: string;
  role: Role;
  /** Préfixe du repère (ex. « ID » → ID1, ID2). Vide pour les circuits (numérotés 1, 2, 3…). */
  refPrefix: string;
  variants: readonly Variant[];
  defaultVariant: string;
  ratings?: readonly number[];
  defaultRating?: number;
  curves?: readonly Curve[];
  defaultCurve?: Curve;
  sensitivities?: readonly number[];
  defaultSensitivity?: number;
  diffTypes?: readonly DiffType[];
  defaultDiffType?: DiffType;
}

const modules = (n: number): Variant[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i + 1), label: `${i + 1} module${i ? 's' : ''}`, width: i + 1 }));

export const BREAKER_RATINGS = [2, 6, 10, 16, 20, 25, 32, 40, 50, 63] as const;
const CURVES = ['B', 'C', 'D'] as const;
const DIFF_TYPES = ['AC', 'A', 'F', 'HI'] as const;

export const DEVICES: readonly DeviceDef[] = [
  // --- Protection générale
  {
    id: 'agcp', category: 'Protection générale', name: 'Disjoncteur de branchement', short: 'AGCP',
    role: 'feeder', refPrefix: 'AGCP',
    variants: [{ id: '2P', label: '2P', width: 3 }], defaultVariant: '2P',
    ratings: [15, 30, 45, 60], defaultRating: 30,
  },
  {
    id: 'sect', category: 'Protection générale', name: 'Interrupteur-sectionneur', short: 'SG',
    role: 'feeder', refPrefix: 'SG',
    variants: [{ id: '2P', label: '2P', width: 2 }, { id: '4P', label: '4P', width: 4 }], defaultVariant: '2P',
    ratings: [40, 63, 100, 125], defaultRating: 63,
  },
  {
    id: 'para', category: 'Protection générale', name: 'Parafoudre', short: 'SPD',
    role: 'aux', refPrefix: 'SPD',
    variants: [{ id: '1P+N', label: '1P+N', width: 2 }, { id: '3P+N', label: '3P+N', width: 4 }], defaultVariant: '1P+N',
  },

  // --- Différentiels
  {
    id: 'idiff', category: 'Différentiels', name: 'Interrupteur différentiel', short: 'ID',
    role: 'rcd', refPrefix: 'ID',
    variants: [{ id: '2P', label: '2P', width: 2 }, { id: '4P', label: '4P', width: 4 }], defaultVariant: '2P',
    ratings: [25, 40, 63, 80, 100], defaultRating: 40,
    sensitivities: [10, 30, 100, 300, 500], defaultSensitivity: 30,
    diffTypes: DIFF_TYPES, defaultDiffType: 'A',
  },
  {
    id: 'rcbo', category: 'Différentiels', name: 'Disjoncteur différentiel', short: 'DD',
    role: 'rcbo', refPrefix: '',
    variants: [
      { id: '1P+N', label: '1P+N', width: 2 },
      { id: '1P+N c', label: '1P+N compact', width: 1 },
      { id: '2P', label: '2P', width: 2 },
      { id: '4P', label: '4P', width: 4 },
    ],
    defaultVariant: '1P+N',
    ratings: BREAKER_RATINGS, defaultRating: 20,
    curves: CURVES, defaultCurve: 'C',
    sensitivities: [30, 300], defaultSensitivity: 30,
    diffTypes: DIFF_TYPES, defaultDiffType: 'A',
  },

  // --- Disjoncteurs
  {
    id: 'disj', category: 'Disjoncteurs', name: 'Disjoncteur', short: 'DJ',
    role: 'breaker', refPrefix: '',
    variants: [
      { id: '1P+N', label: '1P+N', width: 1 },
      { id: '2P', label: '2P', width: 2 },
      { id: '3P', label: '3P', width: 3 },
      { id: '3P+N', label: '3P+N', width: 4 },
      { id: '4P', label: '4P', width: 4 },
    ],
    defaultVariant: '1P+N',
    ratings: BREAKER_RATINGS, defaultRating: 16,
    curves: CURVES, defaultCurve: 'C',
  },

  // --- Commande
  {
    id: 'contacteur', category: 'Commande', name: 'Contacteur', short: 'KM',
    role: 'aux', refPrefix: 'KM',
    variants: [{ id: '2P', label: '2P', width: 1 }, { id: '4P', label: '4P', width: 2 }], defaultVariant: '2P',
    ratings: [16, 25, 40, 63], defaultRating: 25,
  },
  {
    id: 'jn', category: 'Commande', name: 'Contacteur jour/nuit', short: 'J/N',
    role: 'aux', refPrefix: 'JN',
    variants: [{ id: '2P', label: '2P', width: 1 }], defaultVariant: '2P',
    ratings: [20, 25, 40], defaultRating: 25,
  },
  {
    id: 'telerupt', category: 'Commande', name: 'Télérupteur', short: 'TLR',
    role: 'aux', refPrefix: 'TL',
    variants: [{ id: '1', label: '1 module', width: 1 }], defaultVariant: '1',
    ratings: [16], defaultRating: 16,
  },
  {
    id: 'minut', category: 'Commande', name: 'Minuterie', short: 'MIN',
    role: 'aux', refPrefix: 'MN',
    variants: [{ id: '1', label: '1 module', width: 1 }], defaultVariant: '1',
  },
  {
    id: 'horloge', category: 'Commande', name: 'Horloge / programmateur', short: 'HOR',
    role: 'aux', refPrefix: 'H',
    variants: [{ id: '2', label: '2 modules', width: 2 }], defaultVariant: '2',
  },
  {
    id: 'delest', category: 'Commande', name: 'Délesteur', short: 'DEL',
    role: 'aux', refPrefix: 'DL',
    variants: [{ id: '1', label: '1 module', width: 1 }], defaultVariant: '1',
  },

  // --- Signalisation
  {
    id: 'voyant', category: 'Signalisation', name: 'Voyant', short: 'HL',
    role: 'aux', refPrefix: 'HL',
    variants: [{ id: '1', label: '1 module', width: 1 }], defaultVariant: '1',
  },
  {
    id: 'transfo', category: 'Signalisation', name: 'Transformateur sonnette', short: 'TR',
    role: 'aux', refPrefix: 'TR',
    variants: [{ id: '8VA', label: '8 VA', width: 2 }], defaultVariant: '8VA',
  },

  // --- Divers
  {
    id: 'bornier', category: 'Divers', name: 'Bornier / répartiteur', short: 'BOR',
    role: 'aux', refPrefix: 'X',
    variants: modules(6), defaultVariant: '2',
  },
  {
    id: 'prise_din', category: 'Divers', name: 'Prise 2P+T sur rail', short: 'PC',
    role: 'aux', refPrefix: 'XS',
    variants: [{ id: '3', label: '3 modules', width: 3 }], defaultVariant: '3',
    ratings: [16], defaultRating: 16,
  },
  {
    id: 'vide', category: 'Divers', name: 'Emplacement réservé', short: '',
    role: 'aux', refPrefix: '',
    variants: modules(6), defaultVariant: '1',
  },
];

const BY_ID = new Map(DEVICES.map((d) => [d.id, d]));
export const getDeviceDef = (kind: DeviceKind): DeviceDef | undefined => BY_ID.get(kind);
export const DEVICE_CATEGORIES: readonly string[] = [...new Set(DEVICES.map((d) => d.category))];

export interface UsageDef {
  name: string;
  color: string;
}

export const USAGES: Readonly<Record<UsageId, UsageDef>> = {
  eclairage: { name: 'Éclairage', color: '#e08a00' },
  prises: { name: 'Prises', color: '#d62828' },
  special: { name: 'Circuit spécialisé', color: '#7b2cbf' },
  chauffage: { name: 'Chauffage', color: '#0e9aa7' },
  eau: { name: 'Eau chaude', color: '#1d6fd6' },
  autre: { name: 'Autre', color: '#6b7385' },
};
export const USAGE_IDS = Object.keys(USAGES) as UsageId[];

/** Sections de câble courantes (mm²) et calibre maximal du disjoncteur associé. */
export const SECTIONS = [1.5, 2.5, 4, 6, 10, 16] as const;
export const MAX_RATING_FOR_SECTION: Readonly<Record<number, number>> = {
  1.5: 16,
  2.5: 20,
  4: 25,
  6: 32,
  10: 40,
  16: 63,
};

/** Plus petite section admissible pour un calibre donné. */
export function suggestSection(rating: number): number {
  return SECTIONS.find((s) => (MAX_RATING_FOR_SECTION[s] ?? 0) >= rating) ?? 16;
}

/** Usage supposé d'après le calibre, tant que l'utilisateur n'en a pas choisi un. */
export function guessUsage(rating: number | null): UsageId {
  if (rating === null) return 'autre';
  if (rating <= 10) return 'eclairage';
  if (rating <= 20) return 'prises';
  return 'special';
}
