import { translateItem } from '../domain/geometry';
import { MAX_SCALE, MIN_SCALE } from '../domain/plan/metrics';
import { examplePlan } from '../domain/plan/templates';
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

export function rotateSelection(store: Store, step: 90 | -90 = 90): void {
  const item = store.selectedItem;
  if (item?.type !== 'symbol') return;
  store.updateItem({ ...item, rot: ((item.rot + step + 360) % 360) as Rotation });
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

/** Décale la sélection de (dx, dy) unités du plan et valide. */
export function moveSelection(store: Store, dx: number, dy: number): void {
  const item = store.selectedItem;
  if (!item) return;
  store.updateItem(translateItem(item, dx, dy));
  store.commit();
}

/** Échelle du plan en mètres par carreau, bornée. */
export function setScale(store: Store, metersPerCell: number): void {
  if (!Number.isFinite(metersPerCell)) return;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(metersPerCell * 100) / 100));
  if (scale === store.state.doc.scale) return;
  store.state.doc.scale = scale;
  store.commit();
}

/** Charge l'appartement d'exemple. Retourne false si le plan contient déjà des éléments. */
export function loadExamplePlan(store: Store): boolean {
  const doc = store.state.doc;
  if (doc.items.length > 0) return false;
  const example = examplePlan();
  for (const draft of example.items) doc.items.push({ ...draft, id: doc.nextId++ } as Item);
  if (doc.name === 'Mon installation') doc.name = example.name;
  store.state.selection = null;
  store.commit();
  return true;
}
