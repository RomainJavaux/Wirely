import { ACCENT } from '../render/items';
import { snap, translateItem } from '../domain/geometry';
import type { Item, Point } from '../domain/types';
import { BaseTool, type PointerInfo } from './tool';

type Gesture =
  | { kind: 'move'; origin: Item; start: Point; moved: boolean }
  | { kind: 'handle'; origin: Item; handle: string; moved: boolean };

/** Sélection, déplacement et édition des sommets / de la taille d'une pièce. */
export class SelectTool extends BaseTool {
  readonly id = 'select' as const;
  private gesture: Gesture | null = null;

  override pointerDown(p: PointerInfo): void {
    const { store } = this.ctx;
    const current = store.selectedItem;

    if (p.handle !== null && current) {
      this.gesture = { kind: 'handle', origin: structuredClone(current), handle: p.handle, moved: false };
      return;
    }
    if (p.targetId !== null) {
      store.change((s) => (s.selection = p.targetId));
      const item = store.selectedItem;
      if (item) this.gesture = { kind: 'move', origin: structuredClone(item), start: p.world, moved: false };
      return;
    }
    store.change((s) => (s.selection = null));
    this.ctx.beginPan(p.raw);
  }

  override pointerMove(p: PointerInfo): void {
    const g = this.gesture;
    if (!g) return;
    const { store } = this.ctx;

    if (g.kind === 'move') {
      const dx = snap(p.world[0] - g.start[0]);
      const dy = snap(p.world[1] - g.start[1]);
      if (dx !== 0 || dy !== 0) g.moved = true;
      store.updateItem(translateItem(g.origin, dx, dy));
      return;
    }

    const o = g.origin;
    if (g.handle === 'br' && o.type === 'room') {
      store.updateItem({ ...o, w: Math.max(20, p.snapped[0] - o.x), h: Math.max(20, p.snapped[1] - o.y) });
    } else if (o.type === 'wall' || o.type === 'wire') {
      const target = o.type === 'wire' ? p.magnet : p.snapped;
      const points = o.points.map((pt, i): Point => (i === Number(g.handle) ? target : pt));
      store.updateItem({ ...o, points });
    }
    g.moved = true;
  }

  override pointerUp(): void {
    const g = this.gesture;
    this.gesture = null;
    if (g?.moved) this.ctx.store.commit();
  }

  override cancel(): void {
    this.gesture = null;
  }

  override overlay(): string {
    const item = this.ctx.store.selectedItem;
    if (!item) return '';
    const k = this.ctx.viewport.k;
    const r = 5 / k;
    const common = `fill="#fff" stroke="${ACCENT}" stroke-width="${1.5 / k}"`;
    if (item.type === 'wall' || item.type === 'wire') {
      return item.points
        .map(([x, y], i) => `<circle data-h="${i}" cx="${x}" cy="${y}" r="${r + 1}" ${common} style="cursor:move"/>`)
        .join('');
    }
    if (item.type === 'room') {
      return `<rect data-h="br" x="${item.x + item.w - r}" y="${item.y + item.h - r}" width="${2 * r}" height="${2 * r}" ${common} style="cursor:nwse-resize"/>`;
    }
    return '';
  }
}
