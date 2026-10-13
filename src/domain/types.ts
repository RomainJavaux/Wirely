/** Modèle du document : types purs, sans dépendance au DOM. */
import type { Board } from './board/types';

export type Point = [number, number];
export type Rotation = 0 | 90 | 180 | 270;
export type SymbolKind = string;
export type WireTypeId = 'eclairage' | 'prises' | 'special' | 'reseau' | 'terre';

export interface Room {
  id: number;
  type: 'room';
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
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
}

export interface SymbolItem {
  id: number;
  type: 'symbol';
  kind: SymbolKind;
  x: number;
  y: number;
  rot: Rotation;
  label: string;
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
  /** Compteur d'identifiants partagé par le plan et les tableaux. */
  nextId: number;
}

export const isPolyline = (item: Item): item is Wall | Wire =>
  item.type === 'wall' || item.type === 'wire';
