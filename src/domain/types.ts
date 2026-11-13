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

/** Pays dont on applique les règles et les usages de dessin. */
export type Country = 'BE' | 'FR';

/** Nature du chantier : elle oriente les libellés et la liste de contrôle. */
export type JobKind = 'neuf' | 'renovation' | 'existant';

/**
 * Renseignements du chantier, saisis une fois et repris sur chaque document (cartouche, devis).
 */
export interface ProjectInfo {
  country: Country;
  kind: JobKind;
  /** Client ou propriétaire. */
  client: string;
  /** Adresse de l'installation. */
  address: string;
  /** Installateur (nom, société, n° d'entreprise). */
  installer: string;
  /** Date portée sur les documents (AAAA-MM-JJ) ; vide : date du jour. */
  date: string;
  /** Type de câble et mode de pose par défaut des circuits. */
  cable: string;
  laying: string;
  /** Prix unitaires du devis au point (clé : type de ligne). */
  prices: Record<string, number>;
  /** Taux de TVA du devis, en pourcentage. */
  vat: number;
}

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
  /** Pièce créée depuis la liste, pas encore dessinée : ses dimensions restent à préciser. */
  rough?: boolean;
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
  /**
   * Disjoncteur qui alimente ce câble : identifiant de l'appareil dans un tableau (null : non raccordé).
   * L'identifiant, contrairement au repère affiché (1, 2, 3…), ne change pas quand on réorganise le tableau.
   */
  breaker: number | null;
}

export interface SymbolItem {
  id: number;
  type: 'symbol';
  kind: SymbolKind;
  x: number;
  y: number;
  rot: Rotation;
  label: string;
  /** Disjoncteur qui alimente cet appareil (identifiant de l'appareil dans un tableau). */
  breaker: number | null;
  /** Pour un symbole « tableau » : tableau électrique qu'il représente. */
  board: number | null;
  /** Hauteur de pose en cm (null : non précisée). */
  height: number | null;
  /** Point compté dans une pièce et posé automatiquement : sa position reste à vérifier. */
  rough?: boolean;
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
  /** Renseignements du chantier (pays, client, adresse, installateur…). */
  project: ProjectInfo;
  /** Éléments du plan. */
  items: Item[];
  /** Tableaux électriques du projet. */
  boards: Board[];
  /** Échelle du plan : mètres représentés par un carreau de la grille. */
  scale: number;
  /** Hauteur sous plafond, en cm (élévations des murs et vue 3D). */
  ceiling: number;
  /** Compteur d'identifiants partagé par le plan et les tableaux. */
  nextId: number;
}

export const isPolyline = (item: Item): item is Wall | Wire =>
  item.type === 'wall' || item.type === 'wire';
