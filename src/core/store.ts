import type { Board, DeviceKind } from '../domain/board/types';
import { locateDevice } from '../domain/link/links';
import type { Doc, Item, SymbolKind, WireTypeId } from '../domain/types';

export type ToolId = 'select' | 'room' | 'wall' | 'wire' | 'symbol' | 'text' | 'assign';

/** Demande de cadrage du plan sur un circuit ou un élément (consommée une fois par la vue). */
export interface PlanFocus {
  seq: number;
  circuit: number | null;
  itemId: number | null;
}

/** Demande de défilement du tableau vers un appareil. */
export interface BoardFocus {
  seq: number;
  deviceId: number;
}

/** Message bref à l'utilisateur (confirmation d'une action automatique). */
export interface Notice {
  seq: number;
  text: string;
}

/** Face de mur affichée dans l'éditeur de murs. */
export interface WallFaceRef {
  roomId: number;
  /** Clé de la face dans la pièce (« N0 », « E0 »…). */
  key: string;
}

/** Mode d'édition : plan de la maison, tableau électrique, murs (élévations) ou vue 3D. */
export type Mode = 'plan' | 'board' | 'walls' | 'view3d';

/** Ce que le plan affiche (n'affecte pas le document ni les exports). */
export interface ViewOptions {
  grid: boolean;
  /** Cotes des pièces (dimensions et surface). */
  dims: boolean;
  wires: boolean;
  symbols: boolean;
  texts: boolean;
}

export const DEFAULT_VIEW: ViewOptions = { grid: true, dims: true, wires: true, symbols: true, texts: true };

export interface AppState {
  doc: Doc;
  /** Sélection dans le plan. */
  selection: number | null;
  tool: ToolId;
  symbolKind: SymbolKind | null;
  wireType: WireTypeId;
  mode: Mode;
  view: ViewOptions;
  /** Tableau en cours d'édition. */
  boardId: number | null;
  /** Appareil sélectionné dans le tableau. */
  deviceSelection: number | null;
  /** Appareil choisi dans la palette, prêt à être posé sur un rail. */
  armedKind: DeviceKind | null;
  /** Fusion de pièces en cours : pièce qui absorbera la prochaine pièce cliquée. */
  mergeFrom: number | null;
  /**
   * Circuit actif : disjoncteur auquel se raccordent les éléments créés ou affectés, et qui est mis
   * en évidence sur le plan (le reste est atténué).
   */
  activeCircuit: number | null;
  planFocus: PlanFocus | null;
  boardFocus: BoardFocus | null;
  /** Mur affiché dans l'éditeur de murs (null : le premier de la première pièce). */
  wallFace: WallFaceRef | null;
  /** Dernier message à afficher (voir `notify`). */
  notice: Notice | null;
  /** Texte de recherche des circuits du tableau (met en retrait ce qui ne correspond pas). */
  boardFilter: string;
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
    this.state = {
      doc,
      selection: null,
      tool: 'select',
      symbolKind: null,
      wireType: 'prises',
      mode: 'plan',
      view: { ...DEFAULT_VIEW },
      boardId: doc.boards[0]?.id ?? null,
      deviceSelection: null,
      armedKind: null,
      mergeFrom: null,
      activeCircuit: null,
      planFocus: null,
      boardFocus: null,
      wallFace: null,
      notice: null,
      boardFilter: '',
    };
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

  get activeBoard(): Board | undefined {
    return this.state.doc.boards.find((b) => b.id === this.state.boardId);
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

  /** Remplace un tableau existant (même id), sans entrée d'historique. */
  updateBoard(board: Board): void {
    const boards = this.state.doc.boards;
    const index = boards.findIndex((b) => b.id === board.id);
    if (index === -1) return;
    boards[index] = board;
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
    this.state.deviceSelection = null;
    this.state.boardId = doc.boards[0]?.id ?? null;
    this.commit();
  }

  /**
   * Remplace le document et repart d'un historique vierge (ouverture d'un projet en ligne,
   * retour au brouillon). Contrairement à `replaceDoc`, ce n'est pas annulable.
   */
  reset(doc: Doc): void {
    this.state.doc = doc;
    this.state.selection = null;
    this.state.deviceSelection = null;
    this.state.mergeFrom = null;
    this.state.activeCircuit = null;
    this.state.boardFilter = '';
    this.state.wallFace = null;
    this.state.boardId = doc.boards[0]?.id ?? null;
    this.history = [JSON.stringify(doc)];
    this.cursor = 0;
    this.revision++;
    this.notify();
  }

  /** Après annulation ou ouverture : garde un tableau et un appareil valides. */
  private fixBoardSelection(): void {
    const { doc } = this.state;
    if (!doc.boards.some((b) => b.id === this.state.boardId)) this.state.boardId = doc.boards[0]?.id ?? null;
    const board = this.activeBoard;
    if (!board?.devices.some((d) => d.id === this.state.deviceSelection)) this.state.deviceSelection = null;
  }

  private restore(index: number): void {
    this.cursor = index;
    this.state.doc = JSON.parse(this.history[index] as string) as Doc;
    if (this.getItem(this.state.selection) === undefined) this.state.selection = null;
    if (this.getItem(this.state.mergeFrom) === undefined) this.state.mergeFrom = null;
    this.fixBoardSelection();
    if (locateDevice(this.state.doc, this.state.activeCircuit) === null) this.state.activeCircuit = null;
    this.revision++;
    this.notify();
  }
}
