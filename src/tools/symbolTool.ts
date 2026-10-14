import { addItem } from '../core/actions';
import { BaseTool, type PointerInfo } from './tool';

/** Pose le symbole choisi dans la palette (sans changer d'outil). */
export class SymbolTool extends BaseTool {
  readonly id = 'symbol' as const;

  override pointerDown(p: PointerInfo): void {
    const kind = this.ctx.store.state.symbolKind;
    if (!kind) return;
    addItem(this.ctx.store, { type: 'symbol', kind, x: p.snapped[0], y: p.snapped[1], rot: 0, label: '', circuit: '', height: null });
  }
}
