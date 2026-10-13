import { patchDevice, removeDevice, duplicateDevice, moveDevice } from '../../core/boardActions';
import type { Store } from '../../core/store';
import { SECTIONS, USAGES, USAGE_IDS, getDeviceDef, suggestSection } from '../../domain/board/catalog';
import { fmtSection } from '../../domain/board/bom';
import { runChecks, RESERVE_RATIO } from '../../domain/board/checks';
import { analyze, canPlace, deviceWidth, effectiveUsage, isCircuitRole } from '../../domain/board/layout';
import type { Board, Curve, Device, DiffType, UsageId } from '../../domain/board/types';
import { esc } from '../../util/escape';

const option = (value: string | number, label: string, selected: boolean): string =>
  `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

const ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' } as const;

/** Panneau de droite : réglages de l'appareil sélectionné, synthèse du tableau et contrôles. */
export class BoardSidePanel {
  private key = '';

  constructor(
    private readonly el: HTMLElement,
    private readonly store: Store,
  ) {
    store.subscribe(() => this.render());
  }

  focusLabel(): void {
    this.el.querySelector<HTMLInputElement>('#dLabel')?.focus();
  }

  private render(): void {
    const { deviceSelection, mode } = this.store.state;
    if (mode !== 'board') return;
    const board = this.store.activeBoard;
    const key = `${board?.id}:${deviceSelection}:${this.store.revision}`;
    if (key === this.key) return;
    this.key = key;
    if (!board) {
      this.el.innerHTML = '';
      return;
    }
    const device = board.devices.find((d) => d.id === deviceSelection);
    this.el.innerHTML = (device ? this.deviceForm(board, device) : this.summary(board)) + this.checksHtml(board);
    if (device) this.bindDevice(board, device);
    this.bindChecks();
  }

  private summary(board: Board): string {
    const a = analyze(board);
    const free = a.totalModules - a.usedModules;
    const pct = a.totalModules ? Math.round((free / a.totalModules) * 100) : 0;
    const low = a.totalModules > 0 && free / a.totalModules < RESERVE_RATIO;
    const usages = new Map<UsageId, number>();
    for (const d of a.circuits) usages.set(effectiveUsage(d), (usages.get(effectiveUsage(d)) ?? 0) + 1);
    const legend = USAGE_IDS.filter((u) => usages.has(u))
      .map((u) => `<li><i style="background:${USAGES[u].color}"></i>${esc(USAGES[u].name)} <b>${usages.get(u)}</b></li>`)
      .join('');
    return `
      <h3>Synthèse</h3>
      <div class="stat"><b>${a.circuits.length}</b> circuit${a.circuits.length > 1 ? 's' : ''} · <b>${a.groups.filter((g) => g.head).length}</b> différentiel${a.groups.filter((g) => g.head).length > 1 ? 's' : ''}</div>
      <div class="meter"><span style="width:${Math.min(100, 100 - pct)}%" class="${low ? 'low' : ''}"></span></div>
      <p class="muted">${a.usedModules} / ${a.totalModules} modules utilisés · ${free} libres (${pct} %)</p>
      ${legend ? `<ul class="legend">${legend}</ul>` : ''}
      <p class="muted">Cliquez un appareil pour le régler. Glissez-le pour le déplacer, <kbd>Suppr</kbd> pour l'enlever.</p>`;
  }

  private deviceForm(board: Board, d: Device): string {
    const def = getDeviceDef(d.kind);
    if (!def) return '';
    const a = analyze(board);
    const circuit = isCircuitRole(def);
    const ref = a.refs.get(d.id);
    let h = `<h3>${esc(def.name)}${ref ? ` · ${esc(ref)}` : ''}</h3>`;
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
  }

  private checksHtml(board: Board): string {
    const checks = runChecks(board);
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
        if (Number.isFinite(id) && li.dataset.dev !== '') this.store.change((s) => (s.deviceSelection = id));
      };
    });
  }
}
