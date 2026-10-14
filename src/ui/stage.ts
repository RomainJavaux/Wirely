import { loadExamplePlan } from '../core/actions';
import type { Store } from '../core/store';
import type { Viewport } from '../core/viewport';
import { GRID } from '../domain/geometry';
import { niceScaleBar } from '../render/scaleBar';
import { toolMeta } from '../tools/meta';
import { qs } from './dom';

/** Éléments posés sur le canevas : bandeau d'aide, état vide et boutons de zoom. */
export class Stage {
  private readonly hintEl = qs<HTMLElement>('#hint');
  private readonly emptyEl = qs<HTMLElement>('#empty');
  private readonly scaleBarEl = qs<HTMLElement>('#scaleBar');

  constructor(
    private readonly store: Store,
    private readonly viewport: Viewport,
    fit: () => void,
  ) {
    const zoom = (factor: number) => {
      const r = qs<SVGSVGElement>('#svg').getBoundingClientRect();
      viewport.zoomAt(r.width / 2, r.height / 2, factor);
    };
    qs<HTMLButtonElement>('#zIn').onclick = () => zoom(1.25);
    qs<HTMLButtonElement>('#zOut').onclick = () => zoom(1 / 1.25);
    qs<HTMLButtonElement>('#zFit').onclick = fit;

    qs<HTMLButtonElement>('#exampleBtn').onclick = () => {
      if (loadExamplePlan(this.store)) fit();
    };

    store.subscribe(() => this.sync());
    viewport.subscribe(() => this.syncScaleBar());
    this.sync();
  }

  /** Barre d'échelle : longueur « ronde » en mètres, selon le zoom et l'échelle du plan. */
  private syncScaleBar(): void {
    const { doc, mode } = this.store.state;
    const pxPerMeter = (this.viewport.k * GRID) / doc.scale;
    const bar = niceScaleBar(pxPerMeter);
    this.scaleBarEl.hidden = mode !== 'plan' || doc.items.length === 0;
    const line = this.scaleBarEl.querySelector<HTMLElement>('.bar');
    if (line) line.style.width = `${Math.round(bar.px)}px`;
    const label = this.scaleBarEl.querySelector('b');
    if (label) label.textContent = bar.label;
  }

  private sync(): void {
    const { tool, doc, mergeFrom, activeCircuit } = this.store.state;
    const source = mergeFrom !== null ? doc.items.find((i) => i.id === mergeFrom) : undefined;
    this.hintEl.textContent =
      source?.type === 'room'
        ? `Fusion : cliquez la pièce à intégrer dans « ${source.label.trim() || 'cette pièce'} » (Échap pour annuler).`
        : tool === 'assign' && activeCircuit === null
          ? 'Choisissez d’abord un circuit actif dans le panneau de gauche, puis cliquez les câbles et appareils à y raccorder.'
          : toolMeta(tool).hint;
    this.emptyEl.style.display = doc.items.length ? 'none' : 'flex';
    this.syncScaleBar();
  }
}
