import { describe, expect, it } from 'vitest';
import { createDoc, parseDoc } from '../src/domain/document';
import { snap, translateItem, unionBounds } from '../src/domain/geometry';
import type { Item } from '../src/domain/types';
import { buildExportSvg } from '../src/io/exporter';

describe('géométrie', () => {
  it('accroche à la grille', () => {
    expect(snap(14)).toBe(10);
    expect(snap(16)).toBe(20);
  });

  it('déplace une ligne brisée sans muter l’original', () => {
    const wall: Item = { id: 1, type: 'wall', points: [[0, 0], [10, 0]] };
    const moved = translateItem(wall, 5, 7);
    expect(moved).toMatchObject({ points: [[5, 7], [15, 7]] });
    expect(wall.points[0]).toEqual([0, 0]);
  });

  it('calcule l’englobante de plusieurs éléments', () => {
    const items: Item[] = [
      { id: 1, type: 'room', x: 0, y: 0, w: 100, h: 50, label: '', kind: 'autre', parts: [] },
      { id: 2, type: 'wall', points: [[-10, 5], [20, 80]] },
    ];
    expect(unionBounds(items)).toEqual({ x0: -10, y0: 0, x1: 100, y1: 80 });
    expect(unionBounds([])).toBeNull();
  });
});

describe('parseDoc', () => {
  it('rejette un document sans liste d’éléments', () => {
    expect(() => parseDoc({ name: 'x' })).toThrow();
    expect(() => parseDoc(null)).toThrow();
  });

  it('ignore les éléments invalides et recalcule nextId', () => {
    const doc = parseDoc({
      name: 'Maison',
      items: [
        { id: 4, type: 'text', x: 0, y: 0, text: 'ok' },
        { id: 5, type: 'inconnu' },
        { id: 6, type: 'wall', points: 'oups' },
      ],
    });
    expect(doc.items).toHaveLength(1);
    expect(doc.nextId).toBe(5);
  });

  it('migre l’ancien champ nid', () => {
    expect(parseDoc({ name: 'a', items: [], nid: 12 }).nextId).toBe(12);
  });

  it('corrige un type de câble inconnu', () => {
    const doc = parseDoc({ items: [{ id: 1, type: 'wire', points: [[0, 0], [1, 1]], wtype: 'zzz' }] });
    expect(doc.items[0]).toMatchObject({ wtype: 'prises' });
  });
});

describe('export SVG', () => {
  it('contient le titre échappé et une légende', () => {
    const doc = createDoc('Maison <1>');
    doc.items.push({ id: 1, type: 'symbol', kind: 'prise', x: 0, y: 0, rot: 0, label: '', breaker: null, board: null, height: null });
    const svg = buildExportSvg(doc);
    expect(svg).toContain('Maison &lt;1&gt;');
    expect(svg).toContain('Légende');
    expect(svg).toContain('Prise 2P+T');
    expect(svg).not.toContain('data-id');
  });
});
