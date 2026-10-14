import type { RoomKind } from '../types';

export interface RoomKindDef {
  id: RoomKind;
  name: string;
  /** Teinte douce du sol sur le plan. */
  color: string;
  /**
   * Nombre minimal de prises 16 A conseillé, en fonction de la surface (m²).
   * Repères indicatifs inspirés de la NF C 15-100 : à vérifier pour chaque logement.
   */
  minSockets: ((areaM2: number) => number) | null;
  /** Nombre minimal de points lumineux. */
  minLights: number;
}

export const ROOM_KINDS: Readonly<Record<RoomKind, RoomKindDef>> = {
  sejour: { id: 'sejour', name: 'Séjour', color: '#fff3d6', minSockets: (a) => Math.max(5, Math.ceil(a / 4)), minLights: 1 },
  cuisine: { id: 'cuisine', name: 'Cuisine', color: '#dff0fb', minSockets: (a) => (a <= 4 ? 3 : 6), minLights: 1 },
  chambre: { id: 'chambre', name: 'Chambre', color: '#ece6f7', minSockets: () => 3, minLights: 1 },
  bureau: { id: 'bureau', name: 'Bureau', color: '#fde6ee', minSockets: () => 3, minLights: 1 },
  sdb: { id: 'sdb', name: 'Salle de bains', color: '#d9f3ef', minSockets: () => 2, minLights: 1 },
  wc: { id: 'wc', name: 'WC', color: '#e4f3e4', minSockets: () => 1, minLights: 1 },
  entree: { id: 'entree', name: 'Entrée', color: '#f2e6d8', minSockets: () => 1, minLights: 1 },
  couloir: { id: 'couloir', name: 'Couloir', color: '#eef0f3', minSockets: () => 1, minLights: 1 },
  garage: { id: 'garage', name: 'Garage', color: '#e3e8ec', minSockets: () => 1, minLights: 1 },
  cave: { id: 'cave', name: 'Cave / buanderie', color: '#ebe4df', minSockets: () => 1, minLights: 1 },
  exterieur: { id: 'exterieur', name: 'Extérieur', color: '#e4f2d3', minSockets: null, minLights: 0 },
  autre: { id: 'autre', name: 'Autre', color: '#f4f6fa', minSockets: null, minLights: 0 },
};

export const ROOM_KIND_IDS = Object.keys(ROOM_KINDS) as RoomKind[];
export const getRoomKind = (id: RoomKind): RoomKindDef => ROOM_KINDS[id] ?? ROOM_KINDS.autre;
