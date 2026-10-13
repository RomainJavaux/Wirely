import { deleteSelection, duplicateSelection, rotateSelection } from '../core/actions';
import type { Store } from '../core/store';
import { WIRE_TYPES, WIRE_TYPE_IDS, getSymbol } from '../domain/catalog';
import type { Item, WireTypeId } from '../domain/types';
import { esc } from '../util/escape';
import { qs } from './dom';

const TITLES: Record<Item['type'], string> = {
  room: 'Pièce',
  wall: 'Mur',
  wire: 'Câble',
  symbol: 'Symbole',
  text: 'Texte',
};

const HELP = `
  <h3>Propriétés</h3>
  <p class="muted">Sélectionnez un élément pour le modifier.</p>
  <h3>Raccourcis</h3>
  <p class="muted">
    <kbd>V</kbd> sélection · <kbd>G</kbd> pièce · <kbd>W</kbd> mur · <kbd>L</kbd> câble · <kbd>T</kbd> texte<br>
    <kbd>R</kbd> pivoter · <kbd>Suppr</kbd> effacer · <kbd>Ctrl</kbd>+<kbd>D</kbd> dupliquer<br>
    <kbd>Échap</kbd> annuler · <kbd>Entrée</kbd> terminer un tracé<br>
    Molette : zoom · glisser le fond ou <kbd>Espace</kbd> : déplacer la vue
  </p>`;

/** Panneau de droite : édition de l'élément sélectionné. */
export class PropertiesPanel {
  private readonly el = qs<HTMLElement>('#props');
  private key = '';

  constructor(private readonly store: Store) {
    store.subscribe(() => this.render());
    this.render();
  }

  focusLabel(): void {
    this.el.querySelector<HTMLInputElement>('#pLabel')?.focus();
  }

  /**
   * Le panneau n'est reconstruit que si la sélection ou une étape d'historique change :
   * la saisie en cours (changements transitoires) ne perd donc pas le focus.
   */
  private render(): void {
    const { selection } = this.store.state;
    const key = `${selection}:${this.store.revision}`;
    if (key === this.key) return;
    this.key = key;

    const item = this.store.selectedItem;
    if (!item) {
      this.el.innerHTML = HELP;
      return;
    }
    const title = item.type === 'symbol' ? (getSymbol(item.kind)?.name ?? 'Symbole') : TITLES[item.type];
    let html = `<h3>${esc(title)}</h3>`;

    if (item.type === 'room' || item.type === 'symbol') {
      const hint = item.type === 'room' ? 'ex. Salon' : 'ex. Prise cuisine';
      html += `<label class="f" for="pLabel">Nom / repère</label>
        <input type="text" id="pLabel" value="${esc(item.label)}" placeholder="${hint}">`;
    }
    if (item.type === 'text') {
      html += `<label class="f" for="pText">Texte</label><input type="text" id="pText" value="${esc(item.text)}">`;
    }
    if (item.type === 'wire') {
      const options = WIRE_TYPE_IDS.map(
        (id) => `<option value="${id}"${id === item.wtype ? ' selected' : ''}>${esc(WIRE_TYPES[id].name)}</option>`,
      ).join('');
      html += `<label class="f" for="pWire">Type de câble</label><select id="pWire">${options}</select>`;
    }
    if (item.type === 'room') {
      html += `<p class="muted">Taille : ${item.w / 20} × ${item.h / 20} carreaux</p>`;
    }
    html += `<div class="row">
      ${item.type === 'symbol' ? '<button id="pRot">⟳ Pivoter</button>' : ''}
      <button id="pDup">Dupliquer</button>
      <button id="pDel" class="danger">Supprimer</button>
    </div>`;
    this.el.innerHTML = html;
    this.bind(item.id);
  }

  private bind(id: number): void {
    const store = this.store;
    const edit = (patch: (item: Item) => Item) => {
      const current = store.getItem(id);
      if (current) store.updateItem(patch(current));
    };
    const label = this.el.querySelector<HTMLInputElement>('#pLabel');
    const text = this.el.querySelector<HTMLInputElement>('#pText');
    const wire = this.el.querySelector<HTMLSelectElement>('#pWire');

    if (label) {
      label.oninput = () => edit((i) => (i.type === 'room' || i.type === 'symbol' ? { ...i, label: label.value } : i));
      label.onchange = () => store.commit();
    }
    if (text) {
      text.oninput = () => edit((i) => (i.type === 'text' ? { ...i, text: text.value } : i));
      text.onchange = () => store.commit();
    }
    if (wire) {
      wire.onchange = () => {
        edit((i) => (i.type === 'wire' ? { ...i, wtype: wire.value as WireTypeId } : i));
        store.commit();
      };
    }
    const on = (selector: string, fn: () => void) => {
      const b = this.el.querySelector<HTMLButtonElement>(selector);
      if (b) b.onclick = fn;
    };
    on('#pRot', () => rotateSelection(store));
    on('#pDup', () => duplicateSelection(store));
    on('#pDel', () => deleteSelection(store));
  }
}
