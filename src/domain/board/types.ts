/** Modèle d'un tableau électrique : rails DIN et appareils modulaires. */

export type DeviceKind = string;
export type Curve = 'B' | 'C' | 'D';
export type DiffType = 'AC' | 'A' | 'F' | 'HI';
export type UsageId = 'eclairage' | 'prises' | 'special' | 'chauffage' | 'eau' | 'autre';
export type Supply = 'mono' | 'tri';

export interface Device {
  id: number;
  kind: DeviceKind;
  /** Identifiant de variante (nombre de pôles / largeur en modules). */
  variant: string;
  /** Rail (0 = celui du haut). */
  row: number;
  /** Premier module occupé sur le rail (0 = tout à gauche). */
  col: number;
  /** Désignation du circuit (ex. « Prises cuisine »). */
  label: string;
  /** Destination / pièce desservie. */
  dest: string;
  /** Désignation de chaque sortie (modules de commande à plusieurs sorties). */
  outputs: string[];
  rating: number | null;
  curve: Curve | null;
  /** Sensibilité différentielle en mA. */
  sensitivity: number | null;
  diffType: DiffType | null;
  /** null = déduit automatiquement du calibre. */
  usage: UsageId | null;
  /** Section de câble en mm² ; null = déduite automatiquement du calibre. */
  section: number | null;
  note: string;
}

export interface Board {
  id: number;
  name: string;
  location: string;
  supply: Supply;
  /** Modules par rail (13, 18, 24…). */
  cols: number;
  /** Nombre de rails. */
  rows: number;
  devices: Device[];
}
