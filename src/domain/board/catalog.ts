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

  // --- Modules de domotique sur bus (Niko) -------------------------------------------
  /** Système de bus : ces modules ne font pas partie des groupes protégés par un différentiel. */
  system?: BusSystem;
  /** Référence commerciale du constructeur. */
  ref?: string;
  /** Nombre de sorties nommables. */
  outputs?: number;
  /** Caractéristiques résumées (ex. « 12 sorties 10 A · 230 V »). */
  info?: string;
  /** Couleur d'accent de la face avant. */
  tone?: string;
  /** Fiche technique ayant servi à renseigner l'appareil. */
  source?: string;
  /** Renseigné quand une donnée (largeur…) n'est pas confirmée par une fiche constructeur. */
  unverified?: string;
}


const modules = (n: number): Variant[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i + 1), label: `${i + 1} module${i ? 's' : ''}`, width: i + 1 }));

export const BREAKER_RATINGS = [2, 6, 10, 16, 20, 25, 32, 40, 50, 63] as const;
const CURVES = ['B', 'C', 'D'] as const;
const DIFF_TYPES = ['AC', 'A', 'F', 'HI'] as const;

export type BusSystem = 'nikobus' | 'nhc2';

export const BUS_SYSTEMS: Readonly<Record<BusSystem, { name: string; tone: string; busLabel: string }>> = {
  nikobus: { name: 'Nikobus', tone: '#b45309', busLabel: 'Bus Nikobus · 9 Vdc' },
  nhc2: { name: 'Niko Home Control II', tone: '#0f766e', busLabel: 'Bus NHC · 26 Vdc' },
};

/** Variante unique : un appareil de largeur fixe. */
const fixed = (width: number): { variants: Variant[]; defaultVariant: string } => ({
  variants: [{ id: String(width), label: `${width} modules`, width }],
  defaultVariant: String(width),
});

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

  // --- Niko : Nikobus (ancienne génération), largeurs d'après les notices Niko
  {
    id: 'nb_pclink', category: 'Niko · Nikobus', name: 'PC-Link', short: 'PC-LINK',
    role: 'aux', refPrefix: 'NB', system: 'nikobus', ref: '05-200', info: '230 V · programmation du bus',
    tone: BUS_SYSTEMS.nikobus.tone, ...fixed(4),
    source: 'https://www.manualslib.com/manual/1998334/Niko-05-200.html',
  },
  {
    id: 'nb_sw12', category: 'Niko · Nikobus', name: 'Module de commutation 12 sorties', short: 'SW12',
    role: 'aux', refPrefix: 'NB', system: 'nikobus', ref: '05-000-02', outputs: 12,
    info: '12 sorties 10 A · 230 V · bus 9 Vdc', tone: BUS_SYSTEMS.nikobus.tone, ...fixed(14),
    source: 'https://www.manualslib.com/manual/1852506/Niko-05-000-02.html',
  },
  {
    id: 'nb_sw4', category: 'Niko · Nikobus', name: 'Module de commutation 4 sorties', short: 'SW4',
    role: 'aux', refPrefix: 'NB', system: 'nikobus', ref: '05-002-02', outputs: 4,
    info: '4 sorties 10 A · 230 V', tone: BUS_SYSTEMS.nikobus.tone, ...fixed(4),
    source: 'https://www.manualslib.com/manual/2152109/Niko-05-002-02.html',
  },
  {
    id: 'nb_shutter', category: 'Niko · Nikobus', name: 'Module volets roulants', short: 'VOLETS',
    role: 'aux', refPrefix: 'NB', system: 'nikobus', ref: '05-001-02', info: 'commande de volets · 230 V',
    tone: BUS_SYSTEMS.nikobus.tone, ...fixed(14),
    source: 'https://www.niko.eu/en/article/05-001-02',
    unverified: 'Largeur d’après un revendeur ; modèle arrêté par Niko en 2021. À vérifier sur l’appareil.',
  },
  {
    id: 'nb_dim', category: 'Niko · Nikobus', name: 'Dimcontroller (acteur-variateur)', short: 'DIM',
    role: 'aux', refPrefix: 'NB', system: 'nikobus', ref: '05-007-02', outputs: 12,
    info: '12 sorties · 230 V AC', tone: BUS_SYSTEMS.nikobus.tone, ...fixed(14),
    source: 'https://www.cebeo.be/catalog/fr-be/products/niko-nikobus-dimcontroller-230v-ac-largeur-14e-3458845',
  },
  {
    id: 'nb_dim4', category: 'Niko · Nikobus', name: 'Mini-dimcontroller 4 × 0-10 V', short: 'DIM4',
    role: 'aux', refPrefix: 'NB', system: 'nikobus', ref: '05-008-02', outputs: 4,
    info: '4 sorties 0-10 V · commande 2 mA', tone: BUS_SYSTEMS.nikobus.tone, ...fixed(4),
    source: 'https://www.cebeo.be/catalog/nl-be/products/niko-nikobus-compacte-dimcontroller-4x-0-10v-out-breedte-4e-3508453',
  },

  // --- Niko : Niko Home Control II, largeurs d'après les fiches Niko
  {
    id: 'nhc_cc', category: 'Niko · Home Control II', name: 'Contrôleur connecté', short: 'NHC',
    role: 'aux', refPrefix: 'NH', system: 'nhc2', ref: '550-00003', info: '230 V · sortie bus 26 Vdc 400 mA',
    tone: BUS_SYSTEMS.nhc2.tone, ...fixed(6),
    source: 'https://www.niko.eu/article/550-00003',
  },
  {
    id: 'nhc_ps', category: 'Niko · Home Control II', name: 'Alimentation', short: 'PSU',
    role: 'aux', refPrefix: 'NH', system: 'nhc2', ref: '550-00010', info: '26 Vdc · 10 W',
    tone: BUS_SYSTEMS.nhc2.tone, ...fixed(4),
    source: 'https://cdn.niko.eu/article/550-00010_fr-FR_datasheet.pdf',
  },
  {
    id: 'nhc_rc', category: 'Niko · Home Control II', name: 'Accoupleur de rail', short: 'RC',
    role: 'aux', refPrefix: 'NH', system: 'nhc2', ref: '550-00020', info: 'prolonge alimentation et bus',
    tone: BUS_SYSTEMS.nhc2.tone, ...fixed(2),
    source: 'https://cdn.niko.eu/article/550-00020_fr-FR_datasheet.pdf',
  },
  {
    id: 'nhc_sw3', category: 'Niko · Home Control II', name: 'Module de commutation 3 circuits', short: 'SW3',
    role: 'aux', refPrefix: 'NH', system: 'nhc2', ref: '550-00103', outputs: 3,
    info: '3 sorties 16 A (40 A max. au total)', tone: BUS_SYSTEMS.nhc2.tone, ...fixed(2),
    source: 'https://cdn.niko.eu/article/550-00103_fr-FR_datasheet.pdf',
  },
  {
    id: 'nhc_sw6', category: 'Niko · Home Control II', name: 'Module de commutation 6 circuits', short: 'SW6',
    role: 'aux', refPrefix: 'NH', system: 'nhc2', ref: '550-00106', outputs: 6,
    info: '6 sorties (32 A max. au total)', tone: BUS_SYSTEMS.nhc2.tone, ...fixed(4),
    source: 'https://cdn.niko.eu/article/550-00106_fr-FR_datasheet.pdf',
  },
  {
    id: 'nhc_dim', category: 'Niko · Home Control II', name: 'Variateur universel 2 × 400 W', short: 'DIM',
    role: 'aux', refPrefix: 'NH', system: 'nhc2', ref: '550-00340', outputs: 2,
    info: '2 sorties 400 W', tone: BUS_SYSTEMS.nhc2.tone, ...fixed(4),
    source: 'https://www.niko.eu/en/article/550-00340',
  },

  // --- Niko : variateur modulaire autonome (commande par bouton-poussoir, hors bus)
  {
    id: 'niko_dimmer', category: 'Niko · Variateurs', name: 'Variateur universel modulaire', short: 'DIM',
    role: 'aux', refPrefix: 'DM', ref: '330-00700', info: '5–350 W · commande par poussoir · 230 V',
    ...fixed(1),
    source: 'https://www.cebeo.be/catalog/nl-be/products/niko-universele-modulaire-dimmer-met-cab-ontstoring-5-350-w-4166664',
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
