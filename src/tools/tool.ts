import type { Store, ToolId } from '../core/store';
import type { Viewport } from '../core/viewport';
import type { Point } from '../domain/types';

/** Événement pointeur déjà converti en coordonnées du plan. */
export interface PointerInfo {
  raw: PointerEvent;
  /** Position exacte dans le plan. */
  world: Point;
  /** Position accrochée à la grille. */
  snapped: Point;
  /** Comme `snapped`, mais attirée par le centre d'un symbole proche. */
  magnet: Point;
  /** Élément sous le pointeur (zone `data-id`). */
  targetId: number | null;
  /** Poignée sous le pointeur (zone `data-h`). */
  handle: string | null;
}

/** Services que le canevas et l'UI mettent à disposition des outils. */
export interface ToolContext {
  readonly store: Store;
  readonly viewport: Viewport;
  requestRender(): void;
  beginPan(e: PointerEvent): void;
  promptText(message: string): string | null;
  focusLabel(): void;
}

export interface Tool {
  readonly id: ToolId;
  pointerDown(p: PointerInfo): void;
  pointerMove(p: PointerInfo): void;
  pointerUp(p: PointerInfo): void;
  /** Termine le tracé en cours (double-clic, Entrée, clic droit). */
  finish(): void;
  /** Abandonne le tracé en cours. */
  cancel(): void;
  /** Vrai si un tracé est en cours (Échap l'annule au lieu de changer d'outil). */
  hasDraft(): boolean;
  /** Marquage SVG additionnel dessiné par-dessus le plan (aperçu, poignées). */
  overlay(): string;
}

/** Implémentation par défaut : un outil ne redéfinit que ce dont il a besoin. */
export abstract class BaseTool implements Tool {
  abstract readonly id: ToolId;

  constructor(protected readonly ctx: ToolContext) {}

  pointerDown(_p: PointerInfo): void {}
  pointerMove(_p: PointerInfo): void {}
  pointerUp(_p: PointerInfo): void {}
  finish(): void {}
  cancel(): void {}
  hasDraft(): boolean {
    return false;
  }
  overlay(): string {
    return '';
  }
}
