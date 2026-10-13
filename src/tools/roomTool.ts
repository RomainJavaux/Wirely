import { addItem, setTool } from '../core/actions';
import { ACCENT } from '../render/items';
import { BaseTool, type PointerInfo } from './tool';

const MIN_SIZE = 20;

/** Dessine une pièce rectangulaire en glissant. */
export class RoomTool extends BaseTool {
  readonly id = 'room' as const;
  private start: [number, number] | null = null;
  private end: [number, number] | null = null;

  override pointerDown(p: PointerInfo): void {
    this.start = this.end = p.snapped;
    this.ctx.requestRender();
  }

  override pointerMove(p: PointerInfo): void {
    if (!this.start) return;
    this.end = p.snapped;
    this.ctx.requestRender();
  }

  override pointerUp(): void {
    const rect = this.rect();
    this.cancel();
    if (!rect || rect.w < MIN_SIZE || rect.h < MIN_SIZE) return;
    const { store } = this.ctx;
    addItem(store, { type: 'room', ...rect, label: '' });
    setTool(store, 'select');
    this.ctx.focusLabel();
  }

  override cancel(): void {
    this.start = this.end = null;
    this.ctx.requestRender();
  }

  override hasDraft(): boolean {
    return this.start !== null;
  }

  override overlay(): string {
    const r = this.rect();
    if (!r) return '';
    return (
      `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="rgba(37,99,235,.08)" ` +
      `stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="5 4"/>`
    );
  }

  private rect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.start || !this.end) return null;
    const [x0, y0] = this.start;
    const [x1, y1] = this.end;
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }
}
