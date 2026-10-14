import { addItem } from '../core/actions';
import { getSymbol } from '../domain/catalog';
import type { Rotation, SymbolItem } from '../domain/types';
import { faceLabel, roomFaces } from '../domain/walls/faces';
import { isCeilingKind, mountingOf } from '../domain/walls/mounting';
import { snapToWall } from '../domain/walls/snap';
import { esc } from '../util/escape';
import { renderItem } from '../render/items';
import { BaseTool, type PointerInfo } from './tool';

interface Spot {
  x: number;
  y: number;
  rot: Rotation;
  /** Texte d'aide près du pointeur : « Mur nord · 120 cm ». */
  hint: string;
  onWall: boolean;
}

/**
 * Pose le symbole choisi dans la palette (sans changer d'outil). Un appareil de mur s'accroche au
 * mur le plus proche, orienté vers l'intérieur de la pièce, à sa hauteur usuelle ; un appareil de
 * plafond se pose où l'on clique.
 */
export class SymbolTool extends BaseTool {
  readonly id = 'symbol' as const;
  private spot: Spot | null = null;

  private locate(p: PointerInfo, kind: string): Spot {
    const { doc } = this.ctx.store.state;
    const snap = snapToWall(doc, p.world[0], p.world[1], kind);
    if (snap) {
      const label = faceLabel(snap.face, roomFaces(snap.room));
      const mount = mountingOf(kind);
      const height = mount.where === 'opening' ? '' : ` · h ${mount.height} cm`;
      return { x: snap.x, y: snap.y, rot: snap.rot, hint: `${label} · ${snap.u} cm${height}`, onWall: true };
    }
    const hint = isCeilingKind(kind) ? 'Plafond' : 'Hors d’un mur : rapprochez-vous d’un mur';
    return { x: p.snapped[0], y: p.snapped[1], rot: 0, hint, onWall: false };
  }

  override pointerMove(p: PointerInfo): void {
    const kind = this.ctx.store.state.symbolKind;
    this.spot = kind ? this.locate(p, kind) : null;
    this.ctx.requestRender();
  }

  override pointerLeave(): void {
    if (this.spot) {
      this.spot = null;
      this.ctx.requestRender();
    }
  }

  override pointerDown(p: PointerInfo): void {
    const kind = this.ctx.store.state.symbolKind;
    if (!kind) return;
    const s = this.locate(p, kind);
    addItem(this.ctx.store, { type: 'symbol', kind, x: s.x, y: s.y, rot: s.rot, label: '', breaker: null, board: null, height: null });
  }

  override cancel(): void {
    this.spot = null;
    this.ctx.requestRender();
  }

  /** Aperçu : le pictogramme à l'endroit où il sera posé, et où l'on est par rapport au mur. */
  override overlay(): string {
    const kind = this.ctx.store.state.symbolKind;
    const s = this.spot;
    if (!kind || !s || !getSymbol(kind)) return '';
    const ghost: SymbolItem = { id: -1, type: 'symbol', kind, x: s.x, y: s.y, rot: s.rot, label: '', breaker: null, board: null, height: null };
    const color = s.onWall || isCeilingKind(kind) ? '#2563eb' : '#c62828';
    const w = Math.max(60, s.hint.length * 6.2 + 12);
    return (
      `<g pointer-events="none" opacity=".72">${renderItem(ghost, { interactive: false })}</g>` +
      `<g pointer-events="none"><rect x="${s.x - w / 2}" y="${s.y - 46}" width="${w}" height="17" rx="8.5" fill="#fff" stroke="${color}"/>` +
      `<text x="${s.x}" y="${s.y - 34}" font-size="10" text-anchor="middle" font-family="Arial,sans-serif" fill="${color}">${esc(s.hint)}</text></g>`
    );
  }
}
