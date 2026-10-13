import { getDeviceDef } from './catalog';
import { createDevice } from './layout';
import type { Board, Device, DiffType, UsageId } from './types';

export type BoardTemplate = 'empty' | 'logement';

interface Spec {
  kind: string;
  label?: string;
  dest?: string;
  rating?: number;
  usage?: UsageId;
  diffType?: DiffType;
  sensitivity?: number;
  variant?: string;
}

/** Construit un tableau avec des identifiants fournis par `nextId`. */
export function buildBoard(template: BoardTemplate, name: string, nextId: () => number): Board {
  const board: Board = { id: nextId(), name, location: '', supply: 'mono', cols: 13, rows: 3, devices: [] };
  if (template === 'empty') return board;

  const rows: Spec[][] = [
    [
      { kind: 'idiff', rating: 40, diffType: 'A' },
      { kind: 'disj', rating: 10, label: 'Éclairage', usage: 'eclairage' },
      { kind: 'disj', rating: 16, label: 'Prises chambres', usage: 'prises' },
      { kind: 'disj', rating: 20, label: 'Prises séjour', usage: 'prises' },
      { kind: 'disj', rating: 20, label: 'Prises cuisine', usage: 'prises' },
      { kind: 'disj', rating: 32, label: 'Plaque de cuisson', usage: 'special', dest: 'Cuisine' },
    ],
    [
      { kind: 'idiff', rating: 40, diffType: 'A' },
      { kind: 'disj', rating: 20, label: 'Lave-linge', usage: 'special' },
      { kind: 'disj', rating: 20, label: 'Lave-vaisselle', usage: 'special' },
      { kind: 'disj', rating: 20, label: 'Four', usage: 'special', dest: 'Cuisine' },
      { kind: 'disj', rating: 16, label: 'VMC', usage: 'autre' },
    ],
    [
      { kind: 'idiff', rating: 25, diffType: 'AC' },
      { kind: 'disj', rating: 16, label: 'Radiateurs RDC', usage: 'chauffage' },
      { kind: 'disj', rating: 16, label: 'Radiateurs étage', usage: 'chauffage' },
      { kind: 'disj', rating: 20, label: 'Chauffe-eau', usage: 'eau' },
      { kind: 'jn', label: 'Heures creuses' },
      { kind: 'transfo', label: 'Sonnette' },
    ],
  ];

  rows.forEach((specs, row) => {
    let col = 0;
    for (const spec of specs) {
      const def = getDeviceDef(spec.kind);
      if (!def) continue;
      const patch: Partial<Device> = {};
      if (spec.label) patch.label = spec.label;
      if (spec.dest) patch.dest = spec.dest;
      if (spec.rating !== undefined) patch.rating = spec.rating;
      if (spec.usage) patch.usage = spec.usage;
      if (spec.diffType) patch.diffType = spec.diffType;
      if (spec.sensitivity !== undefined) patch.sensitivity = spec.sensitivity;
      if (spec.variant) patch.variant = spec.variant;
      const device = createDevice(def, nextId(), row, col, patch);
      board.devices.push(device);
      col += def.variants.find((v) => v.id === device.variant)?.width ?? 1;
    }
  });
  return board;
}
