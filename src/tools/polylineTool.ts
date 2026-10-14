import { addItem } from '../core/actions';
import type { ToolContext } from './tool';
import { getWireType } from '../domain/catalog';
import type { Point } from '../domain/types';
import { BaseTool, type PointerInfo } from './tool';

/** Trace une ligne brisée point par point : sert pour les murs et pour les câbles. */
export class PolylineTool extends BaseTool {
  private points: Point[] = [];
  private cursor: Point | null = null;

  constructor(
    ctx: ToolContext,
    readonly id: 'wall' | 'wire',
  ) {
    super(ctx);
  }

  /** Les câbles s'accrochent aux symboles ; les murs seulement à la grille. */
  private target(p: PointerInfo): Point {
    return this.id === 'wire' ? p.magnet : p.snapped;
  }

  override pointerDown(p: PointerInfo): void {
    const pt = this.target(p);
    const last = this.points[this.points.length - 1];
    if (!last || last[0] !== pt[0] || last[1] !== pt[1]) this.points.push(pt);
    this.ctx.requestRender();
  }

  override pointerMove(p: PointerInfo): void {
    if (this.points.length === 0) return;
    this.cursor = this.target(p);
    this.ctx.requestRender();
  }

  override finish(): void {
    const points = this.points;
    this.cancel();
    if (points.length < 2) return;
    const { store } = this.ctx;
    if (this.id === 'wall') addItem(store, { type: 'wall', points });
    else addItem(store, { type: 'wire', points, wtype: store.state.wireType, breaker: null });
  }

  override cancel(): void {
    this.points = [];
    this.cursor = null;
    this.ctx.requestRender();
  }

  override hasDraft(): boolean {
    return this.points.length > 0;
  }

  override overlay(): string {
    if (this.points.length === 0) return '';
    const all = this.cursor ? [...this.points, this.cursor] : this.points;
    const isWall = this.id === 'wall';
    const color = isWall ? '#1f2430' : getWireType(this.ctx.store.state.wireType).color;
    return (
      `<polyline points="${all.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${color}" ` +
      `stroke-width="${isWall ? 7 : 2.4}" stroke-opacity=".6" stroke-linejoin="round"/>`
    );
  }
}
