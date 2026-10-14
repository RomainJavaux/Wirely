import { describe, expect, it } from 'vitest';
import { createBoardFromText } from '../src/core/boardActions';
import { Store } from '../src/core/store';
import { analyze, effectiveUsage } from '../src/domain/board/layout';
import { runChecks } from '../src/domain/board/checks';
import { createDoc } from '../src/domain/document';
import { guessUsageFromLabel, parseQuickEntry } from '../src/domain/board/quickEntry';

const SAMPLE = `ID 40 A type A
32 Plaque de cuisson @ Cuisine
20 Lave-linge
ID 25 AC
10 Éclairage
16 Prises chambres`;

describe('saisie rapide : lecture', () => {
  it('lit les différentiels et les disjoncteurs', () => {
    const { lines, errors } = parseQuickEntry(SAMPLE);
    expect(errors).toEqual([]);
    expect(lines.map((l) => l.kind)).toEqual(['rcd', 'breaker', 'breaker', 'rcd', 'breaker', 'breaker']);
    expect(lines[0]).toMatchObject({ rating: 40, diffType: 'A' });
    expect(lines[3]).toMatchObject({ rating: 25, diffType: 'AC' });
    expect(lines[1]).toMatchObject({ rating: 32, label: 'Plaque de cuisson', dest: 'Cuisine', usage: 'special' });
  });

  it('tolère les variantes de saisie', () => {
    const { lines } = parseQuickEntry('16A Prises\n20 A - Lave-vaisselle\n10: Éclairage\n  \n# commentaire\nid');
    expect(lines.map((l) => [l.kind, l.rating, l.label])).toEqual([
      ['breaker', 16, 'Prises'],
      ['breaker', 20, 'Lave-vaisselle'],
      ['breaker', 10, 'Éclairage'],
      ['rcd', 40, ''],
    ]);
  });

  it('signale les lignes non comprises', () => {
    const { lines, errors } = parseQuickEntry('Prises cuisine\n20 Four\n999 Trop gros');
    expect(lines).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([1, 3]);
  });

  it('déduit l’usage de la désignation', () => {
    expect(guessUsageFromLabel('Chauffe-eau')).toBe('eau');
    expect(guessUsageFromLabel('Radiateurs étage')).toBe('chauffage');
    expect(guessUsageFromLabel('Lave-vaisselle')).toBe('special');
    expect(guessUsageFromLabel('Éclairage extérieur')).toBe('eclairage');
    expect(guessUsageFromLabel('Prises cuisine')).toBe('prises');
    expect(guessUsageFromLabel('VMC')).toBe('autre');
    expect(guessUsageFromLabel('Divers')).toBeNull();
  });
});

describe('saisie rapide : tableau créé', () => {
  it('un rail par différentiel, circuits dans l’ordre', () => {
    const store = new Store(createDoc('T'));
    const id = createBoardFromText(store, SAMPLE)!;
    const board = store.state.doc.boards.find((b) => b.id === id)!;
    expect(board.rows).toBe(2);

    const a = analyze(board);
    expect(a.groups).toHaveLength(2);
    expect(a.circuits.map((d) => d.label)).toEqual(['Plaque de cuisson', 'Lave-linge', 'Éclairage', 'Prises chambres']);
    expect(a.circuits.every((d) => a.protectedBy.get(d.id) !== null)).toBe(true);
    expect(effectiveUsage(a.circuits[0]!)).toBe('special');
    expect(runChecks(board).filter((c) => c.severity === 'error')).toEqual([]);
  });

  it('crée un différentiel quand la liste n’en donne pas', () => {
    const store = new Store(createDoc('T'));
    const id = createBoardFromText(store, '16 Prises\n10 Éclairage')!;
    const board = store.state.doc.boards.find((b) => b.id === id)!;
    const a = analyze(board);
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0]?.head).not.toBeNull();
  });

  it('s’élargit quand un rail est plus long que le tableau', () => {
    const store = new Store(createDoc('T'));
    const text = ['ID 40 A', ...Array.from({ length: 14 }, (_, i) => `16 Circuit ${i + 1}`)].join('\n');
    const id = createBoardFromText(store, text)!;
    const board = store.state.doc.boards.find((b) => b.id === id)!;
    expect(board.cols).toBeGreaterThanOrEqual(16);
    for (const d of board.devices) expect(d.col + 1).toBeLessThanOrEqual(board.cols);
  });

  it('peut compléter le tableau actif sans toucher à l’existant', () => {
    const store = new Store(createDoc('T'));
    createBoardFromText(store, SAMPLE);
    const before = store.activeBoard!.devices.length;
    const id = createBoardFromText(store, 'ID 40 A\n20 Sèche-linge', { append: true })!;
    expect(id).toBe(store.state.doc.boards[0]!.id);
    expect(store.activeBoard!.devices.length).toBe(before + 2);
    expect(store.state.doc.boards).toHaveLength(1);
  });

  it('refuse une saisie sans circuit, et s’annule en une étape', () => {
    const store = new Store(createDoc('T'));
    expect(createBoardFromText(store, 'ID 40 A\nn’importe quoi')).toBeNull();
    expect(store.state.doc.boards).toHaveLength(0);

    createBoardFromText(store, SAMPLE);
    expect(store.state.doc.boards).toHaveLength(1);
    store.undo();
    expect(store.state.doc.boards).toHaveLength(0);
  });
});
