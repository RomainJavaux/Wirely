import { assignBreaker, showDeviceInBoard } from '../core/links';
import type { Store } from '../core/store';
import { circuitFromTitle, circuitOptions, circuitTitle } from '../domain/link/links';
import { esc } from '../util/escape';

/**
 * Champ « Disjoncteur » partagé par les panneaux du plan et des murs : saisie avec suggestions
 * (recherche par texte dans tous les circuits de tous les tableaux). `prefix` distingue les
 * identifiants quand deux panneaux coexistent dans la page.
 */
export function breakerFieldHtml(store: Store, breaker: number | null, prefix = 'p'): string {
  const { doc } = store.state;
  const options = circuitOptions(doc);
  const current = breaker !== null ? options.find((o) => o.id === breaker) : undefined;
  const none = options.length === 0;
  return `<label class="f" for="${prefix}Breaker">Disjoncteur</label>
    <div class="ac">
      <input type="text" id="${prefix}Breaker" list="${prefix}CircuitList" autocomplete="off"
        value="${esc(current ? circuitTitle(doc, current) : '')}"
        placeholder="${none ? 'Aucun tableau' : 'Rechercher un circuit…'}"${none ? ' disabled' : ''}>
      ${current ? `<button type="button" id="${prefix}BreakerGo" title="Voir ce disjoncteur dans le tableau">Tableau ↗</button>` : ''}
    </div>
    <datalist id="${prefix}CircuitList">${options.map((o) => `<option value="${esc(circuitTitle(doc, o))}"></option>`).join('')}</datalist>`;
}

/**
 * Branche le champ. `rebuild` est appelé quand la saisie ne correspond à aucun circuit : le panneau
 * doit alors être reconstruit pour restaurer la valeur actuelle.
 */
export function bindBreakerField(root: ParentNode, store: Store, itemId: number, rebuild: () => void, prefix = 'p'): void {
  const input = root.querySelector<HTMLInputElement>(`#${prefix}Breaker`);
  const go = root.querySelector<HTMLButtonElement>(`#${prefix}BreakerGo`);

  if (input) {
    input.onchange = () => {
      const text = input.value.trim();
      const found = text ? circuitFromTitle(store.state.doc, text) : null;
      if (text && !found) {
        rebuild();
        return;
      }
      assignBreaker(store, itemId, found ? found.id : null);
    };
  }
  if (go) {
    go.onclick = () => {
      const it = store.getItem(itemId);
      if (it && (it.type === 'wire' || it.type === 'symbol') && it.breaker !== null) showDeviceInBoard(store, it.breaker);
    };
  }
}
