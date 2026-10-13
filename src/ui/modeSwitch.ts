import type { Mode, Store } from '../core/store';
import { qs } from './dom';

/** Bascule entre le plan et le tableau électrique. */
export class ModeSwitch {
  private readonly planMain = qs<HTMLElement>('#planMain');
  private readonly boardMain = qs<HTMLElement>('#boardMain');

  constructor(private readonly store: Store) {
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        const mode = b.dataset.mode as Mode;
        store.change((s) => {
          s.mode = mode;
          s.armedKind = null;
        });
      });
    });
    store.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const { mode } = this.store.state;
    this.planMain.toggleAttribute('hidden', mode !== 'plan');
    this.boardMain.toggleAttribute('hidden', mode !== 'board');
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    document.body.dataset.mode = mode;
  }
}
