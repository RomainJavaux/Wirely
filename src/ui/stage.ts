import type { Store } from '../core/store';
import type { Viewport } from '../core/viewport';
import { toolMeta } from '../tools/meta';
import { qs } from './dom';

/** Éléments posés sur le canevas : bandeau d'aide, état vide et boutons de zoom. */
export class Stage {
  private readonly hintEl = qs<HTMLElement>('#hint');
  private readonly emptyEl = qs<HTMLElement>('#empty');

  constructor(
    private readonly store: Store,
    viewport: Viewport,
    fit: () => void,
  ) {
    const zoom = (factor: number) => {
      const r = qs<SVGSVGElement>('#svg').getBoundingClientRect();
      viewport.zoomAt(r.width / 2, r.height / 2, factor);
    };
    qs<HTMLButtonElement>('#zIn').onclick = () => zoom(1.25);
    qs<HTMLButtonElement>('#zOut').onclick = () => zoom(1 / 1.25);
    qs<HTMLButtonElement>('#zFit').onclick = fit;

    store.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const { tool, doc } = this.store.state;
    this.hintEl.textContent = toolMeta(tool).hint;
    this.emptyEl.style.display = doc.items.length ? 'none' : 'flex';
  }
}
