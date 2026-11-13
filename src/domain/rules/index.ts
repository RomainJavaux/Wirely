import type { RefScheme } from '../board/layout';
import type { Country, Doc, JobKind, ProjectInfo } from '../types';

/**
 * Règles par pays : ce qui change entre la Belgique (RGIE) et la France (NF C 15-100). Ce sont des
 * repères d'aide à la conception et au relevé. Ils ne remplacent ni le texte réglementaire ni
 * l'organisme de contrôle : chaque message qui s'en sert le rappelle.
 */

/** Ce qu'alimente un circuit, pour le comparer aux limites du pays. */
export interface CircuitLoad {
  /** Socles de prise (un socle multiple dans un même ensemble compte pour un). */
  sockets: number;
  /** Points lumineux. */
  lights: number;
  /** Appareils fixes raccordés (four, lave-linge, radiateur…). */
  fixed: number;
}

export interface LoadLimit {
  used: number;
  /** null : pas de limite de nombre. */
  max: number | null;
  /** « points », « prises », « points lumineux ». */
  unit: string;
}

export interface RuleSet {
  country: Country;
  /** « RGIE », « NF C 15-100 ». */
  code: string;
  /** « Belgique · RGIE ». */
  label: string;
  refScheme: RefScheme;
  /** Sections courantes (mm²) et calibre maximal du disjoncteur associé. */
  sections: readonly number[];
  maxRating: Readonly<Record<number, number>>;
  /** Section minimale d'un circuit qui comporte au moins une prise. */
  socketMinSection: number;
  /** Nombre minimal de circuits d'éclairage (au-delà de deux locaux). */
  minLightingCircuits: number;
  /** Variante par défaut d'un disjoncteur et largeur de rail d'un tableau neuf. */
  breakerVariant: string;
  boardCols: number;
  /** Câble et mode de pose par défaut. */
  cable: string;
  cables: readonly string[];
  laying: string;
  layings: readonly string[];
  /** Calibres par défaut selon l'usage. */
  ratings: { lighting: number; sockets: number; appliance: number; cooker: number; water: number; heating: number };
  /** Noms des documents et usages du pays. */
  docs: { unifilaire: string; position: string; controller: string; copies: number };
  vat: number;
  /** Limite de charge d'un circuit. */
  limit(load: CircuitLoad, section: number): LoadLimit;
}

const BE: RuleSet = {
  country: 'BE',
  code: 'RGIE',
  label: 'Belgique · RGIE',
  refScheme: 'letters',
  sections: [1.5, 2.5, 4, 6, 10, 16],
  maxRating: { 1.5: 16, 2.5: 20, 4: 25, 6: 40, 10: 63, 16: 80 },
  socketMinSection: 2.5,
  minLightingCircuits: 2,
  breakerVariant: '2P',
  boardCols: 18,
  cable: 'XVB',
  cables: ['XVB', 'VOB', 'XGB', 'EXVB', 'VVB', 'VTMB'],
  laying: 'encastré sous tube',
  layings: ['encastré sous tube', 'encastré', 'apparent', 'apparent sous tube', 'en goulotte', 'enterré'],
  ratings: { lighting: 16, sockets: 20, appliance: 20, cooker: 32, water: 20, heating: 20 },
  docs: { unifilaire: 'Schéma unifilaire', position: 'Schéma de position', controller: 'l’organisme de contrôle agréé', copies: 3 },
  vat: 21,
  limit(load) {
    // Sur un circuit comportant des prises, chaque socle, point lumineux et appareil fixe compte.
    if (load.sockets > 0) return { used: load.sockets + load.lights + load.fixed, max: 8, unit: 'points' };
    return { used: load.lights + load.fixed, max: null, unit: 'points' };
  },
};

const FR: RuleSet = {
  country: 'FR',
  code: 'NF C 15-100',
  label: 'France · NF C 15-100',
  refScheme: 'numbers',
  sections: [1.5, 2.5, 4, 6, 10, 16],
  maxRating: { 1.5: 16, 2.5: 20, 4: 25, 6: 32, 10: 40, 16: 63 },
  socketMinSection: 1.5,
  minLightingCircuits: 2,
  breakerVariant: '1P+N',
  boardCols: 13,
  cable: 'R2V',
  cables: ['R2V', 'H07V-U', 'H07V-R', 'AR2V'],
  laying: 'encastré sous conduit',
  layings: ['encastré sous conduit', 'apparent', 'en goulotte', 'en plénum', 'enterré'],
  ratings: { lighting: 10, sockets: 16, appliance: 20, cooker: 32, water: 20, heating: 20 },
  docs: { unifilaire: 'Schéma unifilaire', position: 'Plan d’implantation', controller: 'le Consuel', copies: 1 },
  vat: 20,
  limit(load, section) {
    if (load.sockets > 0) return { used: load.sockets, max: section <= 1.5 ? 8 : 12, unit: 'prises' };
    if (load.lights > 0) return { used: load.lights, max: 8, unit: 'points lumineux' };
    return { used: load.fixed, max: null, unit: 'appareils' };
  },
};

/** Appareil de cuisson : circuit de 32 A en 6 mm². */
export const COOKER = /plaque|cuisson|taque|cuisini[eè]re/i;
/** Appareils qui, en Belgique, passent par le différentiel de 30 mA. */
export const WET_APPLIANCE = /lave[- ]?linge|machine [àa] laver|s[eè]che[- ]?linge|s[ée]choir|lave[- ]?vaisselle/i;
/** Appareils qui, en France, demandent un différentiel de type A. */
export const TYPE_A_APPLIANCE = /plaque|cuisson|lave[- ]?linge|borne|recharge/i;

export const RULES: Readonly<Record<Country, RuleSet>> = { BE, FR };
export const COUNTRIES: readonly Country[] = ['BE', 'FR'];

export const rulesFor = (country: Country): RuleSet => RULES[country] ?? BE;
export const rulesOf = (doc: Pick<Doc, 'project'>): RuleSet => rulesFor(doc.project.country);

/** Repérage des circuits d'un document (lettres en Belgique, numéros en France). */
export const refSchemeOf = (doc: Partial<Pick<Doc, 'project'>>): RefScheme =>
  doc.project ? rulesFor(doc.project.country).refScheme : 'numbers';

/** Plus petite section admise pour un calibre, selon le pays. */
export function sectionFor(rules: RuleSet, rating: number): number {
  return rules.sections.find((s) => (rules.maxRating[s] ?? 0) >= rating) ?? 16;
}

export const JOB_KINDS: Readonly<Record<JobKind, string>> = {
  neuf: 'Installation neuve',
  renovation: 'Rénovation',
  existant: 'Relevé de l’existant',
};

export const DEFAULT_COUNTRY: Country = 'BE';

export function defaultProject(country: Country = DEFAULT_COUNTRY): ProjectInfo {
  const rules = rulesFor(country);
  return {
    country,
    kind: 'renovation',
    client: '',
    address: '',
    installer: '',
    date: '',
    cable: rules.cable,
    laying: rules.laying,
    prices: {},
    vat: rules.vat,
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Reconstruit les renseignements du chantier depuis des données non fiables. */
export function parseProject(raw: unknown): ProjectInfo {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const country: Country = r.country === 'FR' ? 'FR' : r.country === 'BE' ? 'BE' : DEFAULT_COUNTRY;
  const base = defaultProject(country);
  const prices: Record<string, number> = {};
  if (typeof r.prices === 'object' && r.prices !== null) {
    for (const [k, v] of Object.entries(r.prices as Record<string, unknown>)) {
      if (isNum(v) && v >= 0 && v < 1e6 && k.length <= 30) prices[k] = v;
    }
  }
  return {
    country,
    kind: r.kind === 'neuf' || r.kind === 'existant' || r.kind === 'renovation' ? r.kind : base.kind,
    client: isStr(r.client) ? r.client.slice(0, 120) : '',
    address: isStr(r.address) ? r.address.slice(0, 200) : '',
    installer: isStr(r.installer) ? r.installer.slice(0, 200) : '',
    date: isStr(r.date) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : '',
    cable: isStr(r.cable) && r.cable.trim() ? r.cable.slice(0, 30) : base.cable,
    laying: isStr(r.laying) && r.laying.trim() ? r.laying.slice(0, 40) : base.laying,
    prices,
    vat: isNum(r.vat) && r.vat >= 0 && r.vat <= 100 ? r.vat : base.vat,
  };
}
