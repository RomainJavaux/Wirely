import type { Store } from '../core/store';
import { esc } from '../util/escape';
import { qs } from './dom';

const DURATION_MS = 7000;

/** Bandeau de confirmation en bas de l'écran : dit ce qui vient d'être fait, avec « Annuler ». */
export class Toast {
  private readonly el = qs<HTMLElement>('#toast');
  private seen = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly store: Store) {
    store.subscribe(() => {
      const n = store.state.notice;
      if (n && n.seq !== this.seen) {
        this.seen = n.seq;
        this.show(n.text, n.undo);
      }
    });
  }

  private show(text: string, undo: boolean): void {
    this.el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" data-undo>Annuler</button>' : ''}<button type="button" class="x" data-close aria-label="Fermer">✕</button>`;
    this.el.hidden = false;
    this.el.querySelector<HTMLElement>('[data-undo]')?.addEventListener('click', () => {
      this.store.undo();
      this.hide();
    });
    this.el.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', () => this.hide());
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), DURATION_MS);
  }

  private hide(): void {
    this.el.hidden = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
