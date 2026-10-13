import type { Doc, Item, SymbolKind, WireTypeId } from '../domain/types';

export type ToolId = 'select' | 'room' | 'wall' | 'wire' | 'symbol' | 'text';

export interface AppState {
  doc: Doc;
  selection: number | null;
  tool: ToolId;
  symbolKind: SymbolKind | null;
  wireType: WireTypeId;
}

type Listener = () => void;

const HISTORY_LIMIT = 100;

/**
 * Source unique de vérité : état de l'application + historique annuler/rétablir.
 * Sans dépendance au DOM (testable en Node).
 *
 * - `change` / `updateItem` : modifications transitoires (aperçu d'un glisser, saisie).
 * - `commit` : valide l'état courant comme une étape d'historique (et incrémente `revision`).
 */
export class Store {
  readonly state: AppState;
  /** Incrémenté à chaque validation, annulation ou rétablissement. */
  revision = 0;

  private listeners = new Set<Listener>();
  private history: string[];
  private cursor = 0;

  constructor(doc: Doc) {
    this.state = { doc, selection: null, tool: 'select', symbolKind: null, wireType: 'prises' };
    this.history = [JSON.stringify(doc)];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.history.length - 1;
  }

  getItem(id: number | null): Item | undefined {
    return id === null ? undefined : this.state.doc.items.find((i) => i.id === id);
  }

  get selectedItem(): Item | undefined {
    return this.getItem(this.state.selection);
  }

  /** Modification transitoire de l'état, sans entrée d'historique. */
  change(mutate: (state: AppState) => void): void {
    mutate(this.state);
    this.notify();
  }

  /** Remplace un élément existant (même id), sans entrée d'historique. */
  updateItem(item: Item): void {
    const items = this.state.doc.items;
    const index = items.findIndex((i) => i.id === item.id);
    if (index === -1) return;
    items[index] = item;
    this.notify();
  }

  /** Valide l'état courant du document comme une nouvelle étape d'historique. */
  commit(): void {
    const snapshot = JSON.stringify(this.state.doc);
    if (snapshot === this.history[this.cursor]) {
      this.notify();
      return;
    }
    this.history = this.history.slice(0, this.cursor + 1);
    this.history.push(snapshot);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.cursor = this.history.length - 1;
    this.revision++;
    this.notify();
  }

  undo(): void {
    if (this.canUndo) this.restore(this.cursor - 1);
  }

  redo(): void {
    if (this.canRedo) this.restore(this.cursor + 1);
  }

  /** Remplace tout le document (nouveau projet, ouverture d'un fichier). Annulable. */
  replaceDoc(doc: Doc): void {
    this.state.doc = doc;
    this.state.selection = null;
    this.commit();
  }

  private restore(index: number): void {
    this.cursor = index;
    this.state.doc = JSON.parse(this.history[index] as string) as Doc;
    if (this.getItem(this.state.selection) === undefined) this.state.selection = null;
    this.revision++;
    this.notify();
  }
}
