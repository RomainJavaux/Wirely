import { addCircuit } from '../core/circuitActions';
import type { Store } from '../core/store';
import { deviceSpec } from '../domain/board/bom';
import { linksSummary } from '../domain/link/links';
import { esc } from '../util/escape';
import { openDialog } from './cloud/dialog';
import { circuitBadge, circuitViews, loadMeter } from './kit';

/** Calibres proposés pour créer un circuit d'un geste. */
export const QUICK_RATINGS = [10, 16, 20, 25, 32, 40];

export interface PickerOptions {
  title: string;
  hint?: string;
  /** Circuit actuellement choisi (mis en avant). */
  current: number | null;
  /** Propose « Sans circuit ». */
  allowNone?: boolean;
  onPick(deviceId: number | null): void;
}

/**
 * Choix d'un circuit : la liste de tous les circuits, avec leur lettre, leur protection et leur
 * charge. On peut aussi en créer un sur-le-champ, d'un calibre.
 */
export function openCircuitPicker(store: Store, o: PickerOptions): void {
  const { doc } = store.state;
  const views = circuitViews(doc);
  const many = doc.boards.length > 1;

  const rows = views
    .map((v) => {
      const sub = [deviceSpec(v.device), v.links ? linksSummary(v.links) : 'rien de raccordé'].filter(Boolean).join(' · ');
      return `<button type="button" class="pick${v.device.id === o.current ? ' current' : ''}" data-pick="${v.device.id}">
        ${circuitBadge(v.ref, v.color)}
        <span class="pick-text"><b>${esc(v.name)}</b><small>${esc(many ? `${v.board.name} · ${sub}` : sub)}</small></span>
        ${loadMeter(v.load)}
      </button>`;
    })
    .join('');

  const dlg = openDialog(
    `<div class="dlg-body picker">
      <h2>${esc(o.title)}</h2>
      ${o.hint ? `<p class="muted">${esc(o.hint)}</p>` : ''}
      <div class="pick-list">
        ${o.allowNone ? `<button type="button" class="pick${o.current === null ? ' current' : ''}" data-pick="">
          <span class="cbadge none">–</span><span class="pick-text"><b>Sans circuit</b><small>à raccorder plus tard, ou automatiquement</small></span></button>` : ''}
        ${rows || '<p class="muted">Aucun circuit pour l’instant : créez-en un ci-dessous.</p>'}
      </div>
      <div class="pick-new">
        <span>Nouveau circuit</span>
        ${QUICK_RATINGS.map((r) => `<button type="button" data-new="${r}">${r} A</button>`).join('')}
      </div>
      <div class="row dlg-actions"><button type="button" class="cancel">Fermer</button></div>
    </div>`,
    'picker-dlg',
  );

  dlg.el.addEventListener('click', (e) => {
    const target = e.target as Element;
    const pick = target.closest<HTMLElement>('[data-pick]');
    if (pick) {
      dlg.close();
      o.onPick(pick.dataset.pick ? Number(pick.dataset.pick) : null);
      return;
    }
    const fresh = target.closest<HTMLElement>('[data-new]');
    if (fresh) {
      const id = addCircuit(store, { rating: Number(fresh.dataset.new) });
      dlg.close();
      if (id !== null) o.onPick(id);
      return;
    }
    if (target.closest('.cancel')) dlg.close();
  });
}
