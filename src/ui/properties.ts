import { deleteSelection, detachRoomPart, duplicateSelection, rotateSelection, setTool, startMerge } from '../core/actions';
import {
  assignBreaker,
  createLinkedBoard,
  linkSymbolToBoard,
  openBoard,
  showDeviceInBoard,
} from '../core/links';
import {
  circuitFromTitle,
  circuitLinks,
  circuitOptions,
  circuitTitle,
  isElectrical,
  unlinkedItems,
} from '../domain/link/links';
import type { Store } from '../core/store';
import { WIRE_TYPES, WIRE_TYPE_IDS, SYMBOL_CATEGORIES, getSymbol } from '../domain/catalog';
import { runPlanChecks } from '../domain/plan/checks';
import {
  fmtArea,
  fmtLength,
  fmtMeters,
  planSummary,
  polylineLength,
  roomAt,
  roomStats,
  roomsOf,
  toMeters,
  toUnits,
  wireLengthM,
} from '../domain/plan/metrics';
import { ROOM_KINDS, ROOM_KIND_IDS, getRoomKind } from '../domain/plan/roomKinds';
import type { Item, RoomKind, WireTypeId } from '../domain/types';
import { esc } from '../util/escape';
import { qs } from './dom';

const TITLES: Record<Item['type'], string> = {
  room: 'Pièce',
  wall: 'Mur',
  wire: 'Câble',
  symbol: 'Symbole',
  text: 'Texte',
};

/** Hauteurs de pose courantes (cm), proposées en suggestion. */
const HEIGHTS = [5, 30, 110, 120, 150, 220];

const SHORTCUTS = `
  <details class="more">
    <summary>Raccourcis clavier</summary>
    <p class="muted">
      <kbd>V</kbd> sélection · <kbd>G</kbd> pièce · <kbd>W</kbd> mur · <kbd>L</kbd> câble · <kbd>T</kbd> texte<br>
      <kbd>R</kbd> pivoter · <kbd>Suppr</kbd> effacer · <kbd>Ctrl</kbd>+<kbd>D</kbd> dupliquer<br>
      <kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> déplacer (<kbd>Maj</kbd> : 1 carreau)<br>
      <kbd>Échap</kbd> annuler · <kbd>Entrée</kbd> terminer un tracé<br>
      Molette : zoom · glisser le fond ou <kbd>Espace</kbd> : déplacer la vue
    </p>
  </details>`;

const CATEGORY_DOTS: Record<string, string> = {
  Prises: '#d62828',
  Commandes: '#111827',
  Éclairage: '#e08a00',
  Équipements: '#0e9aa7',
  Distribution: '#7b2cbf',
  Ouvertures: '#6b7385',
};

/** Panneau de droite : synthèse du plan, ou édition de l'élément sélectionné. */
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
    if (this.store.state.mode !== 'plan') return;
    const { selection } = this.store.state;
    const key = `${selection}:${this.store.revision}`;
    if (key === this.key) return;
    this.key = key;

    const item = this.store.selectedItem;
    if (!item) {
      this.el.innerHTML = this.summary();
      this.bindSummary();
      return;
    }
    this.el.innerHTML = this.form(item);
    this.bindForm(item.id);
  }

  // ---------------------------------------------------------------- synthèse

  private summary(): string {
    const { doc } = this.store.state;
    const s = planSummary(doc);
    const checks = runPlanChecks(doc);
    const total = s.byCategory.reduce((n, c) => n + c.count, 0);

    if (doc.items.length === 0) return `<h3>Propriétés</h3><p class="muted">Dessinez une pièce ou chargez l'exemple pour commencer.</p>${SHORTCUTS}`;

    const tiles = `
      <div class="tiles">
        <div class="tile"><b>${s.rooms}</b><span>pièce${s.rooms > 1 ? 's' : ''}</span></div>
        <div class="tile"><b>${s.area.toFixed(1).replace('.', ',')}</b><span>m² habitables</span></div>
        <div class="tile"><b>${total}</b><span>appareil${total > 1 ? 's' : ''}</span></div>
      </div>`;

    const cats = SYMBOL_CATEGORIES.filter((c) => s.byCategory.some((x) => x.category === c))
      .map((c) => {
        const n = s.byCategory.find((x) => x.category === c)?.count ?? 0;
        return `<li><i style="background:${CATEGORY_DOTS[c] ?? '#6b7385'}"></i>${esc(c)}<b>${n}</b></li>`;
      })
      .join('');

    const wires = WIRE_TYPE_IDS.filter((id) => s.wires.some((w) => w.type === id))
      .map((id) => {
        const w = WIRE_TYPES[id];
        const len = s.wires.find((x) => x.type === id)?.length ?? 0;
        return `<li><i class="wire" style="border-color:${w.color}${w.dash ? ';border-top-style:dashed' : ''}"></i>${esc(w.name)}<b>${fmtLength(len)}</b></li>`;
      })
      .join('');

    // Raccordement au tableau : avancement, circuit actif et accès rapide à l'outil Affecter.
    let wiring = '';
    if (doc.boards.length > 0) {
      const u = unlinkedItems(doc);
      const electrical = doc.items.filter((i) => i.type === 'wire' || (i.type === 'symbol' && isElectrical(i))).length;
      const done = electrical - u.wires.length - u.symbols.length;
      const pct = electrical === 0 ? 0 : Math.round((done / electrical) * 100);
      const activeId = this.store.state.activeCircuit;
      const active = activeId !== null ? circuitOptions(doc).find((o) => o.id === activeId) : undefined;
      wiring = `<h3>Raccordement au tableau</h3>
        <div class="meter"><span style="width:${pct}%"></span></div>
        <p class="muted">${done} / ${electrical} éléments raccordés (${pct} %)</p>
        ${active ? `<p class="muted">Circuit actif : <b>${esc(circuitTitle(doc, active))}</b></p>` : ''}
        <div class="row"><button type="button" id="sumAssign">🔗 Raccorder des éléments…</button></div>`;
    }

    const checkList =
      s.rooms === 0
        ? ''
        : checks.length === 0
          ? '<h3>Contrôles</h3><p class="ok">✔ Aucun point d’attention.</p>'
          : `<h3>Contrôles <small>(indicatifs)</small></h3><ul class="checks">${checks
              .map(
                (c) =>
                  `<li class="chk ${c.severity}" data-item="${c.itemId ?? ''}">${c.severity === 'warn' ? '⚠️' : 'ℹ️'} <span>${esc(c.message)}</span></li>`,
              )
              .join('')}</ul>
            <p class="muted">Repères inspirés de la NF C 15-100 : ils ne remplacent ni la norme ni un professionnel.</p>`;

    return `
      <h3>Synthèse du plan</h3>
      ${tiles}
      ${cats ? `<h3>Appareillage</h3><ul class="legend">${cats}</ul>` : ''}
      ${wires ? `<h3>Câbles <small>· ${fmtLength(s.wireLength)}</small></h3><ul class="legend">${wires}</ul>` : ''}
      ${wiring}
      ${s.wallLength > 0 ? `<p class="muted">Murs : ${fmtLength(s.wallLength)} linéaires.</p>` : ''}
      ${checkList}
      ${SHORTCUTS}`;
  }

  private bindSummary(): void {
    const assign = this.el.querySelector<HTMLButtonElement>('#sumAssign');
    if (assign) assign.onclick = () => setTool(this.store, 'assign');
    this.el.querySelectorAll<HTMLElement>('[data-item]').forEach((li) => {
      li.onclick = () => {
        const id = Number(li.dataset.item);
        if (li.dataset.item !== '' && Number.isFinite(id)) this.store.change((s) => (s.selection = id));
      };
    });
  }

  // ---------------------------------------------------------------- formulaire

  /** Champ « Disjoncteur » : recherche par saisie dans la liste des circuits de tous les tableaux. */
  private breakerField(breaker: number | null): string {
    const { doc } = this.store.state;
    const options = circuitOptions(doc);
    const current = breaker !== null ? options.find((o) => o.id === breaker) : undefined;
    const none = options.length === 0;
    return `<label class="f" for="pBreaker">Disjoncteur</label>
      <div class="ac">
        <input type="text" id="pBreaker" list="circuitList" autocomplete="off"
          value="${esc(current ? circuitTitle(doc, current) : '')}"
          placeholder="${none ? 'Aucun tableau' : 'Rechercher un circuit…'}"${none ? ' disabled' : ''}>
        ${current ? '<button type="button" id="pBreakerGo" title="Voir ce disjoncteur dans le tableau">Tableau ↗</button>' : ''}
      </div>
      <datalist id="circuitList">${options.map((o) => `<option value="${esc(circuitTitle(doc, o))}"></option>`).join('')}</datalist>`;
  }

  /** Pour un symbole « tableau » : tableau représenté, ouverture et création. */
  private boardField(boardId: number | null): string {
    const { doc } = this.store.state;
    const linked = doc.boards.find((b) => b.id === boardId);
    const circuits = linked ? circuitOptions({ boards: [linked] }).length : 0;
    const wired = linked ? [...new Set(linked.devices.map((d) => d.id))].filter((id) => circuitLinks(doc, id).symbols.length + circuitLinks(doc, id).wires.length > 0).length : 0;
    return `<label class="f" for="pBoard">Tableau représenté</label>
      <select id="pBoard">
        <option value="">— aucun —</option>
        ${doc.boards
          .map((b) => `<option value="${b.id}"${b.id === boardId ? ' selected' : ''}>${esc(b.name)}${b.location ? ` · ${esc(b.location)}` : ''}</option>`)
          .join('')}
      </select>
      <div class="row">
        <button type="button" id="pOpenBoard"${linked ? '' : ' disabled'}>Ouvrir le tableau ↗</button>
        <button type="button" id="pNewBoard">Créer un tableau</button>
      </div>
      ${linked ? `<p class="muted"><b>${circuits}</b> circuit${circuits > 1 ? 's' : ''}, dont <b>${wired}</b> raccordé${wired > 1 ? 's' : ''} à des lignes du plan.</p>` : ''}`;
  }

  private form(item: Item): string {
    const { doc } = this.store.state;
    const title = item.type === 'symbol' ? (getSymbol(item.kind)?.name ?? 'Symbole') : TITLES[item.type];
    let h = `<h3>${esc(title)}</h3>`;

    if (item.type === 'room') {
      const stats = roomStats(doc).find((s) => s.room.id === item.id);
      const kind = getRoomKind(item.kind);
      const w = toMeters(doc.scale, item.w);
      const d = toMeters(doc.scale, item.h);
      const merged = item.parts.length > 0;
      const others = roomsOf(doc.items).length > 1;
      const partsHtml = merged
        ? `<p class="muted">Pièce composée de <b>${item.parts.length + 1}</b> parties. Les dimensions ci-dessus sont celles du rectangle principal ; glissez la poignée de chaque partie pour l'ajuster.</p>
           <ul class="parts">${item.parts
             .map(
               (q, i) =>
                 `<li><span>Partie ${i + 2} · ${fmtMeters(toMeters(doc.scale, q.w))} × ${fmtMeters(toMeters(doc.scale, q.h))}</span><button type="button" data-detach="${i}">Détacher</button></li>`,
             )
             .join('')}</ul>`
        : '';
      h += `<label class="f" for="pLabel">Nom</label>
        <input type="text" id="pLabel" value="${esc(item.label)}" placeholder="${esc(kind.name)}">
        <label class="f">Type de pièce</label>
        <div class="chips">${ROOM_KIND_IDS.map(
          (id) =>
            `<button type="button" class="chip${id === item.kind ? ' active' : ''}" data-kind="${id}"><i style="background:${ROOM_KINDS[id].color}"></i>${esc(ROOM_KINDS[id].name)}</button>`,
        ).join('')}</div>
        <div class="two">
          <div><label class="f" for="pW">Largeur (m)</label><input type="number" id="pW" min="0.5" step="0.1" value="${w.toFixed(2)}"></div>
          <div><label class="f" for="pD">Profondeur (m)</label><input type="number" id="pD" min="0.5" step="0.1" value="${d.toFixed(2)}"></div>
        </div>
        <p class="muted">Surface${merged ? ' totale' : ''} : <b>${fmtArea(stats?.area ?? w * d)}</b></p>
        ${partsHtml}
        <div class="row"><button type="button" id="pMerge"${others ? '' : ' disabled'} title="Cliquez ensuite sur la pièce à fusionner dans celle-ci">Fusionner avec une autre pièce…</button></div>`;
      if (stats) {
        const min = kind.minSockets ? kind.minSockets(stats.area) : null;
        const short = min !== null && stats.sockets < min;
        h += `<ul class="legend">
          <li><i style="background:#d62828"></i>Prises${min !== null ? ` <small>(${min} conseillées)</small>` : ''}<b class="${short ? 'bad' : ''}">${stats.sockets}</b></li>
          <li><i style="background:#e08a00"></i>Points lumineux<b class="${kind.minLights > stats.lights ? 'bad' : ''}">${stats.lights}</b></li>
          <li><i style="background:#111827"></i>Commandes<b>${stats.switches}</b></li>
        </ul>`;
      }
    }

    if (item.type === 'symbol') {
      const room = roomAt(roomsOf(doc.items), item.x, item.y);
      h += `<label class="f" for="pLabel">Nom / repère</label>
        <input type="text" id="pLabel" value="${esc(item.label)}" placeholder="ex. Prise plan de travail">`;
      if (isElectrical(item)) h += this.breakerField(item.breaker);
      if (item.kind === 'tableau') h += this.boardField(item.board);
      h += `<label class="f" for="pHeight">Hauteur de pose (cm)</label>
        <input type="number" id="pHeight" list="heightList" min="0" max="400" step="5" value="${item.height ?? ''}" placeholder="—">
        <datalist id="heightList">${HEIGHTS.map((n) => `<option value="${n}">`).join('')}</datalist>
        <p class="muted">${room ? `Dans : <b>${esc(room.label.trim() || getRoomKind(room.kind).name)}</b>` : 'Hors de toute pièce'}</p>`;
    }

    if (item.type === 'wire') {
      const options = WIRE_TYPE_IDS.map(
        (id) => `<option value="${id}"${id === item.wtype ? ' selected' : ''}>${esc(WIRE_TYPES[id].name)}</option>`,
      ).join('');
      h += `<label class="f" for="pWire">Type de câble</label><select id="pWire">${options}</select>
        ${this.breakerField(item.breaker)}
        <p class="muted">Longueur : <b>${fmtLength(wireLengthM(doc, item))}</b></p>`;
    }

    if (item.type === 'wall') {
      const len = toMeters(doc.scale, polylineLength(item.points));
      h += `<p class="muted">Longueur : <b>${fmtMeters(len)}</b> · ${item.points.length - 1} segment${item.points.length > 2 ? 's' : ''}.<br>Glissez les points blancs pour ajuster le tracé.</p>`;
    }

    if (item.type === 'text') {
      h += `<label class="f" for="pText">Texte</label><input type="text" id="pText" value="${esc(item.text)}">`;
    }

    h += `<div class="row">
      ${item.type === 'symbol' ? '<button id="pRotL" title="Pivoter à gauche">⟲</button><button id="pRot" title="Pivoter à droite (R)">⟳</button>' : ''}
      <button id="pDup">Dupliquer</button>
      <button id="pDel" class="danger">Supprimer</button>
    </div>`;
    return h;
  }

  private bindForm(id: number): void {
    const { store } = this;
    const edit = (patch: (item: Item) => Item) => {
      const current = store.getItem(id);
      if (current) store.updateItem(patch(current));
    };
    const $ = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel);

    const text = (sel: string, apply: (item: Item, v: string) => Item) => {
      const input = $<HTMLInputElement>(sel);
      if (!input) return;
      input.oninput = () => edit((i) => apply(i, input.value));
      input.onchange = () => store.commit();
    };
    text('#pLabel', (i, v) => (i.type === 'room' || i.type === 'symbol' ? { ...i, label: v } : i));
    text('#pText', (i, v) => (i.type === 'text' ? { ...i, text: v } : i));

    // Disjoncteur : saisie dans la liste ; une valeur inconnue est annulée.
    const breaker = $<HTMLInputElement>('#pBreaker');
    if (breaker) {
      breaker.onchange = () => {
        const text = breaker.value.trim();
        const found = text ? circuitFromTitle(store.state.doc, text) : null;
        if (text && !found) {
          this.key = ''; // saisie inconnue : on reconstruit le panneau avec la valeur actuelle
          this.render();
          return;
        }
        assignBreaker(store, id, found ? found.id : null);
      };
    }
    const linkedBreaker = (): number | null => {
      const it = store.getItem(id);
      return it && (it.type === 'wire' || it.type === 'symbol') ? it.breaker : null;
    };

    // Symbole « tableau » : lien vers un tableau.
    const boardSel = $<HTMLSelectElement>('#pBoard');
    if (boardSel) boardSel.onchange = () => linkSymbolToBoard(store, id, boardSel.value ? Number(boardSel.value) : null);

    const height = $<HTMLInputElement>('#pHeight');
    if (height) {
      height.oninput = () =>
        edit((i) => {
          if (i.type !== 'symbol') return i;
          const n = Number(height.value);
          return { ...i, height: height.value === '' || !Number.isFinite(n) ? null : Math.min(400, Math.max(0, Math.round(n))) };
        });
      height.onchange = () => store.commit();
    }

    const wire = $<HTMLSelectElement>('#pWire');
    if (wire) {
      wire.onchange = () => {
        edit((i) => (i.type === 'wire' ? { ...i, wtype: wire.value as WireTypeId } : i));
        store.commit();
      };
    }

    this.el.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => {
      b.onclick = () => {
        edit((i) => (i.type === 'room' ? { ...i, kind: b.dataset.kind as RoomKind } : i));
        store.commit();
      };
    });

    const dimension = (sel: string, field: 'w' | 'h') => {
      const input = $<HTMLInputElement>(sel);
      if (!input) return;
      input.onchange = () => {
        const meters = Number(input.value);
        if (!Number.isFinite(meters) || meters <= 0) return;
        const units = Math.max(20, Math.round(toUnits(store.state.doc.scale, meters) / 10) * 10);
        edit((i) => (i.type === 'room' ? { ...i, [field]: units } : i));
        store.commit();
      };
    };
    dimension('#pW', 'w');
    dimension('#pD', 'h');

    const on = (sel: string, fn: () => void) => {
      const b = $<HTMLButtonElement>(sel);
      if (b) b.onclick = fn;
    };
    on('#pMerge', () => startMerge(store));
    on('#pBreakerGo', () => {
      const b = linkedBreaker();
      if (b !== null) showDeviceInBoard(store, b);
    });
    on('#pOpenBoard', () => {
      const it = store.getItem(id);
      if (it?.type === 'symbol' && it.board !== null) openBoard(store, it.board);
    });
    on('#pNewBoard', () => createLinkedBoard(store, id));
    this.el.querySelectorAll<HTMLButtonElement>('[data-detach]').forEach((b) => {
      b.onclick = () => detachRoomPart(store, id, Number(b.dataset.detach));
    });
    on('#pRot', () => rotateSelection(store));
    on('#pRotL', () => rotateSelection(store, -90));
    on('#pDup', () => duplicateSelection(store));
    on('#pDel', () => deleteSelection(store));
  }
}
