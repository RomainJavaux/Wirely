import type { Store } from '../../core/store';
import { rulesOf } from '../../domain/rules';
import { renderSchema } from '../../render/schema/unifilaire';
import { esc } from '../../util/escape';
import { qs } from '../dom';

/**
 * Tableau › Unifilaire : le schéma tel qu'il sera imprimé, tenu à jour à chaque modification des
 * circuits ou des points. Il s'ajuste à la largeur de l'écran ; on le fait défiler s'il est long.
 */
export class SchemaView {
  private readonly el = qs<HTMLElement>('#schemaView');
  private key = '';

  constructor(private readonly store: Store) {
    store.subscribe(() => this.render());
  }

  private render(): void {
    const { store } = this;
    const { mode, boardView, doc, boardId } = store.state;
    if (mode !== 'board' || boardView !== 'uni') return;
    const key = `${store.revision}:${boardId}`;
    if (key === this.key) return;
    this.key = key;

    const board = store.activeBoard;
    if (!board) {
      this.el.innerHTML = `<div class="empty-state"><h2>Pas encore de tableau</h2><p>Ajoutez des circuits dans l’onglet « Circuits » : le schéma se dessine tout seul.</p></div>`;
      return;
    }
    const rules = rulesOf(doc);
    const r = renderSchema(doc, board);
    this.el.innerHTML = `
      <div class="schema-sheet">
        <header><h2>${esc(rules.docs.unifilaire)} · ${esc(board.name)}</h2>
          <p class="muted">Généré depuis les circuits et les points. Les repères sont ceux du ${esc(rules.docs.position.toLowerCase())}.</p></header>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.width} ${r.height}" style="max-width:${r.width}px">${r.svg}</svg>
      </div>`;
  }
}
