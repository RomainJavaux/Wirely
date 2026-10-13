import { translateItem } from '../domain/geometry';
import type { NewItem, Item, Rotation } from '../domain/types';
import type { Store } from './store';

/** Ajoute un élément, le sélectionne et valide. Retourne son identifiant. */
export function addItem(store: Store, draft: NewItem): number {
  const doc = store.state.doc;
  const item = { ...draft, id: doc.nextId++ } as Item;
  doc.items.push(item);
  store.state.selection = item.id;
  store.commit();
  return item.id;
}

export function deleteSelection(store: Store): void {
  const id = store.state.selection;
  if (id === null) return;
  store.state.doc.items = store.state.doc.items.filter((i) => i.id !== id);
  store.state.selection = null;
  store.commit();
}

export function rotateSelection(store: Store): void {
  const item = store.selectedItem;
  if (item?.type !== 'symbol') return;
  store.updateItem({ ...item, rot: ((item.rot + 90) % 360) as Rotation });
  store.commit();
}

export function duplicateSelection(store: Store): void {
  const item = store.selectedItem;
  if (!item) return;
  const { id: _id, ...rest } = translateItem(item, 20, 20);
  addItem(store, rest as NewItem);
}

export function setTool(store: Store, tool: Store['state']['tool'], symbolKind: string | null = null): void {
  store.change((s) => {
    s.tool = tool;
    s.symbolKind = tool === 'symbol' ? symbolKind : null;
  });
}
