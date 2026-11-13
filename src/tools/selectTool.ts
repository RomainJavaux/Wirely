import { mergeRoomsInto } from '../core/actions';
import { snap, translateItem } from '../domain/geometry';
import { contentsOf, resizeRoom, settle, translateRoom } from '../domain/plan/arrange';
import { roomRects } from '../domain/plan/rooms';
import type { Item, Point, Room, SymbolItem } from '../domain/types';
import { isCeilingKind } from '../domain/walls/mounting';
import { snapToWall } from '../domain/walls/snap';
import { ACCENT } from '../render/items';
import { BaseTool, type PointerInfo } from './tool';

type Gesture =
  | { kind: 'move'; origin: Item; start: Point; moved: boolean }
  | { kind: 'room'; origin: Room; contents: SymbolItem[]; start: Point; moved: boolean }
  | { kind: 'resize'; origin: Room; contents: SymbolItem[]; moved: boolean }
  | { kind: 'handle'; origin: Item; handle: string; moved: boolean };

/**
 * Sélection et déplacement. Une pièce emporte ses points ; un point de mur glisse le long des murs
 * (il s'y accroche tant qu'il en est proche) ; ce que l'on vient d'ajuster n'est plus « à vérifier ».
 */
export class SelectTool extends BaseTool {
  readonly id = 'select' as const;
  private gesture: Gesture | null = null;

  override pointerDown(p: PointerInfo): void {
    const { store } = this.ctx;

    // Mode fusion : le clic suivant désigne la pièce à absorber.
    const from = store.state.mergeFrom;
    if (from !== null) {
      const target = p.targetId !== null ? store.getItem(p.targetId) : undefined;
      if (target?.type === 'room' && target.id !== from) mergeRoomsInto(store, from, target.id);
      else store.change((s) => (s.mergeFrom = null));
      return;
    }

    const current = store.selectedItem;

    if (p.handle !== null && current) {
      if (p.handle === 'br' && current.type === 'room') {
        const origin = structuredClone(current);
        this.gesture = { kind: 'resize', origin, contents: structuredClone(contentsOf(store.state.doc.items, origin)), moved: false };
      } else {
        this.gesture = { kind: 'handle', origin: structuredClone(current), handle: p.handle, moved: false };
      }
      return;
    }
    if (p.targetId !== null) {
      store.change((s) => (s.selection = p.targetId));
      const item = store.selectedItem;
      if (item?.type === 'room') {
        const origin = structuredClone(item);
        this.gesture = { kind: 'room', origin, contents: structuredClone(contentsOf(store.state.doc.items, origin)), start: p.world, moved: false };
      } else if (item) {
        this.gesture = { kind: 'move', origin: structuredClone(item), start: p.world, moved: false };
      }
      return;
    }
    store.change((s) => (s.selection = null));
    this.ctx.beginPan(p.raw);
  }

  override pointerMove(p: PointerInfo): void {
    const g = this.gesture;
    if (!g) return;
    const { store } = this.ctx;
    const { doc } = store.state;

    if (g.kind === 'room') {
      const dx = snap(p.world[0] - g.start[0]);
      const dy = snap(p.world[1] - g.start[1]);
      if (dx !== 0 || dy !== 0) g.moved = true;
      // On repart de l'état initial : la pièce et ses points, décalés du même vecteur.
      const ids = new Set(g.contents.map((s) => s.id));
      const base = doc.items.map((i) => (i.id === g.origin.id ? g.origin : (g.contents.find((s) => s.id === i.id) ?? i)));
      store.change((s) => {
        s.doc.items = translateRoom(base, g.origin, ids, dx, dy);
      });
      return;
    }

    if (g.kind === 'resize') {
      const w = Math.max(20, p.snapped[0] - g.origin.x);
      const h = Math.max(20, p.snapped[1] - g.origin.y);
      g.moved = true;
      store.change((s) => {
        s.doc.items = resizeRoom(s.doc.items, g.origin, g.contents, w, h);
      });
      return;
    }

    if (g.kind === 'move') {
      const o = g.origin;
      const rawX = p.world[0] - g.start[0];
      const rawY = p.world[1] - g.start[1];
      if (o.type === 'symbol' && !isCeilingKind(o.kind)) {
        // Un point de mur suit le pointeur et s'accroche au mur le plus proche.
        const x = o.x + rawX;
        const y = o.y + rawY;
        const wall = snapToWall(doc, x, y, o.kind);
        if (Math.abs(rawX) > 2 || Math.abs(rawY) > 2) g.moved = true;
        store.updateItem(wall ? { ...o, x: wall.x, y: wall.y, rot: wall.rot } : { ...o, x: snap(x), y: snap(y) });
        return;
      }
      const dx = snap(rawX);
      const dy = snap(rawY);
      if (dx !== 0 || dy !== 0) g.moved = true;
      store.updateItem(translateItem(o, dx, dy));
      return;
    }

    const o = g.origin;
    if (g.handle.startsWith('p') && o.type === 'room') {
      // Poignée d'une partie d'une pièce composée : « p0 » est la première partie ajoutée.
      const i = Number(g.handle.slice(1));
      store.updateItem({
        ...o,
        parts: o.parts.map((q, k) =>
          k === i ? { ...q, w: Math.max(20, p.snapped[0] - q.x), h: Math.max(20, p.snapped[1] - q.y) } : q,
        ),
      });
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
    if (!g?.moved) return;
    const { store } = this.ctx;
    // Ce qu'on vient d'ajuster à la main n'est plus « à vérifier ».
    const item = store.getItem(g.origin.id);
    if (item) store.updateItem(settle(item));
    store.commit();
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
      return roomRects(item)
        .map((q, i) => {
          const handle = i === 0 ? 'br' : `p${i - 1}`;
          return `<rect data-h="${handle}" x="${q.x + q.w - r}" y="${q.y + q.h - r}" width="${2 * r}" height="${2 * r}" ${common} style="cursor:nwse-resize"/>`;
        })
        .join('');
    }
    return '';
  }
}
