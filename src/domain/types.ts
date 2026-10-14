/** Modèle du document : types purs, sans dépendance au DOM. */
import type { Board } from './board/types';

export type Point = [number, number];
export type Rotation = 0 | 90 | 180 | 270;
export type SymbolKind = string;
export type WireTypeId = 'eclairage' | 'prises' | 'special' | 'reseau' | 'terre';

export type RoomKind =
  | 'sejour'
  | 'cuisine'
  | 'chambre'
  | 'bureau'
  | 'sdb'
  | 'wc'
  | 'entree'
  | 'couloir'
  | 'garage'
  | 'cave'
  | 'exterieur'
  | 'autre';

/** Rectangle (unités du plan). */
export interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Room {
  id: number;
  type: 'room';
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: RoomKind;
  /**
   * Rectangles ajoutés au rectangle principal (x, y, w, h) : une pièce en L ou en U est une seule
   * pièce, avec une seule surface. Vide pour une pièce rectangulaire.
   */
  parts: RoomRect[];
}

export interface Wall {
  id: number;
  type: 'wall';
  points: Point[];
}

export interface Wire {
  id: number;
  type: 'wire';
  points: Point[];
  wtype: WireTypeId;
  /** Repère du circuit du tableau qui alimente ce câble (texte libre, ex. « 3 »). */
  circuit: string;
}

export interface SymbolItem {
  id: number;
  type: 'symbol';
  kind: SymbolKind;
  x: number;
  y: number;
  rot: Rotation;
  label: string;
  /** Repère du circuit du tableau qui alimente cet appareil. */
  circuit: string;
  /** Hauteur de pose en cm (null : non précisée). */
  height: number | null;
}

export interface TextItem {
  id: number;
  type: 'text';
  x: number;
  y: number;
  text: string;
}

export type Item = Room | Wall | Wire | SymbolItem | TextItem;
export type ItemType = Item['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Un élément avant attribution de son identifiant. */
export type NewItem = DistributiveOmit<Item, 'id'>;

export interface Doc {
  name: string;
  /** Éléments du plan. */
  items: Item[];
  /** Tableaux électriques du projet. */
  boards: Board[];
  /** Échelle du plan : mètres représentés par un carreau de la grille. */
  scale: number;
  /** Compteur d'identifiants partagé par le plan et les tableaux. */
  nextId: number;
}

export const isPolyline = (item: Item): item is Wall | Wire =>
  item.type === 'wall' || item.type === 'wire';
