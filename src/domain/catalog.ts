import type { SymbolKind, WireTypeId } from './types';

export interface SymbolDef {
  id: SymbolKind;
  category: string;
  name: string;
  /** Contenu SVG dessiné autour de (0,0), dans une boîte d'environ ±16. */
  svg: string;
  /**
   * Ouverture (porte, fenêtre) : rectangle [x, y, largeur, hauteur] qui interrompt le mur sous le symbole.
   * Le mur traverse l'origine : le symbole se pose directement sur la ligne du mur.
   */
  gap?: [number, number, number, number];
  /** Cadre d'aperçu (palette, légende) quand le symbole sort de la boîte ±18 habituelle. */
  viewBox?: string;
}

const txt = (t: string, size = 8): string =>
  `<text y="${size / 2.6}" font-size="${size}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" stroke="none" fill="#111">${t}</text>`;

export const SYMBOLS: readonly SymbolDef[] = [
  { id: 'prise', category: 'Prises', name: 'Prise 2P+T', svg: '<path d="M-9 5A9 9 0 0 1 9 5Z"/><path d="M0 -4V-11"/>' },
  { id: 'prise_s', category: 'Prises', name: 'Prise spécialisée', svg: '<path d="M-9 5A9 9 0 0 1 9 5Z" fill="#111"/><path d="M0 -4V-11"/>' },
  { id: 'rj45', category: 'Prises', name: 'Prise RJ45', svg: '<rect x="-10" y="-8" width="20" height="16"/>' + txt('RJ') },
  { id: 'tv', category: 'Prises', name: 'Prise TV', svg: '<rect x="-10" y="-8" width="20" height="16"/>' + txt('TV') },

  { id: 'inter', category: 'Commandes', name: 'Interrupteur simple', svg: '<circle r="5" fill="#111"/><path d="M0 0L9 -10M6 -13L12 -7"/>' },
  { id: 'va', category: 'Commandes', name: 'Va-et-vient', svg: '<circle r="5" fill="#111"/><path d="M0 0L9 -10M6 -13L12 -7M2.5 -8.5L8.5 -2.5"/>' },
  { id: 'poussoir', category: 'Commandes', name: 'Poussoir', svg: '<circle r="5"/><path d="M0 0L9 -10"/><circle cx="12" cy="-13" r="3"/>' },
  { id: 'thermo', category: 'Commandes', name: 'Thermostat', svg: '<circle r="10"/>' + txt('T°') },

  { id: 'lampe', category: 'Éclairage', name: 'Point lumineux', svg: '<circle r="9"/><path d="M-6.4 -6.4L6.4 6.4M6.4 -6.4L-6.4 6.4"/>' },
  { id: 'applique', category: 'Éclairage', name: 'Applique', svg: '<circle r="7" cy="-3"/><path d="M-4 -8L4 2M4 -8L-4 2M-12 9H12"/>' },
  { id: 'spot', category: 'Éclairage', name: 'Spot encastré', svg: '<circle r="6"/><path d="M-4 -4L4 4M4 -4L-4 4"/>' },

  { id: 'radia', category: 'Équipements', name: 'Radiateur', svg: '<rect x="-14" y="-7" width="28" height="14"/><path d="M-8 -7V7M-2 -7V7M4 -7V7M10 -7V7"/>' },
  { id: 'ce', category: 'Équipements', name: 'Chauffe-eau', svg: '<circle r="10"/>' + txt('CE') },
  { id: 'vmc', category: 'Équipements', name: 'VMC', svg: '<circle r="10"/>' + txt('VMC', 6.5) },
  { id: 'vr', category: 'Équipements', name: 'Volet roulant', svg: '<rect x="-11" y="-8" width="22" height="16"/>' + txt('VR') },
  { id: 'fumee', category: 'Équipements', name: 'Détecteur fumée', svg: '<circle r="10"/>' + txt('DF', 7.5) },
  { id: 'sonnette', category: 'Équipements', name: 'Sonnette', svg: '<circle r="10"/>' + txt('SO', 7.5) },

  { id: 'tableau', category: 'Distribution', name: 'Tableau', svg: '<rect x="-16" y="-11" width="32" height="22"/>' + txt('TD', 9) },
  { id: 'compteur', category: 'Distribution', name: 'Compteur', svg: '<rect x="-14" y="-9" width="28" height="18"/>' + txt('kWh', 6.5) },
  { id: 'deriv', category: 'Distribution', name: 'Boîte dériv.', svg: '<circle r="6"/><circle r="2" fill="#111"/>' },

  {
    // Le mur passe par l'origine : l'ouverture est sur y = 0, le vantail s'ouvre vers le haut.
    id: 'porte', category: 'Ouvertures', name: 'Porte',
    svg: '<path d="M-12 0V-24M-12 -24A24 24 0 0 1 12 0"/><path d="M-12 -3V3M12 -3V3"/>',
    gap: [-12, -6, 24, 12], viewBox: '-18 -28 36 36',
  },
  {
    id: 'fenetre', category: 'Ouvertures', name: 'Fenêtre',
    svg: '<rect x="-16" y="-3" width="32" height="6" fill="#fff"/><path d="M-16 0H16"/>',
    gap: [-17, -6, 34, 12],
  },
];

const BY_ID = new Map(SYMBOLS.map((s) => [s.id, s]));
export const getSymbol = (id: SymbolKind): SymbolDef | undefined => BY_ID.get(id);
export const SYMBOL_CATEGORIES: readonly string[] = [...new Set(SYMBOLS.map((s) => s.category))];

export interface WireTypeDef {
  name: string;
  color: string;
  dash?: string;
}

export const WIRE_TYPES: Readonly<Record<WireTypeId, WireTypeDef>> = {
  eclairage: { name: 'Éclairage 1,5 mm²', color: '#e08a00' },
  prises: { name: 'Prises 2,5 mm²', color: '#d62828' },
  special: { name: 'Spécialisé 6 mm²', color: '#7b2cbf' },
  reseau: { name: 'Réseau / TV', color: '#1d6fd6' },
  terre: { name: 'Terre', color: '#2a9d3f', dash: '6 3' },
};

export const WIRE_TYPE_IDS = Object.keys(WIRE_TYPES) as WireTypeId[];
export const getWireType = (id: WireTypeId): WireTypeDef => WIRE_TYPES[id] ?? WIRE_TYPES.prises;
