import { connectUnlinked } from '../../core/planActions';
import { confirmPositions, patchProject, setCountry } from '../../core/pointActions';
import type { Mode, Store } from '../../core/store';
import { COUNTRIES, JOB_KINDS, rulesFor, rulesOf } from '../../domain/rules';
import { projectProgress, runProjectChecks, type ProjectCheck, type Where } from '../../domain/rules/checks';
import type { Country, JobKind } from '../../domain/types';
import { esc } from '../../util/escape';
import { qs } from '../dom';
import { delegate, flag, icon, plural, ring } from '../kit';

const WHERE: Readonly<Record<Where, { mode: Mode; label: string }>> = {
  home: { mode: 'home', label: 'Compléter' },
  rooms: { mode: 'rooms', label: 'Voir les pièces' },
  board: { mode: 'board', label: 'Voir le tableau' },
  plan: { mode: 'plan', label: 'Voir le plan' },
  dossier: { mode: 'dossier', label: 'Voir le dossier' },
};

const SEVERITY_ICON = { error: 'error', warn: 'warn', info: 'info' } as const;

/**
 * Espace « Chantier » : l'identité du chantier (saisie une fois, reprise sur chaque document),
 * l'avancement, la prochaine chose à faire et la liste de contrôle du pays.
 */
export class HomeView {
  private readonly el = qs<HTMLElement>('#homeView');
  private key = '';

  constructor(private readonly store: Store) {
    this.bind();
    store.subscribe(() => this.render());
    this.render();
  }

  private bind(): void {
    const { store, el } = this;

    delegate(el, 'click', '[data-go]', (b) => store.change((s) => (s.mode = b.dataset.go as Mode)));
    delegate(el, 'click', '[data-country]', (b) => setCountry(store, b.dataset.country as Country));
    delegate(el, 'click', '[data-act]', (b) => {
      switch (b.dataset.act) {
        case 'connect':
          connectUnlinked(store);
          break;
        case 'verify':
          confirmPositions(store);
          break;
        case 'example':
          document.dispatchEvent(new CustomEvent('wirely:example'));
          break;
        case 'open':
          document.dispatchEvent(new CustomEvent('wirely:open'));
          break;
        case 'address':
          el.querySelector<HTMLInputElement>('[data-field=address]')?.focus();
          break;
      }
    });
    delegate(el, 'click', '[data-check]', (li, e) => {
      // Un bouton d'action dans la ligne a déjà fait le travail.
      if ((e.target as Element).closest('[data-act]')) return;
      const where = li.dataset.where as Where;
      const room = li.dataset.room;
      const device = li.dataset.device;
      if (where === 'home') {
        el.querySelector<HTMLInputElement>('[data-field=address]')?.focus();
        return;
      }
      store.change((s) => {
        s.mode = WHERE[where].mode;
        if (room) s.roomId = Number(room);
        if (device) {
          s.deviceSelection = Number(device);
          s.boardView = 'circuits';
        }
      });
    });

    // Renseignements du chantier : saisie libre, validée à la sortie du champ.
    delegate(el, 'input', '[data-field]', (input) => {
      const field = input.dataset.field as 'client' | 'address' | 'installer' | 'date';
      patchProject(store, { [field]: (input as HTMLInputElement).value });
    });
    delegate(el, 'change', '[data-field]', () => store.commit());
    delegate(el, 'change', '[data-kind]', (sel) => {
      patchProject(store, { kind: (sel as HTMLSelectElement).value as JobKind });
      store.commit();
    });
  }

  private render(): void {
    const { store } = this;
    if (store.state.mode !== 'home') return;
    const key = String(store.revision);
    if (key === this.key) return;
    this.key = key;

    const { doc } = store.state;
    const rules = rulesOf(doc);
    const p = doc.project;
    const progress = projectProgress(doc);
    const checks = runProjectChecks(doc);
    const empty = progress.rooms === 0 && progress.circuits === 0;

    this.el.innerHTML = `<div class="center-col">
      <section class="hero card">
        <div class="hero-main">
          <p class="eyebrow">Chantier</p>
          <h1>${esc(doc.name)}</h1>
          <div class="seg country" role="group" aria-label="Pays">
            ${COUNTRIES.map((c) => {
              const r = rulesFor(c);
              return `<button type="button" data-country="${c}" class="${c === p.country ? 'active' : ''}">${flag(c)} ${esc(r.label)}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="hero-progress">
          ${ring(progress.percent / 100, `${progress.percent} %`, 96)}
          <div>${this.next(progress.points, progress.circuits, checks, empty)}</div>
        </div>
      </section>

      ${empty ? this.startCard() : this.stepsHtml(progress.steps)}

      <div class="home-grid">
        <section class="card">
          <h2>Renseignements du chantier</h2>
          <p class="muted">Saisis une fois, repris sur chaque document du dossier.</p>
          <div class="form-grid">
            <label class="fld"><span>Client ou propriétaire</span>
              <input type="text" data-field="client" value="${esc(p.client)}" placeholder="M. et Mme Dupont" autocomplete="off"></label>
            <label class="fld"><span>Nature des travaux</span>
              <select data-kind>${(Object.keys(JOB_KINDS) as JobKind[])
                .map((k) => `<option value="${k}"${k === p.kind ? ' selected' : ''}>${esc(JOB_KINDS[k])}</option>`)
                .join('')}</select></label>
            <label class="fld wide"><span>Adresse de l’installation</span>
              <input type="text" data-field="address" value="${esc(p.address)}" placeholder="Rue, numéro, code postal, localité" autocomplete="off"></label>
            <label class="fld"><span>Installateur</span>
              <input type="text" data-field="installer" value="${esc(p.installer)}" placeholder="Votre société, n° d’entreprise" autocomplete="off"></label>
            <label class="fld"><span>Date des documents</span>
              <input type="date" data-field="date" value="${esc(p.date)}"></label>
          </div>
        </section>

        <section class="card">
          <h2>Liste de contrôle <small>${esc(rules.code)}</small></h2>
          ${this.checksHtml(checks, empty)}
        </section>
      </div>
    </div>`;
  }

  /** La prochaine chose utile à faire, en un bouton. */
  private next(points: number, circuits: number, checks: ProjectCheck[], empty: boolean): string {
    const { doc } = this.store.state;
    const action = (title: string, text: string, btn: string): string =>
      `<p class="next-title">${esc(title)}</p><p class="muted">${esc(text)}</p>${btn}`;
    const go = (mode: Mode, label: string): string =>
      `<button type="button" class="primary big" data-go="${mode}">${esc(label)} ${icon('arrow', 16)}</button>`;

    if (empty) return action('Par où commencer ?', 'Comptez les points pièce par pièce, ou relevez d’abord le tableau.', go('rooms', 'Ajouter les pièces'));
    if (points === 0) return action('Comptez les points', 'Dans chaque pièce : prises, points lumineux, interrupteurs, appareils.', go('rooms', 'Ouvrir les pièces'));
    const connect = checks.find((c) => c.action === 'connect');
    if (connect) {
      return action(
        circuits === 0 ? 'Créez les circuits' : 'Raccordez les points',
        connect.text,
        `<div class="row"><button type="button" class="primary big" data-act="connect">${icon('wand', 16)} Proposer les circuits</button>
         <button type="button" data-go="board">Le faire à la main</button></div>`,
      );
    }
    const blocking = checks.filter((c) => c.severity !== 'info');
    if (blocking.length > 0) {
      const first = blocking[0] as ProjectCheck;
      if (first.where === 'home') return action('Complétez les mentions', first.text, `<button type="button" class="primary big" data-act="address">Renseigner l’adresse</button>`);
      return action(`${plural(blocking.length, 'remarque')} à lever`, first.text, go(WHERE[first.where].mode, WHERE[first.where].label));
    }
    if (checks.some((c) => c.action === 'verify')) {
      return action('Vérifiez le plan', 'Les points comptés ont été posés automatiquement : glissez-les à leur place.', go('plan', 'Ouvrir le plan'));
    }
    if (!doc.project.installer.trim()) return action('Complétez les mentions', 'Indiquez l’installateur : il figure sur le cartouche.', `<button type="button" class="primary big" data-act="address">Compléter</button>`);
    return action('Le dossier est prêt', 'Aperçu, impression et export des schémas.', go('dossier', 'Ouvrir le dossier'));
  }

  private startCard(): string {
    return `<section class="card start-grid">
      <button type="button" class="choice" data-go="rooms">
        ${icon('grid', 26)}<b>Compter les points</b>
        <span>Pièce par pièce : prises, lumières, commandes. Le plan et les schémas en découlent.</span>
      </button>
      <button type="button" class="choice" data-go="board">
        ${icon('bolt', 26)}<b>Relever un tableau</b>
        <span>Saisissez les circuits tels qu’ils sont, calibre par calibre, puis ce qu’ils alimentent.</span>
      </button>
      <button type="button" class="choice" data-act="example">
        ${icon('file', 26)}<b>Voir un exemple</b>
        <span>Un appartement équipé, avec son tableau et son dossier.</span>
      </button>
    </section>`;
  }

  private stepsHtml(steps: ReturnType<typeof projectProgress>['steps']): string {
    return `<section class="steps-row">${steps
      .map(
        (s, i) => `<button type="button" class="step-card${s.done ? ' done' : ''}" data-go="${WHERE[s.where].mode}">
          <span class="step-num">${s.done ? icon('check', 16) : i + 1}</span>
          <span class="step-text"><b>${esc(s.label)}</b><small>${esc(s.text)}</small></span>
          <span class="bar"><i style="width:${Math.round(s.ratio * 100)}%"></i></span>
        </button>`,
      )
      .join('')}</section>`;
  }

  private checksHtml(checks: ProjectCheck[], empty: boolean): string {
    if (empty) return '<p class="muted">Elle se remplit dès que vous comptez des points ou des circuits.</p>';
    if (checks.length === 0) return `<p class="ok-line">${icon('check', 18)} Rien à signaler.</p>`;
    const rules = rulesOf(this.store.state.doc);
    return `<ul class="check-list">${checks
      .map((c) => {
        const act =
          c.action === 'connect'
            ? `<button type="button" data-act="connect">Proposer les circuits</button>`
            : c.action === 'verify'
              ? `<button type="button" data-act="verify">Tout valider</button>`
              : '';
        return `<li class="${c.severity}" data-check data-where="${c.where}"${c.roomId !== undefined ? ` data-room="${c.roomId}"` : ''}${
          c.deviceId !== undefined ? ` data-device="${c.deviceId}"` : ''
        }>${icon(SEVERITY_ICON[c.severity], 18)}<span>${esc(c.text)}</span>${act}${icon('chevron', 16)}</li>`;
      })
      .join('')}</ul>
      <p class="muted small">Repères indicatifs (${esc(rules.code)}) : ils ne remplacent pas ${esc(rules.docs.controller)}.</p>`;
  }
}
