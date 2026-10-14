import type { Mode, Store } from '../core/store';
import { qs } from './dom';

/** Zone principale de chaque mode : une seule est visible à la fois. */
const MAINS: Readonly<Record<Mode, string>> = {
  plan: '#planMain',
  board: '#boardMain',
  walls: '#wallsMain',
  view3d: '#view3dMain',
};

/** Bascule entre le plan, le tableau, les murs et la vue 3D. */
export class ModeSwitch {
  private readonly mains = (Object.keys(MAINS) as Mode[]).map((mode) => ({ mode, el: qs<HTMLElement>(MAINS[mode]) }));
  private readonly tabs = [...document.querySelectorAll<HTMLElement>('.tabs [data-mode]')];

  constructor(private readonly store: Store) {
    this.tabs.forEach((b) => {
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
    for (const m of this.mains) m.el.toggleAttribute('hidden', m.mode !== mode);
    this.tabs.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    document.body.dataset.mode = mode;
  }
}
