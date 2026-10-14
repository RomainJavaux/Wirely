import { describe, expect, it } from 'vitest';
import { addItem, deleteSelection, duplicateSelection, rotateSelection } from '../src/core/actions';
import { Store } from '../src/core/store';
import { createDoc } from '../src/domain/document';

const newStore = () => new Store(createDoc());

describe('Store : historique', () => {
  it('annule et rétablit un ajout', () => {
    const store = newStore();
    addItem(store, { type: 'text', x: 0, y: 0, text: 'a' });
    expect(store.state.doc.items).toHaveLength(1);
    store.undo();
    expect(store.state.doc.items).toHaveLength(0);
    store.redo();
    expect(store.state.doc.items).toHaveLength(1);
  });

  it('ne crée pas d’étape quand rien n’a changé', () => {
    const store = newStore();
    const rev = store.revision;
    store.commit();
    expect(store.revision).toBe(rev);
    expect(store.canUndo).toBe(false);
  });

  it('les modifications transitoires ne polluent pas l’historique', () => {
    const store = newStore();
    const id = addItem(store, { type: 'text', x: 0, y: 0, text: 'a' });
    const rev = store.revision;
    store.updateItem({ id, type: 'text', x: 0, y: 0, text: 'ab' });
    store.updateItem({ id, type: 'text', x: 0, y: 0, text: 'abc' });
    expect(store.revision).toBe(rev);
    store.commit();
    store.undo();
    expect(store.getItem(id)).toMatchObject({ text: 'a' });
  });

  it('efface la redo-pile après une nouvelle action', () => {
    const store = newStore();
    addItem(store, { type: 'text', x: 0, y: 0, text: 'a' });
    store.undo();
    addItem(store, { type: 'text', x: 0, y: 0, text: 'b' });
    expect(store.canRedo).toBe(false);
  });
});

describe('Actions', () => {
  it('attribue des identifiants uniques', () => {
    const store = newStore();
    const a = addItem(store, { type: 'text', x: 0, y: 0, text: 'a' });
    const b = addItem(store, { type: 'text', x: 0, y: 0, text: 'b' });
    expect(a).not.toBe(b);
  });

  it('supprime la sélection', () => {
    const store = newStore();
    addItem(store, { type: 'text', x: 0, y: 0, text: 'a' });
    deleteSelection(store);
    expect(store.state.doc.items).toHaveLength(0);
    expect(store.state.selection).toBeNull();
  });

  it('pivote un symbole par pas de 90°', () => {
    const store = newStore();
    const id = addItem(store, { type: 'symbol', kind: 'prise', x: 0, y: 0, rot: 270, label: '', circuit: '', height: null });
    rotateSelection(store);
    expect(store.getItem(id)).toMatchObject({ rot: 0 });
  });

  it('duplique en décalant la copie', () => {
    const store = newStore();
    addItem(store, { type: 'symbol', kind: 'prise', x: 10, y: 10, rot: 0, label: '', circuit: '', height: null });
    duplicateSelection(store);
    const [orig, copy] = store.state.doc.items;
    expect(copy).toMatchObject({ x: 30, y: 30 });
    expect(copy?.id).not.toBe(orig?.id);
  });
});
