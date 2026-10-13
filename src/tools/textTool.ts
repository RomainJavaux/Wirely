import { addItem } from '../core/actions';
import { BaseTool, type PointerInfo } from './tool';

/** Pose une annotation texte. */
export class TextTool extends BaseTool {
  readonly id = 'text' as const;

  override pointerDown(p: PointerInfo): void {
    const text = this.ctx.promptText('Texte à afficher :');
    if (text) addItem(this.ctx.store, { type: 'text', x: p.snapped[0], y: p.snapped[1], text });
  }
}
