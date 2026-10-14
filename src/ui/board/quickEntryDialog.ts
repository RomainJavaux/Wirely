import { createBoardFromText } from '../../core/boardActions';
import type { Store } from '../../core/store';
import { parseQuickEntry } from '../../domain/board/quickEntry';
import { esc } from '../../util/escape';
import { openDialog } from '../cloud/dialog';

const EXAMPLE = `ID 40 A type A
32 Plaque de cuisson @ Cuisine
20 Lave-linge
20 Lave-vaisselle
ID 25 A type AC
10 Éclairage
16 Prises chambres
20 Prises séjour
20 Chauffe-eau`;

/**
 * Saisie rapide du tableau : on tape (ou on colle) la liste des circuits, une ligne par appareil.
 * Pratique devant un tableau existant : tout se fait au clavier.
 */
export function openQuickEntry(store: Store): void {
  const active = store.activeBoard;
  const dlg = openDialog(
    `<form class="dlg-body" novalidate>
      <h2 class="dlg-title">Saisie rapide du tableau</h2>
      <p class="muted">Une ligne par appareil. <b>ID 40 A type A</b> ouvre un rail avec son différentiel ;
        <b>20 Lave-linge @ Cuisine</b> ajoute un disjoncteur (calibre, désignation, destination après « @ »).</p>
      <textarea name="text" rows="11" spellcheck="false" placeholder="${esc(EXAMPLE)}" aria-label="Circuits du tableau"></textarea>
      <p class="muted" data-preview>Tapez ou collez la liste des circuits.</p>
      <ul class="checks" data-errors hidden></ul>
      ${
        active && active.devices.length > 0
          ? `<label class="chk-line"><input type="radio" name="mode" value="new" checked> Nouveau tableau</label>
             <label class="chk-line"><input type="radio" name="mode" value="append"> Ajouter à « ${esc(active.name)} »</label>`
          : ''
      }
      <div class="row dlg-actions">
        <button type="button" class="cancel">Annuler</button>
        <button type="button" data-example>Voir un exemple</button>
        <button type="submit" class="primary submit" disabled>Créer</button>
      </div>
    </form>`,
    'quick',
  );

  const form = dlg.el.querySelector('form') as HTMLFormElement;
  const text = form.elements.namedItem('text') as HTMLTextAreaElement;
  const preview = form.querySelector<HTMLElement>('[data-preview]') as HTMLElement;
  const errors = form.querySelector<HTMLElement>('[data-errors]') as HTMLElement;
  const submit = form.querySelector<HTMLButtonElement>('.submit') as HTMLButtonElement;

  const refresh = (): void => {
    const { lines, errors: bad } = parseQuickEntry(text.value);
    const breakers = lines.filter((l) => l.kind === 'breaker').length;
    const rcds = lines.filter((l) => l.kind === 'rcd').length;
    submit.disabled = breakers === 0;
    preview.textContent =
      breakers === 0
        ? 'Tapez ou collez la liste des circuits.'
        : `${breakers} circuit${breakers > 1 ? 's' : ''}, ${rcds || 1} différentiel${rcds > 1 ? 's' : ''}.`;
    errors.hidden = bad.length === 0;
    errors.innerHTML = bad
      .slice(0, 5)
      .map((e) => `<li class="chk warn"><span>⚠️ Ligne ${e.line} non comprise : « ${esc(e.text.trim())} »</span></li>`)
      .join('');
  };
  text.addEventListener('input', refresh);
  form.querySelector('[data-example]')?.addEventListener('click', () => {
    text.value = EXAMPLE;
    refresh();
    text.focus();
  });
  form.querySelector('.cancel')?.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = (form.elements.namedItem('mode') as RadioNodeList | null)?.value;
    if (createBoardFromText(store, text.value, { append: mode === 'append' }) !== null) dlg.close();
  });
  text.focus();
}
