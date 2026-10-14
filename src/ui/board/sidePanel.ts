import { patchDevice, removeDevice, duplicateDevice, moveDevice } from '../../core/boardActions';
import { focusDevice, showCircuitOnPlan, showItemOnPlan, startAssigning } from '../../core/links';
import type { Store } from '../../core/store';
import { SECTIONS, USAGES, USAGE_IDS, getDeviceDef, suggestSection } from '../../domain/board/catalog';
import { deviceSpec, fmtSection } from '../../domain/board/bom';
import { runChecks, RESERVE_RATIO } from '../../domain/board/checks';
import { analyze, canPlace, deviceWidth, effectiveUsage, isCircuitRole } from '../../domain/board/layout';
import type { Board, Curve, Device, DiffType, UsageId } from '../../domain/board/types';
import { getSymbol, getWireType } from '../../domain/catalog';
import { runLinkChecks } from '../../domain/link/checks';
import {
  allLinks,
  circuitLinks,
  circuitSearchText,
  linksSummary,
  type CircuitLinks,
} from '../../domain/link/links';
import { fmtLength, polylineLength, toMeters } from '../../domain/plan/metrics';
import { esc } from '../../util/escape';

const option = (value: string | number, label: string, selected: boolean): string =>
  `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

const ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' } as const;

type Tab = 'settings' | 'circuits';

/**
 * Panneau de droite du tableau. Deux onglets :
 * - Réglages : appareil sélectionné (avec ce qu'il y a derrière), synthèse et contrôles ;
 * - Circuits : tous les disjoncteurs par différentiel, avec recherche — pensé pour les gros tableaux.
 */
export class BoardSidePanel {
  private key = '';
  private tab: Tab = 'settings';

  constructor(
    private readonly el: HTMLElement,
    private readonly store: Store,
  ) {
    store.subscribe(() => this.render());
  }

  focusLabel(): void {
    this.tab = 'settings';
    this.el.querySelector<HTMLInputElement>('#dLabel')?.focus();
  }

  private render(): void {
    const { deviceSelection, mode } = this.store.state;
    if (mode !== 'board') return;
    const board = this.store.activeBoard;

    // Dans l'onglet Circuits la sélection ne reconstruit pas la liste (position de défilement, recherche) :
    // seule la ligne active change.
    const key =
      this.tab === 'circuits'
        ? `${board?.id}:c:${this.store.revision}`
        : `${board?.id}:${deviceSelection}:${this.store.revision}:s`;
    if (key === this.key) {
      this.syncSelection();
      return;
    }
    this.key = key;
    if (!board) {
      this.el.innerHTML = '';
      return;
    }

    const a = analyze(board);
    const tabs = `<div class="seg side-tabs">
        <button type="button" data-tab="settings" class="${this.tab === 'settings' ? 'active' : ''}">Réglages</button>
        <button type="button" data-tab="circuits" class="${this.tab === 'circuits' ? 'active' : ''}">Circuits <span class="badge">${a.circuits.length}</span></button>
      </div>`;

    if (this.tab === 'circuits') {
      this.el.innerHTML = tabs + this.circuitsTab(board);
      this.bindCircuits();
    } else {
      const device = board.devices.find((d) => d.id === deviceSelection);
      this.el.innerHTML = tabs + (device ? this.deviceForm(board, device) : this.summary(board)) + this.checksHtml(board);
      if (device) this.bindDevice(board, device);
      this.bindChecks();
    }
    this.el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab as Tab;
        this.key = '';
        this.render();
      };
    });
    this.syncSelection();
  }

  // ---------------------------------------------------------------- onglet Circuits

  private circuitsTab(board: Board): string {
    const { doc, boardFilter } = this.store.state;
    const a = analyze(board);
    const links = allLinks(doc);

    const rows = (members: Device[]): string =>
      members
        .filter((d) => {
          const def = getDeviceDef(d.kind);
          return def !== undefined && isCircuitRole(def);
        })
        .map((d) => {
          const l = links.get(d.id);
          const n = l ? l.symbols.length + l.wires.length : 0;
          const usage = USAGES[effectiveUsage(d)];
          const name = d.label.trim() || getDeviceDef(d.kind)?.name || '';
          const text = circuitSearchText(d, a, links);
          return `<li class="circ" data-dev="${d.id}" data-text="${esc(text)}">
            <i class="dot" style="background:${usage.color}"></i>
            <span class="ref">${esc(a.refs.get(d.id) ?? '')}</span>
            <span class="name"><b>${esc(name)}</b><small>${esc(deviceSpec(d))}${d.dest ? ` · ${esc(d.dest)}` : ''}</small></span>
            <span class="wired${n ? '' : ' none'}">${n && l ? esc(linksSummary(l)) : 'non raccordé'}</span>
            <button type="button" class="go" data-plan="${d.id}" title="Voir sur le plan"${n ? '' : ' disabled'}>↗</button>
          </li>`;
        })
        .join('');

    const groups = a.groups
      .map((g) => {
        const circuits = g.members.filter((d) => {
          const def = getDeviceDef(d.kind);
          return def !== undefined && isCircuitRole(def);
        });
        if (circuits.length === 0) return '';
        const wired = circuits.reduce((n, d) => n + (links.get(d.id)?.symbols.length ?? 0) + (links.get(d.id)?.wires.length ?? 0), 0);
        const title = g.head
          ? `${esc(a.refs.get(g.head.id) ?? '')} · ${esc(deviceSpec(g.head))}`
          : 'Sans différentiel amont';
        return `<details class="grp" open data-head="${g.head?.id ?? ''}">
          <summary><span>${title}</span><span class="count">${circuits.length}</span></summary>
          <p class="muted grp-info">${wired} élément${wired > 1 ? 's' : ''} raccordé${wired > 1 ? 's' : ''} du plan</p>
          <ul class="circs">${rows(circuits)}</ul>
        </details>`;
      })
      .join('');

    return `<div class="ctab">
      <input type="search" id="cFilter" placeholder="Rechercher : nom, pièce, repère, prise…" value="${esc(boardFilter)}" aria-label="Rechercher un circuit">
      <p class="muted" id="cCount"></p>
      <div id="cList">${groups || '<p class="muted">Aucun disjoncteur dans ce tableau.</p>'}</div>
    </div>`;
  }

  private bindCircuits(): void {
    const { store } = this;
    const filter = this.el.querySelector<HTMLInputElement>('#cFilter');

    const apply = () => {
      const q = this.normalize(filter?.value ?? '');
      const terms = q.split(/\s+/).filter(Boolean);
      let shown = 0;
      let total = 0;
      this.el.querySelectorAll<HTMLElement>('.circ').forEach((li) => {
        total++;
        const hit = terms.every((t) => (li.dataset.text ?? '').includes(t));
        li.hidden = !hit;
        if (hit) shown++;
      });
      this.el.querySelectorAll<HTMLElement>('details.grp').forEach((g) => {
        g.hidden = !g.querySelector('.circ:not([hidden])');
      });
      const count = this.el.querySelector('#cCount');
      if (count) count.textContent = terms.length ? `${shown} circuit${shown > 1 ? 's' : ''} sur ${total}` : `${total} circuit${total > 1 ? 's' : ''}`;
    };
    apply();

    if (filter) {
      filter.oninput = () => {
        apply();
        // La face avant met en retrait ce qui ne correspond pas ; le panneau, lui, n'est pas reconstruit.
        store.change((s) => (s.boardFilter = filter.value));
      };
    }

    this.el.querySelector<HTMLElement>('#cList')?.addEventListener('click', (e) => {
      const target = e.target as Element;
      const go = target.closest<HTMLElement>('[data-plan]');
      if (go) {
        showCircuitOnPlan(store, Number(go.dataset.plan));
        return;
      }
      const row = target.closest<HTMLElement>('.circ');
      if (row) focusDevice(store, Number(row.dataset.dev));
    });
  }

  private syncSelection(): void {
    const id = this.store.state.deviceSelection;
    this.el.querySelectorAll<HTMLElement>('.circ').forEach((li) => li.classList.toggle('active', Number(li.dataset.dev) === id));
    if (id !== null) this.el.querySelector('.circ.active')?.scrollIntoView({ block: 'nearest' });
  }

  private normalize(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // ---------------------------------------------------------------- réglages

  private summary(board: Board): string {
    const { doc } = this.store.state;
    const a = analyze(board);
    const free = a.totalModules - a.usedModules;
    const pct = a.totalModules ? Math.round((free / a.totalModules) * 100) : 0;
    const low = a.totalModules > 0 && free / a.totalModules < RESERVE_RATIO;
    const usages = new Map<UsageId, number>();
    for (const d of a.circuits) usages.set(effectiveUsage(d), (usages.get(effectiveUsage(d)) ?? 0) + 1);
    const legend = USAGE_IDS.filter((u) => usages.has(u))
      .map((u) => `<li><i style="background:${USAGES[u].color}"></i>${esc(USAGES[u].name)} <b>${usages.get(u)}</b></li>`)
      .join('');

    const links = allLinks(doc);
    const wiredCircuits = a.circuits.filter((d) => (links.get(d.id)?.symbols.length ?? 0) + (links.get(d.id)?.wires.length ?? 0) > 0).length;

    return `
      <h3>Synthèse</h3>
      <div class="stat"><b>${a.circuits.length}</b> circuit${a.circuits.length > 1 ? 's' : ''} · <b>${a.groups.filter((g) => g.head).length}</b> différentiel${a.groups.filter((g) => g.head).length > 1 ? 's' : ''}</div>
      <div class="meter"><span style="width:${Math.min(100, 100 - pct)}%" class="${low ? 'low' : ''}"></span></div>
      <p class="muted">${a.usedModules} / ${a.totalModules} modules utilisés · ${free} libres (${pct} %)</p>
      <p class="muted"><b>${wiredCircuits}</b> / ${a.circuits.length} circuits raccordés à des lignes du plan.</p>
      ${legend ? `<ul class="legend">${legend}</ul>` : ''}
      <p class="muted">Cliquez un appareil pour le régler. Glissez-le pour le déplacer, <kbd>Suppr</kbd> pour l'enlever.
      L'onglet <b>Circuits</b> liste tous les disjoncteurs et permet de les rechercher.</p>`;
  }

  /** Ce qu'il y a derrière un disjoncteur : appareils, câbles, pièces, avec accès direct au plan. */
  private behind(board: Board, d: Device): string {
    const { doc } = this.store.state;
    const def = getDeviceDef(d.kind);
    if (!def) return '';
    const a = analyze(board);

    if (def.role === 'rcd') {
      const group = a.groups.find((g) => g.head?.id === d.id);
      const circuits = group?.members.filter((m) => {
        const md = getDeviceDef(m.kind);
        return md !== undefined && isCircuitRole(md);
      }) ?? [];
      const elements = circuits.reduce((n, m) => {
        const l = circuitLinks(doc, m.id);
        return n + l.symbols.length + l.wires.length;
      }, 0);
      return `<h3>Derrière ce différentiel</h3>
        <p class="muted">Protège <b>${circuits.length}</b> circuit${circuits.length > 1 ? 's' : ''}, soit <b>${elements}</b> élément${elements > 1 ? 's' : ''} raccordé${elements > 1 ? 's' : ''} du plan.</p>`;
    }
    if (!isCircuitRole(def)) return '';

    const l = circuitLinks(doc, d.id);
    const n = l.symbols.length + l.wires.length;
    const assign = `<button type="button" id="dAssign" title="Passe sur le plan avec ce circuit actif et l'outil Affecter">🔗 Raccorder depuis le plan…</button>`;
    if (n === 0) {
      return `<h3>Derrière ce disjoncteur</h3>
        <p class="muted">Aucune ligne du plan n'est raccordée à ce disjoncteur.</p>
        <div class="row">${assign}</div>`;
    }
    const tiles = [
      l.sockets ? `<div class="tile"><b>${l.sockets}</b><span>prise${l.sockets > 1 ? 's' : ''}</span></div>` : '',
      l.lights ? `<div class="tile"><b>${l.lights}</b><span>lumière${l.lights > 1 ? 's' : ''}</span></div>` : '',
      l.switches ? `<div class="tile"><b>${l.switches}</b><span>commande${l.switches > 1 ? 's' : ''}</span></div>` : '',
      l.length > 0 ? `<div class="tile"><b>${l.length.toFixed(1).replace('.', ',')}</b><span>m de câble</span></div>` : '',
    ].filter(Boolean).join('');
    const rooms = l.rooms.map((r) => `<li><span>${esc(r.label)}</span><b>${r.count}</b></li>`).join('');
    return `<h3>Derrière ce disjoncteur</h3>
      <div class="tiles tiles-wrap">${tiles}</div>
      ${rooms ? `<ul class="legend">${rooms}</ul>` : ''}
      <div class="row">
        <button type="button" id="dShowPlan" class="primary">Voir sur le plan ↗</button>
        ${assign}
      </div>
      <details class="more"><summary>Détail des ${n} éléments</summary>
        <ul class="items">${this.itemRows(l)}</ul>
      </details>`;
  }

  private itemRows(l: CircuitLinks): string {
    const { doc } = this.store.state;
    const sym = l.symbols.map((s) => {
      const name = getSymbol(s.kind)?.name ?? s.kind;
      return `<li data-item="${s.id}">${esc(name)}${s.label.trim() ? ` « ${esc(s.label.trim())} »` : ''}</li>`;
    });
    const wires = l.wires.map((w) => {
      const m = toMeters(doc.scale, polylineLength(w.points));
      return `<li data-item="${w.id}">Câble ${esc(getWireType(w.wtype).name)} · ${esc(fmtLength(m))}</li>`;
    });
    return [...sym, ...wires].join('');
  }

  private deviceForm(board: Board, d: Device): string {
    const def = getDeviceDef(d.kind);
    if (!def) return '';
    const a = analyze(board);
    const circuit = isCircuitRole(def);
    const ref = a.refs.get(d.id);
    let h = `<h3>${esc(def.name)}${ref ? ` · ${esc(ref)}` : ''}</h3>`;
    h += this.behind(board, d);
    if (def.ref) {
      const doc = def.source ? ` · <a href="${esc(def.source)}" target="_blank" rel="noopener">fiche</a>` : '';
      h += `<p class="muted">Réf. <b>${esc(def.ref)}</b>${def.info ? ` · ${esc(def.info)}` : ''}${doc}</p>`;
    }
    if (def.unverified) h += `<p class="note-warn">⚠ ${esc(def.unverified)}</p>`;

    if (circuit || def.role === 'rcd' || def.role === 'feeder' || def.role === 'aux') {
      if (def.id !== 'vide') {
        h += `<label class="f" for="dLabel">Désignation</label>
          <input type="text" id="dLabel" value="${esc(d.label)}" placeholder="ex. Prises cuisine">`;
        h += `<label class="f" for="dDest">Destination / pièce</label>
          <input type="text" id="dDest" value="${esc(d.dest)}" placeholder="ex. Cuisine">`;
      }
    }

    if (def.variants.length > 1) {
      h += `<label class="f" for="dVariant">${def.id === 'bornier' || def.id === 'vide' ? 'Largeur' : 'Pôles'}</label>
        <select id="dVariant">${def.variants.map((v) => option(v.id, `${v.label} · ${v.width} mod.`, v.id === d.variant)).join('')}</select>`;
    }

    const fields: string[] = [];
    if (def.ratings) {
      fields.push(`<div><label class="f" for="dRating">Calibre</label>
        <select id="dRating">${def.ratings.map((r) => option(r, `${r} A`, r === d.rating)).join('')}</select></div>`);
    }
    if (def.curves) {
      fields.push(`<div><label class="f" for="dCurve">Courbe</label>
        <select id="dCurve">${def.curves.map((c) => option(c, c, c === d.curve)).join('')}</select></div>`);
    }
    if (fields.length) h += `<div class="two">${fields.join('')}</div>`;

    if (def.sensitivities && def.diffTypes) {
      h += `<div class="two"><div><label class="f" for="dSens">Sensibilité</label>
        <select id="dSens">${def.sensitivities.map((s) => option(s, `${s} mA`, s === d.sensitivity)).join('')}</select></div>
        <div><label class="f" for="dType">Type</label>
        <select id="dType">${def.diffTypes.map((t) => option(t, t, t === d.diffType)).join('')}</select></div></div>`;
    }

    if (circuit) {
      const auto = d.rating !== null ? suggestSection(d.rating) : null;
      h += `<div class="two"><div><label class="f" for="dSection">Section câble</label>
        <select id="dSection">${option('', `Auto${auto ? ` (${fmtSection(auto)})` : ''}`, d.section === null)}${SECTIONS.map((s) => option(s, fmtSection(s), s === d.section)).join('')}</select></div>
        <div><label class="f" for="dUsage">Usage</label>
        <select id="dUsage">${option('', `Auto (${USAGES[effectiveUsage(d)].name})`, d.usage === null)}${USAGE_IDS.map((u) => option(u, USAGES[u].name, u === d.usage)).join('')}</select></div></div>`;
      const rcd = a.protectedBy.get(d.id);
      h += `<p class="muted">Protégé par : ${rcd ? (rcd.id === d.id ? 'différentiel intégré' : `<b>${esc(a.refs.get(rcd.id) ?? '')}</b>`) : '<b>aucun différentiel</b>'}</p>`;
    }

    if (def.outputs) {
      const inputs = Array.from({ length: def.outputs }, (_, i) =>
        `<label class="out"><span>${i + 1}</span><input type="text" data-out="${i}" value="${esc(d.outputs[i] ?? '')}" placeholder="Sortie ${i + 1}"></label>`,
      ).join('');
      h += `<label class="f">Sorties</label><div class="outs">${inputs}</div>`;
    }

    if (def.id !== 'vide') {
      h += `<label class="f" for="dNote">Remarque</label><textarea id="dNote" rows="2">${esc(d.note)}</textarea>`;
    }
    h += `<div class="row">
      <button id="dLeft" title="Décaler d'un module vers la gauche (←)">←</button>
      <button id="dRight" title="Décaler d'un module vers la droite (→)">→</button>
      <button id="dDup" title="Dupliquer (Ctrl+D)">Dupliquer</button>
      <button id="dDel" class="danger">Supprimer</button></div>`;
    return h;
  }

  private bindDevice(board: Board, d: Device): void {
    const { store } = this;
    const q = <T extends HTMLElement>(id: string): T | null => this.el.querySelector<T>(id);
    const live = (patch: Partial<Device>) => patchDevice(store, d.id, patch);
    const text = (id: string, field: 'label' | 'dest' | 'note') => {
      const input = q<HTMLInputElement | HTMLTextAreaElement>(id);
      if (!input) return;
      input.oninput = () => live({ [field]: input.value });
      input.onchange = () => store.commit();
    };
    text('#dLabel', 'label');
    text('#dDest', 'dest');
    text('#dNote', 'note');

    this.el.querySelectorAll<HTMLInputElement>('[data-out]').forEach((input) => {
      const i = Number(input.dataset.out);
      input.oninput = () => {
        const cur = store.activeBoard?.devices.find((x) => x.id === d.id);
        const count = getDeviceDef(d.kind)?.outputs ?? 0;
        const next = Array.from({ length: count }, (_, k) => (k === i ? input.value : (cur?.outputs[k] ?? '')));
        live({ outputs: next });
      };
      input.onchange = () => store.commit();
    });

    const choice = (id: string, apply: (value: string) => Partial<Device>) => {
      const select = q<HTMLSelectElement>(id);
      if (!select) return;
      select.onchange = () => {
        if (live(apply(select.value))) store.commit();
        else {
          alert('Pas assez de place à droite de cet appareil pour cette largeur.');
          store.commit();
        }
      };
    };
    choice('#dVariant', (v) => ({ variant: v }));
    choice('#dRating', (v) => ({ rating: Number(v) }));
    choice('#dCurve', (v) => ({ curve: v as Curve }));
    choice('#dSens', (v) => ({ sensitivity: Number(v) }));
    choice('#dType', (v) => ({ diffType: v as DiffType }));
    choice('#dSection', (v) => ({ section: v === '' ? null : Number(v) }));
    choice('#dUsage', (v) => ({ usage: v === '' ? null : (v as UsageId) }));

    const nudge = (dc: number) => {
      const cur = store.activeBoard?.devices.find((x) => x.id === d.id);
      if (cur && canPlace(board, cur.row, cur.col + dc, deviceWidth(cur), cur.id) && moveDevice(store, cur.id, cur.row, cur.col + dc)) store.commit();
    };
    q('#dLeft')?.addEventListener('click', () => nudge(-1));
    q('#dRight')?.addEventListener('click', () => nudge(1));
    q('#dDup')?.addEventListener('click', () => duplicateDevice(store, d.id));
    q('#dDel')?.addEventListener('click', () => removeDevice(store, d.id));

    // Liens vers le plan
    q('#dShowPlan')?.addEventListener('click', () => showCircuitOnPlan(store, d.id));
    q('#dAssign')?.addEventListener('click', () => startAssigning(store, d.id));
    this.el.querySelectorAll<HTMLElement>('[data-item]').forEach((li) => {
      li.onclick = () => showItemOnPlan(store, Number(li.dataset.item));
    });
  }

  private checksHtml(board: Board): string {
    const { doc } = this.store.state;
    const checks = [...runChecks(board), ...runLinkChecks(doc, board)];
    if (board.devices.length === 0) return '';
    if (checks.length === 0) return `<h3>Contrôles</h3><p class="ok">✔ Aucun point d'attention.</p>`;
    const items = checks
      .map(
        (c, i) =>
          `<li class="chk ${c.severity}" data-chk="${i}" data-dev="${c.deviceId ?? ''}">${ICON[c.severity]} <span>${esc(c.message)}</span></li>`,
      )
      .join('');
    return `<h3>Contrôles <small>(indicatifs)</small></h3><ul class="checks">${items}</ul>
      <p class="muted">Aide à la conception : ne remplace ni la norme en vigueur ni la vérification d'un professionnel.</p>`;
  }

  private bindChecks(): void {
    this.el.querySelectorAll<HTMLElement>('[data-chk]').forEach((li) => {
      li.onclick = () => {
        const id = Number(li.dataset.dev);
        if (Number.isFinite(id) && li.dataset.dev !== '') focusDevice(this.store, id);
      };
    });
  }
}

