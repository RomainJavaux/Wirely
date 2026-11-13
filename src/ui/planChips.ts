import { confirmPositions } from '../core/pointActions';
import type { Store } from '../core/store';
import { allPoints } from '../domain/points';
import { qs } from './dom';
import { icon } from './kit';

/**
 * Compléments du plan : la puce « positions à vérifier », le passage en 3D et, sur petit écran,
 * l'ouverture des outils et des détails en panneaux glissants.
 */
export class PlanChips {
  private readonly chips = qs<HTMLElement>('#planChips');
  private readonly main = qs<HTMLElement>('#planMain');
  private key = '';

  constructor(private readonly store: Store) {
    qs<HTMLButtonElement>('#view3dBtn').onclick = () => store.change((s) => (s.mode = 'view3d'));
    qs<HTMLButtonElement>('#view3dBack').onclick = () => store.change((s) => (s.mode = 'plan'));
    qs<HTMLButtonElement>('#planToolsBtn').onclick = () => this.main.classList.toggle('show-tools');

    this.chips.addEventListener('click', (e) => {
      const target = e.target as Element;
      if (target.closest('[data-confirm]')) confirmPositions(store);
      if (target.closest('[data-next]')) this.nextRough();
    });
    // Sur petit écran, toucher le plan referme les outils.
    qs<HTMLElement>('#canvasWrap').addEventListener('pointerdown', (e) => {
      if (!(e.target as Element).closest('#planCorner')) this.main.classList.remove('show-tools');
    });
    store.subscribe(() => this.render());
    this.render();
  }

  /** Sélectionne le prochain point dont la position reste à vérifier, et cadre le plan dessus. */
  private nextRough(): void {
    const { store } = this;
    const rough = allPoints(store.state.doc).filter((p) => p.rough === true);
    if (rough.length === 0) return;
    const i = rough.findIndex((p) => p.id === store.state.selection);
    const next = rough[(i + 1) % rough.length];
    if (!next) return;
    store.change((s) => {
      s.selection = next.id;
      s.tool = 'select';
      s.planFocus = { seq: Date.now(), circuit: null, itemId: next.id };
    });
  }

  private render(): void {
    const { store } = this;
    if (store.state.mode !== 'plan') return;
    // Un élément sélectionné : sur petit écran, ses détails montent en panneau.
    this.main.classList.toggle('has-selection', store.state.selection !== null);

    const key = String(store.revision);
    if (key === this.key) return;
    this.key = key;
    const rough = allPoints(store.state.doc).filter((p) => p.rough === true).length;
    this.chips.innerHTML =
      rough > 0
        ? `<div class="plan-chip">
            <i class="dot-rough"></i><b>${rough}</b> position${rough > 1 ? 's' : ''} à vérifier
            <button type="button" data-next title="Aller au point suivant à vérifier">Suivant ${icon('chevron', 14)}</button>
            <button type="button" data-confirm title="Valider toutes les positions telles quelles">Tout valider</button>
          </div>`
        : '';
  }
}
