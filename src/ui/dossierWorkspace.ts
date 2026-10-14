import type { Store } from '../core/store';
import {
  dossierIssues,
  dossierParts,
  dossierSvg,
  exportDossierCircuitsCsv,
  exportDossierPdf,
  exportDossierPng,
  exportDossierSvg,
} from '../io/dossier';
import { exportPlanBomCsv, exportPlanRoomsCsv } from '../io/files';
import { esc } from '../util/escape';
import { qs } from './dom';

/**
 * Onglet « Dossier » : ce que l'on remet à l'électricien ou au client. À gauche, ce qu'on y met et
 * ce qu'il reste à régler ; à droite, l'aperçu exact du document exporté.
 */
export class DossierWorkspace {
  private readonly options = qs<HTMLElement>('#dossierOptions');
  private readonly sheet = qs<HTMLElement>('#dossierSheet');
  /** Sections décochées par l'utilisateur (le reste est inclus, y compris les nouvelles). */
  private readonly excluded = new Set<string>();
  private key = '';

  constructor(private readonly store: Store) {
    store.subscribe(() => this.render());
  }

  private render(): void {
    const { store } = this;
    if (store.state.mode !== 'dossier') return;
    const key = `${store.revision}:${[...this.excluded].join(',')}:${store.state.doc.name}:${store.state.boardId}`;
    if (key === this.key) return;
    this.key = key;

    const { doc } = store.state;
    const parts = dossierParts(doc);
    const keys = new Set(parts.map((p) => p.key).filter((k) => !this.excluded.has(k)));
    const issues = dossierIssues(doc);

    const groups = [...new Set(parts.map((p) => p.group))];
    const list = groups
      .map((g) => {
        const rows = parts
          .filter((p) => p.group === g)
          .map(
            (p) =>
              `<label class="chk-line"><input type="checkbox" data-part="${esc(p.key)}"${keys.has(p.key) ? ' checked' : ''}> ${esc(p.title)}</label>`,
          )
          .join('');
        return `<h3>${esc(g)}</h3>${rows}`;
      })
      .join('');

    const status =
      issues.length === 0
        ? '<p class="ok">✔ Rien à signaler : le dossier est prêt à être remis.</p>'
        : `<ul class="checks">${issues
            .map(
              (i) =>
                `<li class="chk ${i.severity}" data-fix="${i.fix}">${i.severity === 'warn' ? '⚠️' : 'ℹ️'} <span>${esc(i.text)}</span></li>`,
            )
            .join('')}</ul><p class="muted">Cliquez un point pour aller le régler.</p>`;

    const board = store.activeBoard;
    const none = keys.size === 0 ? ' disabled' : '';
    this.options.innerHTML = `
      <h3>Avant de remettre</h3>
      ${status}
      <h3>Exporter</h3>
      <div class="stack">
        <button type="button" id="dsPdf" class="primary"${none}>PDF / Imprimer</button>
        <div class="row tight">
          <button type="button" id="dsPng"${none}>Image PNG</button>
          <button type="button" id="dsSvg"${none}>Image SVG</button>
        </div>
        <button type="button" id="dsRooms"${doc.items.length === 0 ? ' disabled' : ''}>Pièces (CSV)</button>
        <button type="button" id="dsBom"${doc.items.length === 0 ? ' disabled' : ''}>Nomenclature du plan (CSV)</button>
        <button type="button" id="dsCircuits"${board ? '' : ' disabled'}>Circuits${board ? ` · ${esc(board.name)}` : ''} (CSV)</button>
      </div>
      <p class="muted">Le PDF s’ouvre dans l’impression du navigateur : choisissez « Enregistrer au format PDF ».</p>
      <h3>Contenu</h3>
      ${parts.length === 0 ? '<p class="muted">Rien à exporter pour l’instant : ajoutez des pièces.</p>' : list}`;

    this.sheet.innerHTML =
      keys.size === 0
        ? '<div class="dossier-empty"><b>Aucune section sélectionnée</b><p>Cochez ce que le dossier doit contenir.</p></div>'
        : dossierSvg(doc, keys);

    this.bind(keys);
  }

  private bind(keys: ReadonlySet<string>): void {
    const { store } = this;
    this.options.querySelectorAll<HTMLInputElement>('[data-part]').forEach((box) => {
      box.onchange = () => {
        const k = box.dataset.part as string;
        if (box.checked) this.excluded.delete(k);
        else this.excluded.add(k);
        this.key = '';
        this.render();
      };
    });
    this.options.querySelectorAll<HTMLElement>('[data-fix]').forEach((li) => {
      li.onclick = () => store.change((s) => (s.mode = li.dataset.fix === 'board' ? 'board' : 'plan'));
    });
    const on = (id: string, fn: () => void): void => {
      const b = this.options.querySelector<HTMLButtonElement>(id);
      if (b) b.onclick = fn;
    };
    const { doc } = store.state;
    on('#dsPdf', () => exportDossierPdf(doc, keys));
    on('#dsPng', () => exportDossierPng(doc, keys));
    on('#dsSvg', () => exportDossierSvg(doc, keys));
    on('#dsRooms', () => exportPlanRoomsCsv(doc));
    on('#dsBom', () => exportPlanBomCsv(doc));
    on('#dsCircuits', () => {
      const board = store.activeBoard;
      if (board) exportDossierCircuitsCsv(doc, board);
    });
  }
}
