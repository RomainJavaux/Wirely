import { createBoard, removeDevice } from '../../core/boardActions';
import { addCircuit, addRcd, createStandardBoard, ensureBoard, patchCircuit } from '../../core/circuitActions';
import { setActiveCircuit } from '../../core/links';
import { connectUnlinked, generateBoard, notify } from '../../core/planActions';
import type { Store } from '../../core/store';
import { deviceName, deviceSpec } from '../../domain/board/bom';
import { getDeviceDef } from '../../domain/board/catalog';
import { analyze, isCircuitRole, variantOf } from '../../domain/board/layout';
import type { Board, Device, DiffType } from '../../domain/board/types';
import { isElectrical, linksSummary } from '../../domain/link/links';
import { allPoints } from '../../domain/points';
import { rulesOf } from '../../domain/rules';
import { esc } from '../../util/escape';
import { QUICK_RATINGS } from '../circuitPicker';
import { qs } from '../dom';
import { circuitBadge, circuitViews, delegate, icon, loadMeter, plural, type CircuitView } from '../kit';
import { openQuickEntry } from './quickEntryDialog';

const RATINGS = [2, 6, 10, 16, 20, 25, 32, 40, 50, 63];

/**
 * Tableau › Circuits : la liste des circuits, groupés par différentiel. C'est la vue de saisie
 * rapide : une rangée de calibres ajoute un circuit d'un geste, et chaque circuit montre sa charge
 * et ce qu'il alimente. L'implantation sur les rails suit toute seule (vue « Face avant »).
 */
export class CircuitsView {
  private readonly el = qs<HTMLElement>('#circuitsView');
  private key = '';
  /** Circuit dont le détail est déplié. */
  private open: number | null = null;

  constructor(private readonly store: Store) {
    this.bind();
    store.subscribe(() => this.render());
  }

  private bind(): void {
    const { store, el } = this;

    delegate(el, 'click', '[data-start]', (b) => {
      switch (b.dataset.start) {
        case 'standard':
          createStandardBoard(store);
          break;
        case 'blank':
          ensureBoard(store);
          store.commit();
          break;
        case 'generate':
          if (generateBoard(store) === null) notify(store, 'Aucun point à raccorder : comptez d’abord les points dans les pièces.');
          break;
        case 'quick':
          openQuickEntry(store);
          break;
      }
    });
    delegate(el, 'click', '[data-connect]', () => connectUnlinked(store));
    delegate(el, 'click', '[data-quick]', () => openQuickEntry(store));
    delegate(el, 'click', '[data-new-board]', () => createBoard(store, 'empty'));
    delegate(el, 'change', '[data-board-select]', (sel) =>
      store.change((s) => {
        s.boardId = Number((sel as HTMLSelectElement).value);
        s.deviceSelection = null;
      }),
    );

    // Ajouter un circuit ou un différentiel d'un geste.
    delegate(el, 'click', '[data-add-circuit]', (b) => {
      const head = b.dataset.head;
      const id = addCircuit(store, { rating: Number(b.dataset.addCircuit), headId: head === '' ? null : Number(head) });
      if (id !== null) this.open = id;
      this.rerender();
    });
    delegate(el, 'click', '[data-add-rcd]', (b) => {
      addRcd(store, { sensitivity: Number(b.dataset.addRcd), diffType: (b.dataset.type as DiffType) ?? 'A' });
    });

    delegate(el, 'click', '[data-toggle]', (row, e) => {
      // Un clic dans un champ ne replie pas la ligne.
      if ((e.target as Element).closest('input, select, button:not([data-toggle])')) return;
      const id = Number(row.dataset.toggle);
      this.open = this.open === id ? null : id;
      this.rerender();
    });
    delegate(el, 'click', '[data-activate]', (b) => {
      const id = Number(b.dataset.activate);
      setActiveCircuit(store, store.state.activeCircuit === id ? null : id);
    });
    delegate(el, 'click', '[data-count]', (b) => {
      setActiveCircuit(store, Number(b.dataset.count));
      store.change((s) => (s.mode = 'rooms'));
    });
    delegate(el, 'click', '[data-del]', (b) => {
      const id = Number(b.dataset.del);
      const v = circuitViews(store.state.doc).find((c) => c.device.id === id);
      const n = v?.links?.symbols.length ?? 0;
      if (n > 0 && !confirm(`Supprimer ce circuit ? Ses ${n} points redeviendront « sans circuit ».`)) return;
      removeDevice(store, id);
    });
    delegate(el, 'click', '[data-front]', (b) => {
      store.change((s) => {
        s.deviceSelection = Number(b.dataset.front);
        s.boardView = 'front';
      });
    });

    // Saisie d'un circuit : texte libre validé à la sortie, listes appliquées tout de suite.
    delegate(el, 'input', '[data-label]', (input) => patchCircuit(store, Number(input.dataset.label), { label: (input as HTMLInputElement).value }));
    delegate(el, 'input', '[data-note]', (input) => patchCircuit(store, Number(input.dataset.note), { note: (input as HTMLInputElement).value }));
    delegate(el, 'change', '[data-label], [data-note]', () => store.commit());
    delegate(el, 'change', '[data-set]', (sel) => {
      const id = Number(sel.dataset.id);
      const field = sel.dataset.set as string;
      const raw = (sel as HTMLSelectElement).value;
      const value: unknown =
        field === 'rating' || field === 'section' || field === 'sensitivity' ? (raw === '' ? null : Number(raw)) : raw === '' ? undefined : raw;
      patchCircuit(store, id, { [field]: value } as Partial<Device>);
      store.commit();
    });

    // Tableau : nom, emplacement, alimentation.
    delegate(el, 'input', '[data-board]', (input) => {
      const board = store.activeBoard;
      if (board) store.updateBoard({ ...board, [input.dataset.board as 'name' | 'location']: (input as HTMLInputElement).value });
    });
    delegate(el, 'change', '[data-board]', () => store.commit());
    delegate(el, 'change', '[data-supply]', (sel) => {
      const board = store.activeBoard;
      if (!board) return;
      store.updateBoard({ ...board, supply: (sel as HTMLSelectElement).value === 'tri' ? 'tri' : 'mono' });
      store.commit();
    });
  }

  private rerender(): void {
    this.key = '';
    this.render();
  }

  private render(): void {
    const { store } = this;
    const { mode, boardView, boardId, activeCircuit, deviceSelection } = store.state;
    if (mode !== 'board' || boardView !== 'circuits') return;
    // Arrivée depuis la liste de contrôle : le circuit désigné est déplié.
    if (deviceSelection !== null && this.open !== deviceSelection && store.activeBoard?.devices.some((d) => d.id === deviceSelection)) {
      const def = getDeviceDef(store.activeBoard.devices.find((d) => d.id === deviceSelection)?.kind ?? '');
      if (def && isCircuitRole(def)) this.open = deviceSelection;
    }
    const key = `${store.revision}:${boardId}:${activeCircuit}:${this.open}`;
    if (key === this.key) return;
    this.key = key;

    const board = store.activeBoard;
    this.el.innerHTML = board ? this.boardHtml(board) : this.emptyHtml();
  }

  // ---------------------------------------------------------------- pas encore de tableau

  private emptyHtml(): string {
    const { doc } = this.store.state;
    const rules = rulesOf(doc);
    const points = allPoints(doc).filter(isElectrical).length;
    const standard =
      rules.country === 'BE'
        ? 'Différentiel général 300 mA, puis 30 mA pour les locaux humides.'
        : 'Deux différentiels 30 mA (type A et type AC).';
    return `<div class="center-col">
      <header class="page-head"><h1>Tableau</h1><p class="muted">Les circuits, leurs protections, et ce qu’ils alimentent.</p></header>
      <section class="card start-grid">
        ${
          points > 0
            ? `<button type="button" class="choice primary" data-start="generate">${icon('wand', 26)}<b>Proposer les circuits</b>
                <span>À partir des ${points} points comptés, selon ${esc(rules.code)} : circuits, différentiels et tableau.</span></button>`
            : ''
        }
        <button type="button" class="choice" data-start="blank">${icon('bolt', 26)}<b>Relever un tableau existant</b>
          <span>Vous ajoutez ce que vous voyez : différentiels et disjoncteurs, calibre par calibre.</span></button>
        <button type="button" class="choice" data-start="standard">${icon('grid', 26)}<b>Tableau neuf (${esc(rules.code)})</b>
          <span>${standard}</span></button>
        <button type="button" class="choice" data-start="quick">${icon('edit', 26)}<b>Saisie au clavier</b>
          <span>Une ligne par appareil : « ID 40 A », « 20 Lave-linge ».</span></button>
      </section>
    </div>`;
  }

  // ---------------------------------------------------------------- tableau

  private boardHtml(board: Board): string {
    const { store } = this;
    const { doc } = store.state;
    const rules = rulesOf(doc);
    const a = analyze(board, rules.refScheme);
    const views = new Map(circuitViews(doc).map((v) => [v.device.id, v] as const));
    const unlinked = allPoints(doc).filter((p) => isElectrical(p) && p.breaker === null).length;

    const groups = a.groups
      .map((g) => this.groupHtml(g.head, g.members, a.refs, views))
      .join('');

    const rcdChoices =
      rules.country === 'BE'
        ? [
            { sens: 300, type: 'A', label: '300 mA (général)' },
            { sens: 30, type: 'A', label: '30 mA' },
          ]
        : [
            { sens: 30, type: 'A', label: '30 mA type A' },
            { sens: 30, type: 'AC', label: '30 mA type AC' },
          ];

    const boards = doc.boards;
    return `<div class="center-col">
      <header class="board-head card">
        ${
          boards.length > 1
            ? `<select data-board-select aria-label="Tableau">${boards.map((b) => `<option value="${b.id}"${b.id === board.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`
            : ''
        }
        <label class="fld grow"><span>Tableau</span><input type="text" data-board="name" value="${esc(board.name)}"></label>
        <label class="fld grow"><span>Emplacement</span><input type="text" data-board="location" value="${esc(board.location)}" placeholder="Hall, garage…"></label>
        <label class="fld"><span>Réseau</span><select data-supply>
          <option value="mono"${board.supply === 'mono' ? ' selected' : ''}>230 V monophasé</option>
          <option value="tri"${board.supply === 'tri' ? ' selected' : ''}>400 V triphasé</option></select></label>
        <div class="board-head-actions">
          <button type="button" data-quick title="Saisir plusieurs circuits au clavier">${icon('edit', 15)} Saisie rapide</button>
          <button type="button" data-new-board title="Ajouter un autre tableau">${icon('plus', 15)} Tableau</button>
        </div>
      </header>

      ${
        unlinked > 0
          ? `<div class="callout">${icon('info', 18)}<span><b>${plural(unlinked, 'point')} sans circuit.</b> Wirely peut les répartir selon ${esc(rules.code)}.</span>
              <button type="button" class="primary" data-connect>${icon('wand', 15)} Proposer</button></div>`
          : ''
      }

      ${groups || `<section class="card group"><p class="muted">Tableau vide. Ajoutez d’abord un différentiel, ou directement un circuit.</p>${this.addRow(null)}</section>`}

      <div class="add-rcd">
        <span>Ajouter un différentiel</span>
        ${rcdChoices.map((c) => `<button type="button" data-add-rcd="${c.sens}" data-type="${c.type}">${icon('plus', 14)} ${esc(c.label)}</button>`).join('')}
      </div>
    </div>`;
  }

  private addRow(headId: number | null): string {
    return `<div class="add-circuit">
      <span>${icon('plus', 15)} Circuit</span>
      ${QUICK_RATINGS.map((r) => `<button type="button" data-add-circuit="${r}" data-head="${headId ?? ''}">${r} A</button>`).join('')}
    </div>`;
  }

  private groupHtml(head: Device | null, members: Device[], refs: ReadonlyMap<number, string>, views: ReadonlyMap<number, CircuitView>): string {
    const circuits = members.filter((m) => views.has(m.id)).length;
    const headHtml = head
      ? `<header class="group-head">
          <span class="rcd-badge">${esc(refs.get(head.id) ?? 'ID')}</span>
          <span class="group-title"><b>Différentiel</b><small>${plural(circuits, 'circuit')}${head.note ? ` · ${esc(head.note)}` : ''}</small></span>
          <select data-set="sensitivity" data-id="${head.id}" aria-label="Sensibilité">${[10, 30, 100, 300, 500]
            .map((s) => `<option value="${s}"${s === (head.sensitivity ?? 30) ? ' selected' : ''}>${s} mA</option>`)
            .join('')}</select>
          <select data-set="rating" data-id="${head.id}" aria-label="Calibre">${[25, 40, 63, 80, 100]
            .map((r) => `<option value="${r}"${r === head.rating ? ' selected' : ''}>${r} A</option>`)
            .join('')}</select>
          <select data-set="diffType" data-id="${head.id}" aria-label="Type">${(['A', 'AC', 'F', 'HI'] as DiffType[])
            .map((t) => `<option value="${t}"${t === head.diffType ? ' selected' : ''}>type ${t}</option>`)
            .join('')}</select>
          <button type="button" class="icon danger" data-del="${head.id}" title="Supprimer ce différentiel" aria-label="Supprimer">${icon('trash', 16)}</button>
        </header>`
      : `<header class="group-head none">
          <span class="rcd-badge none">!</span>
          <span class="group-title"><b>Sans différentiel</b><small>Ces circuits ne sont protégés par aucun différentiel.</small></span>
        </header>`;

    const rows = members
      .map((m) => {
        const v = views.get(m.id);
        return v ? this.circuitRow(v) : this.auxRow(m, refs.get(m.id) ?? '');
      })
      .join('');

    return `<section class="card group">${headHtml}<ul class="circuit-list">${rows}</ul>${this.addRow(head?.id ?? null)}</section>`;
  }

  private auxRow(d: Device, ref: string): string {
    return `<li class="circuit aux">
      <span class="cbadge none">${esc(ref || '·')}</span>
      <span class="circuit-main"><b>${esc(d.label.trim() || deviceName(d))}</b><small>${esc(deviceSpec(d))}</small></span>
      <button type="button" data-front="${d.id}">Voir sur les rails</button>
    </li>`;
  }

  private circuitRow(v: CircuitView): string {
    const { store } = this;
    const { doc, activeCircuit } = store.state;
    const rules = rulesOf(doc);
    const d = v.device;
    const open = this.open === d.id;
    const active = activeCircuit === d.id;
    const summary = v.links && v.links.symbols.length > 0 ? linksSummary(v.links) : 'Aucun point raccordé';
    const rooms = (v.links?.rooms ?? []).map((r) => `${r.label}${r.count > 1 ? ` (${r.count})` : ''}`).join(', ');

    const ratingOptions = [...new Set([...RATINGS, d.rating ?? 16])].sort((a, b) => a - b);
    const detail = open
      ? `<div class="circuit-detail">
          <label class="fld"><span>Câble</span><select data-set="cable" data-id="${d.id}">
            <option value="">${esc(doc.project.cable)} (chantier)</option>
            ${rules.cables.filter((c) => c !== doc.project.cable).map((c) => `<option value="${c}"${d.cable === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
          </select></label>
          <label class="fld"><span>Mode de pose</span><select data-set="laying" data-id="${d.id}">
            <option value="">${esc(doc.project.laying)} (chantier)</option>
            ${rules.layings.filter((c) => c !== doc.project.laying).map((c) => `<option value="${c}"${d.laying === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
          </select></label>
          <label class="fld"><span>Pôles</span><select data-set="variant" data-id="${d.id}">${(getDeviceDef(d.kind)?.variants ?? [])
            .map((x) => `<option value="${x.id}"${x.id === d.variant ? ' selected' : ''}>${esc(x.label)}</option>`)
            .join('')}</select></label>
          <label class="fld"><span>Courbe</span><select data-set="curve" data-id="${d.id}">${['B', 'C', 'D']
            .map((c) => `<option value="${c}"${c === d.curve ? ' selected' : ''}>${c}</option>`)
            .join('')}</select></label>
          <label class="fld wide"><span>Remarque</span><input type="text" data-note="${d.id}" value="${esc(d.note)}" placeholder="Ex. câble VOB sous tube, à remplacer"></label>
          <p class="circuit-rooms">${rooms ? `${icon('pin', 15)} ${esc(rooms)}` : 'Aucune pièce desservie pour l’instant.'}</p>
          <div class="row">
            <button type="button" class="primary" data-count="${d.id}">${icon('grid', 15)} Compter ses points</button>
            <button type="button" data-front="${d.id}">Voir sur les rails</button>
            <button type="button" class="danger" data-del="${d.id}">${icon('trash', 15)} Supprimer</button>
          </div>
        </div>`
      : '';

    return `<li class="circuit${open ? ' open' : ''}${active ? ' active' : ''}${v.over ? ' over' : ''}">
      <div class="circuit-row" data-toggle="${d.id}">
        ${circuitBadge(v.ref, v.color, 'lg')}
        <span class="circuit-main">
          <input type="text" data-label="${d.id}" value="${esc(d.label)}" placeholder="${esc(v.name)} — nommer le circuit" aria-label="Désignation du circuit ${esc(v.ref)}">
          <small>${esc(summary)}${rooms ? ` · ${esc(rooms)}` : ''}</small>
        </span>
        <select data-set="rating" data-id="${d.id}" aria-label="Calibre" class="narrow">${ratingOptions
          .map((r) => `<option value="${r}"${r === d.rating ? ' selected' : ''}>${r} A</option>`)
          .join('')}</select>
        <select data-set="section" data-id="${d.id}" aria-label="Section" class="narrow">${rules.sections
          .map((s) => `<option value="${s}"${s === v.section ? ' selected' : ''}>${String(s).replace('.', ',')} mm²</option>`)
          .join('')}</select>
        ${loadMeter(v.load)}
        <button type="button" class="pill-btn${active ? ' on' : ''}" data-activate="${d.id}" title="${active ? 'Circuit actif' : 'Rendre ce circuit actif : ce que vous comptez s’y raccorde'}">${active ? `${icon('check', 14)} Actif` : 'Activer'}</button>
        <span class="chev">${icon(open ? 'down' : 'chevron', 16)}</span>
      </div>
      <p class="circuit-spec">${esc(variantOf(d).label)} · courbe ${esc(d.curve ?? 'C')}${v.rcd ? '' : ' · sans différentiel'}</p>
      ${detail}
    </li>`;
  }
}
