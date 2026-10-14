import type { Rect } from '../domain/geometry';
import type { Point } from '../domain/types';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** En dessous de cette taille (px), le cadrage n'a pas de sens. */
const MIN_FIT_SIZE = 120;

/** Transformation plan → écran (translation + zoom). Sans dépendance au DOM. */
export class Viewport {
  x = 0;
  y = 0;
  k = 1;

  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** Convertit un point en pixels (relatifs au canevas) en coordonnées du plan. */
  toWorld(px: number, py: number): Point {
    return [(px - this.x) / this.k, (py - this.y) / this.k];
  }

  panTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.notify();
  }

  /** Zoome d'un facteur en gardant fixe le point (px, py) du canevas. */
  zoomAt(px: number, py: number, factor: number): void {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.k * factor));
    this.x = px - (px - this.x) * (k / this.k);
    this.y = py - (py - this.y) * (k / this.k);
    this.k = k;
    this.notify();
  }

  /**
   * Cadre `bounds` dans une zone de width × height pixels (centré si null).
   * Sans effet si la zone est trop petite pour cadrer quoi que ce soit (canevas masqué ou
   * pas encore mis en page) : on garde alors la vue courante au lieu de calculer une échelle absurde.
   */
  fit(bounds: Rect | null, width: number, height: number): void {
    if (width < MIN_FIT_SIZE || height < MIN_FIT_SIZE) return;
    if (!bounds) {
      this.k = 1;
      this.x = width / 2;
      this.y = height / 2;
    } else {
      const bw = Math.max(1, bounds.x1 - bounds.x0);
      const bh = Math.max(1, bounds.y1 - bounds.y0);
      this.k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(2, (width - 80) / bw, (height - 80) / bh)));
      this.x = (width - bw * this.k) / 2 - bounds.x0 * this.k;
      this.y = (height - bh * this.k) / 2 - bounds.y0 * this.k;
    }
    this.notify();
  }
}
