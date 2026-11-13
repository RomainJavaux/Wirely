import { connectUnlinked } from '../../core/planActions';
import { confirmPositions, patchProject } from '../../core/pointActions';
import type { Mode, Store } from '../../core/store';
import { buildQuote, fmtMoney, priceOf } from '../../domain/quote';
import { rulesOf } from '../../domain/rules';
import { runProjectChecks, type Where } from '../../domain/rules/checks';
import {
  DOC_GROUPS,
  documentSvg,
  dossierDocs,
  exportDocumentPng,
  exportDocumentSvg,
  printDocuments,
  type DossierDoc,
} from '../../io/documents';
import { exportPlanBomCsv, exportPlanRoomsCsv } from '../../io/files';
import { esc } from '../../util/escape';
import { qs } from '../dom';
import { delegate, icon, plural } from '../kit';

const MODE_OF: Readonly<Record<Where, Mode>> = { home: 'home', rooms: 'rooms', board: 'board', plan: 'plan', dossier: 'dossier' };

/**
 * Espace « Dossier » : les documents à remettre. À gauche, la liste (cochés : ceux qui partent à
 * l'impression) et ce qu'il reste à régler ; à droite, l'aperçu exact du document choisi.
 */
export class DossierView {
  private readonly el = qs<HTMLElement>('#dossierView');
  private key = '';
  /** Document affiché dans l'aperçu. */
  private current = 'unifilaire';
  /** Choix de l'utilisateur pour l'impression (absent : valeur par défaut du document). */
  private readonly picked = new Map<string, boolean>();

  constructor(private readonly store: Store) {
    this.bind();
    store.subscribe(() => this.render());
  }

  private included(d: DossierDoc): boolean {
    return this.picked.get(d.key) ?? d.included;
  }

  private bind(): void {
    const { store, el } = this;

    const open = (key: string): void => {
      this.current = key;
      this.rerender();
      // Sur téléphone, la liste et l'aperçu se suivent : on amène l'aperçu à l'écran.
      if (window.matchMedia('(max-width: 860px)').matches) {
        el.querySelector('.dossier-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    delegate(el, 'click', '[data-doc]', (row, e) => {
      if ((e.target as Element).closest('input')) return;
      open(row.dataset.doc as string);
    });
    delegate(el, 'keydown', '[data-doc]', (row, e) => {
      if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      const key = row.dataset.doc as string;
      open(key);
      el.querySelector<HTMLElement>(`[data-doc="${key}"]`)?.focus();
    });
    delegate(el, 'change', '[data-include]', (box) => {
      this.picked.set(box.dataset.include as string, (box as HTMLInputElement).checked);
      this.rerender();
    });
    delegate(el, 'click', '[data-print]', (b) => {
      const { doc } = store.state;
      const docs = dossierDocs(doc);
      const which = b.dataset.print === 'one' ? docs.filter((d) => d.key === this.current) : docs.filter((d) => this.included(d));
      if (which.length > 0) printDocuments(doc, which);
    });
    delegate(el, 'click', '[data-export]', (b) => {
      const { doc } = store.state;
      const d = dossierDocs(doc).find((x) => x.key === this.current);
      if (!d) return;
      if (b.dataset.export === 'png') exportDocumentPng(doc, d);
      else exportDocumentSvg(doc, d);
    });
    delegate(el, 'click', '[data-csv]', (b) => {
      const { doc } = store.state;
      if (b.dataset.csv === 'rooms') exportPlanRoomsCsv(doc);
      else exportPlanBomCsv(doc);
    });
    delegate(el, 'click', '[data-fix]', (li, e) => {
      if ((e.target as Element).closest('[data-act]')) return;
      store.change((s) => (s.mode = MODE_OF[li.dataset.fix as Where]));
    });
    delegate(el, 'click', '[data-act]', (b) => {
      if (b.dataset.act === 'connect') connectUnlinked(store);
      else if (b.dataset.act === 'verify') confirmPositions(store);
    });
    delegate(el, 'click', '[data-go]', (b) => store.change((s) => (s.mode = b.dataset.go as Mode)));

    // Devis : prix unitaires et TVA, enregistrés dans le chantier.
    delegate(el, 'change', '[data-price]', (input) => {
      const value = Number((input as HTMLInputElement).value.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0) return;
      const { project } = store.state.doc;
      patchProject(store, { prices: { ...project.prices, [input.dataset.price as string]: value } });
      store.commit();
    });
    delegate(el, 'change', '[data-vat]', (input) => {
      const value = Number((input as HTMLInputElement).value.replace(',', '.'));
      if (!Number.isFinite(value) || value < 0 || value > 100) return;
      patchProject(store, { vat: value });
      store.commit();
    });
  }

  private rerender(): void {
    this.key = '';
    this.render();
  }

  private render(): void {
    const { store } = this;
    if (store.state.mode !== 'dossier') return;
    const key = `${store.revision}:${this.current}:${[...this.picked.entries()].join(',')}:${store.state.doc.name}`;
    if (key === this.key) return;
    this.key = key;

    const { doc } = store.state;
    const rules = rulesOf(doc);
    const docs = dossierDocs(doc);

    if (docs.length === 0) {
      this.el.innerHTML = `<div class="empty-state">
        ${icon('file', 40)}
        <h2>Le dossier se construit tout seul</h2>
        <p>Comptez des points et créez des circuits : le ${esc(rules.docs.unifilaire.toLowerCase())} et le ${esc(rules.docs.position.toLowerCase())} apparaîtront ici, prêts à imprimer.</p>
        <button type="button" class="primary big" data-go="rooms">Ajouter les pièces ${icon('arrow', 16)}</button>
      </div>`;
      return;
    }

    if (!docs.some((d) => d.key === this.current)) this.current = (docs[0] as DossierDoc).key;
    const current = docs.find((d) => d.key === this.current) as DossierDoc;
    const selected = docs.filter((d) => this.included(d));
    const checks = runProjectChecks(doc);
    const blocking = checks.filter((c) => c.severity !== 'info');

    const groups = (Object.keys(DOC_GROUPS) as DossierDoc['group'][])
      .map((g) => {
        const list = docs.filter((d) => d.group === g);
        if (list.length === 0) return '';
        return `<h3>${esc(DOC_GROUPS[g])}</h3>${list
          .map(
            (d) => `<div class="doc-row${d.key === this.current ? ' active' : ''}" data-doc="${d.key}" role="button" tabindex="0">
              <input type="checkbox" data-include="${d.key}"${this.included(d) ? ' checked' : ''} aria-label="Inclure à l’impression : ${esc(d.title)}">
              <span class="doc-text"><b>${esc(d.title)}</b><small>${esc(d.hint)}</small></span>
              ${icon('chevron', 16)}
            </div>`,
          )
          .join('')}`;
      })
      .join('');

    const status =
      checks.length === 0
        ? `<p class="ok-line">${icon('check', 18)} Rien à signaler : le dossier est prêt.</p>`
        : `<ul class="check-list compact">${checks
            .slice(0, 6)
            .map((c) => {
              const act =
                c.action === 'connect'
                  ? '<button type="button" data-act="connect">Proposer</button>'
                  : c.action === 'verify'
                    ? '<button type="button" data-act="verify">Valider</button>'
                    : '';
              return `<li class="${c.severity}" data-fix="${c.where}">${icon(c.severity === 'info' ? 'info' : c.severity === 'warn' ? 'warn' : 'error', 16)}<span>${esc(c.text)}</span>${act}</li>`;
            })
            .join('')}</ul>${checks.length > 6 ? `<p class="muted small">… et ${checks.length - 6} autres, dans l’espace Chantier.</p>` : ''}`;

    const copies = rules.docs.copies > 1 ? ` Les schémas se remettent en ${rules.docs.copies} exemplaires, datés et signés.` : '';

    this.el.innerHTML = `
      <aside class="dossier-side">
        <header class="pane-head"><h2>Dossier</h2></header>
        <section class="dossier-status${blocking.length > 0 ? ' warn' : ''}">
          <h3>Avant de remettre</h3>
          ${status}
        </section>
        <button type="button" class="primary big wide" data-print="all"${selected.length === 0 ? ' disabled' : ''}>
          ${icon('print', 18)} Imprimer ${plural(selected.length, 'document')}
        </button>
        <p class="muted small">L’impression s’ouvre dans le navigateur : choisissez « Enregistrer au format PDF » pour un fichier.${copies}</p>
        <div class="doc-list">${groups}</div>
      </aside>

      <section class="dossier-main">
        <header class="preview-bar">
          <div><h2>${esc(current.title)}</h2><p class="muted">${esc(current.hint)}</p></div>
          <div class="row">
            <button type="button" data-print="one">${icon('print', 16)} Imprimer</button>
            <button type="button" data-export="png">PNG</button>
            <button type="button" data-export="svg">SVG</button>
            ${current.key === 'materiel' ? '<button type="button" data-csv="bom">CSV</button>' : ''}
            ${current.key === 'points' ? '<button type="button" data-csv="rooms">CSV pièces</button>' : ''}
          </div>
        </header>
        ${current.key === 'devis' ? this.pricesHtml() : ''}
        <div class="sheet">${documentSvg(doc, current)}</div>
      </section>`;
  }

  /** Éditeur du devis : un prix unitaire par ligne, enregistré dans le chantier. */
  private pricesHtml(): string {
    const { doc } = this.store.state;
    const q = buildQuote(doc);
    return `<section class="prices card">
      <header><h3>Vos prix unitaires (hors taxes)</h3>
        <label class="inl">TVA <input type="number" data-vat value="${doc.project.vat}" min="0" max="100" step="0.5" inputmode="decimal"> %</label></header>
      <p class="muted small">Prix d’exemple à remplacer par les vôtres : ils sont enregistrés avec le chantier.</p>
      <div class="price-grid">${q.lines
        .map(
          (l) => `<label class="price"><span>${esc(l.label)} <small>× ${l.qty}</small></span>
            <span class="price-input"><input type="number" data-price="${esc(l.key)}" value="${priceOf(doc, l.key)}" min="0" step="1" inputmode="decimal"> €</span></label>`,
        )
        .join('')}</div>
      <p class="price-total">Total HT <b>${fmtMoney(q.subtotal)}</b> · TTC <b>${fmtMoney(q.total)}</b></p>
    </section>`;
  }
}
