import { assignBreaker, showItemOnPlan } from '../../core/links';
import { connectUnlinked } from '../../core/planActions';
import { addPoint, addRoomOfKind, deletePoint, deleteRoom, removePoint, renameRoom, setSocketKind } from '../../core/pointActions';
import type { Store } from '../../core/store';
import { SOCKET_SERIES, isSocketKind } from '../../domain/catalog';
import { isElectrical } from '../../domain/link/links';
import { roomsOf, roomStats } from '../../domain/plan/metrics';
import { roomNeeds } from '../../domain/plan/needs';
import { ROOM_KINDS, ROOM_KIND_IDS, getRoomKind } from '../../domain/plan/roomKinds';
import { POINT_GROUPS, pointRefs, pointTypes, roomCounts, roomPoints, typeOf, type PointGroup, type PointType } from '../../domain/points';
import { rulesOf } from '../../domain/rules';
import type { Room, RoomKind, SymbolItem } from '../../domain/types';
import { esc } from '../../util/escape';
import { openCircuitPicker } from '../circuitPicker';
import { qs } from '../dom';
import { pickActiveCircuit } from '../header';
import { circuitBadge, circuitViews, delegate, glyph, icon, plural, type CircuitView } from '../kit';

/** Ordre des types de pièce dans la grille d'ajout : les plus courants d'abord. */
const KIND_ORDER: RoomKind[] = ['sejour', 'cuisine', 'chambre', 'sdb', 'wc', 'entree', 'couloir', 'bureau', 'garage', 'cave', 'exterieur', 'autre'];

/**
 * Espace « Pièces » : on y compte les points, pièce par pièce, au pouce. À gauche la liste des
 * pièces ; à droite (ou en plein écran sur téléphone) les compteurs de la pièce ouverte. Chaque
 * « + » ajoute un point sur le circuit actif.
 */
export class RoomsView {
  private readonly el = qs<HTMLElement>('#roomsView');
  private key = '';
  /** Compteur à animer après le prochain rendu (retour visuel du geste). */
  private bump: string | null = null;
  private showMore = false;
  private showAdd = false;

  constructor(private readonly store: Store) {
    this.bind();
    store.subscribe(() => this.render());
  }

  private room(): Room | null {
    const it = this.store.getItem(this.store.state.roomId);
    return it?.type === 'room' ? it : null;
  }

  private bind(): void {
    const { store, el } = this;

    delegate(el, 'click', '[data-room]', (b) => store.change((s) => (s.roomId = Number(b.dataset.room))));
    delegate(el, 'click', '[data-back]', () => store.change((s) => (s.roomId = null)));
    delegate(el, 'click', '[data-add-room]', (b) => {
      const id = addRoomOfKind(store, b.dataset.addRoom as RoomKind);
      this.showAdd = false;
      if (id !== null) store.change((s) => (s.roomId = id));
    });
    delegate(el, 'click', '[data-toggle-add]', () => {
      this.showAdd = !this.showAdd;
      this.rerender();
    });
    delegate(el, 'click', '[data-more]', () => {
      this.showMore = !this.showMore;
      this.rerender();
    });

    // Compteurs : + et −.
    delegate(el, 'click', '[data-plus]', (b) => {
      const room = this.room();
      if (!room) return;
      this.bump = b.dataset.plus as string;
      addPoint(store, room.id, b.dataset.plus as string);
    });
    delegate(el, 'click', '[data-minus]', (b) => {
      const room = this.room();
      if (!room) return;
      this.bump = b.dataset.minus as string;
      removePoint(store, room.id, b.dataset.minus as string);
    });

    delegate(el, 'click', '[data-active]', () => pickActiveCircuit(store));
    delegate(el, 'click', '[data-connect]', () => connectUnlinked(store));

    // Détail des points : changer de circuit, nommer, supprimer.
    delegate(el, 'click', '[data-point-circuit]', (b) => {
      const id = Number(b.dataset.pointCircuit);
      const item = store.getItem(id);
      if (item?.type !== 'symbol') return;
      openCircuitPicker(store, {
        title: 'Circuit de ce point',
        current: item.breaker,
        allowNone: true,
        onPick: (deviceId) => assignBreaker(store, id, deviceId),
      });
    });
    delegate(el, 'click', '[data-point-del]', (b) => deletePoint(store, Number(b.dataset.pointDel)));
    delegate(el, 'click', '[data-point-plan]', (b) => showItemOnPlan(store, Number(b.dataset.pointPlan)));
    delegate(el, 'input', '[data-point-label]', (input) => {
      const item = store.getItem(Number(input.dataset.pointLabel));
      if (item?.type === 'symbol') store.updateItem({ ...item, label: (input as HTMLInputElement).value });
    });
    delegate(el, 'change', '[data-point-label]', () => store.commit());
    // Une prise comptée simple se révèle double (ou l'inverse) : on la change sur place.
    delegate(el, 'change', '[data-point-kind]', (sel) => {
      setSocketKind(store, Number(sel.dataset.pointKind), (sel as HTMLSelectElement).value);
    });

    // Pièce : nom, type, suppression.
    delegate(el, 'input', '[data-room-name]', (input) => {
      const room = this.room();
      if (room) renameRoom(store, room.id, (input as HTMLInputElement).value);
    });
    delegate(el, 'change', '[data-room-name]', () => store.commit());
    delegate(el, 'change', '[data-room-kind]', (sel) => {
      const room = this.room();
      if (!room) return;
      store.updateItem({ ...room, kind: (sel as HTMLSelectElement).value as RoomKind });
      store.commit();
    });
    delegate(el, 'click', '[data-room-del]', () => {
      const room = this.room();
      if (!room) return;
      const n = roomPoints(store.state.doc, room.id).length;
      if (n > 0 && !confirm(`Supprimer cette pièce et ses ${n} points ?`)) return;
      deleteRoom(store, room.id);
    });
    delegate(el, 'click', '[data-room-plan]', () => {
      const room = this.room();
      if (room) showItemOnPlan(store, room.id);
    });
  }

  private rerender(): void {
    this.key = '';
    this.render();
  }

  private render(): void {
    const { store } = this;
    if (store.state.mode !== 'rooms') return;
    const { doc, roomId, activeCircuit } = store.state;
    const key = `${store.revision}:${roomId}:${activeCircuit}:${this.showMore}:${this.showAdd}`;
    if (key === this.key) return;
    this.key = key;

    const rooms = roomsOf(doc.items).sort((a, b) => a.id - b.id);
    const room = this.room();
    const circuits = circuitViews(doc);

    this.el.className = room ? 'rooms has-room' : 'rooms';
    this.el.innerHTML = `
      <aside class="rooms-list">${this.listHtml(rooms, room, circuits)}</aside>
      <section class="rooms-detail"><div class="detail-col">${room ? this.detailHtml(room, circuits) : this.emptyDetail(rooms.length)}</div></section>`;

    // Retour visuel : le compteur que l'on vient de toucher « rebondit ».
    if (this.bump) {
      const tile = this.el.querySelector<HTMLElement>(`[data-count="${this.bump}"]`);
      tile?.classList.add('bump');
      this.bump = null;
    }
  }

  // ---------------------------------------------------------------- liste des pièces

  private listHtml(rooms: Room[], current: Room | null, circuits: CircuitView[]): string {
    const { doc } = this.store.state;
    const byId = new Map(circuits.map((c) => [c.device.id, c] as const));

    const cards = rooms
      .map((r) => {
        const kind = getRoomKind(r.kind);
        const points = roomPoints(doc, r.id);
        const used = [...new Set(points.map((p) => p.breaker).filter((b): b is number => b !== null))]
          .map((id) => byId.get(id))
          .filter((c): c is CircuitView => c !== undefined);
        const orphans = points.filter((p) => isElectrical(p) && p.breaker === null).length;
        return `<button type="button" class="room-card${current?.id === r.id ? ' active' : ''}" data-room="${r.id}">
          <i class="swatch" style="background:${kind.color}"></i>
          <span class="room-card-text">
            <b>${esc(r.label.trim() || kind.name)}</b>
            <small>${points.length === 0 ? 'Aucun point' : plural(points.length, 'point')}${orphans > 0 ? ` · ${orphans} sans circuit` : ''}</small>
          </span>
          <span class="room-card-circuits">${used.slice(0, 5).map((c) => circuitBadge(c.ref, c.color, 'sm')).join('')}</span>
          ${icon('chevron', 16)}
        </button>`;
      })
      .join('');

    const adding = this.showAdd || rooms.length === 0;
    const grid = `<div class="kind-grid">${KIND_ORDER.filter((k) => ROOM_KIND_IDS.includes(k))
      .map((k) => `<button type="button" data-add-room="${k}"><i class="swatch" style="background:${ROOM_KINDS[k].color}"></i>${esc(ROOM_KINDS[k].name)}</button>`)
      .join('')}</div>`;

    return `
      <header class="pane-head">
        <h2>Pièces</h2>
        ${rooms.length > 0 ? `<button type="button" class="${adding ? '' : 'primary'}" data-toggle-add>${adding ? 'Fermer' : `${icon('plus', 16)} Pièce`}</button>` : ''}
      </header>
      ${adding ? `<div class="add-room"><p class="muted">${rooms.length === 0 ? 'Touchez un type de pièce pour la créer. Vous la nommerez et la compterez ensuite.' : 'Quelle pièce ajouter ?'}</p>${grid}</div>` : ''}
      <div class="room-cards">${cards}</div>`;
  }

  private emptyDetail(count: number): string {
    return `<div class="empty-state">
      ${icon('grid', 40)}
      <h2>${count === 0 ? 'Commencez par une pièce' : 'Choisissez une pièce'}</h2>
      <p>${count === 0 ? 'Créez une pièce, puis comptez ce qu’elle contient : prises, points lumineux, interrupteurs, appareils.' : 'Ses compteurs s’affichent ici.'}</p>
    </div>`;
  }

  // ---------------------------------------------------------------- détail d'une pièce

  private detailHtml(room: Room, circuits: CircuitView[]): string {
    const { store } = this;
    const { doc, activeCircuit } = store.state;
    const rules = rulesOf(doc);
    const kind = getRoomKind(room.kind);
    const types = pointTypes(doc.project.country);
    const counts = new Map(roomCounts(doc, room.id).map((c) => [c.type.key, c] as const));
    const byId = new Map(circuits.map((c) => [c.device.id, c] as const));
    const active = byId.get(activeCircuit ?? -1);
    const area = roomStats(doc).find((s) => s.room.id === room.id)?.area ?? 0;

    // --- Circuit actif
    const activeBar =
      circuits.length === 0
        ? `<div class="active-bar none">
            <span class="cbadge none">–</span>
            <span class="active-text"><b>Pas encore de circuit</b><small>Comptez d’abord : les circuits pourront être proposés automatiquement.</small></span>
            <button type="button" data-active>Créer un circuit</button>
          </div>`
        : `<button type="button" class="active-bar${active ? ' on' : ' none'}" data-active>
            ${active ? circuitBadge(active.ref, active.color, 'lg') : '<span class="cbadge none lg">–</span>'}
            <span class="active-text"><small>Circuit actif</small><b>${active ? esc(active.name) : 'Aucun : les points seront sans circuit'}</b></span>
            <span class="active-change">Changer ${icon('down', 14)}</span>
          </button>`;

    // --- Compteurs
    const tile = (t: PointType): string => {
      const c = counts.get(t.key);
      const total = c?.total ?? 0;
      const chips = c
        ? [...c.byCircuit.entries()]
            .map(([id, n]) => {
              const v = id === null ? undefined : byId.get(id);
              return v ? `${circuitBadge(v.ref, v.color, 'sm')}<em>×${n}</em>` : `<span class="cbadge none sm">–</span><em>×${n}</em>`;
            })
            .join('')
        : '';
      return `<div class="counter${total > 0 ? ' has' : ''}" data-count="${t.key}">
        <div class="counter-top">${glyph(t.kind, 34)}<span class="counter-name">${esc(t.label)}</span></div>
        <div class="counter-row">
          <button type="button" class="step" data-minus="${t.key}" aria-label="Retirer : ${esc(t.label)}"${total === 0 ? ' disabled' : ''}>${icon('minus', 20)}</button>
          <output>${total}</output>
          <button type="button" class="step plus" data-plus="${t.key}" aria-label="Ajouter : ${esc(t.label)}">${icon('plus', 20)}</button>
        </div>
        <div class="counter-chips">${chips}</div>
      </div>`;
    };

    const main = types.filter((t) => t.main);
    const rest = types.filter((t) => !t.main);
    const usedRest = rest.filter((t) => (counts.get(t.key)?.total ?? 0) > 0);
    const groups = (Object.keys(POINT_GROUPS) as PointGroup[])
      .map((g) => {
        const list = rest.filter((t) => t.group === g && (this.showMore || usedRest.includes(t)));
        if (list.length === 0) return '';
        return `<h3>${esc(POINT_GROUPS[g])}</h3><div class="counter-grid small">${list.map(tile).join('')}</div>`;
      })
      .join('');
    const hiddenCount = rest.length - usedRest.length;

    // --- France : minimums de la pièce
    let minimums = '';
    if (rules.country === 'FR') {
      const report = roomNeeds(doc, room.id);
      if (report && report.required > 0) {
        minimums = `<p class="mins">${report.needs
          .map((n) => `<span class="${n.missing > 0 ? 'bad' : 'ok'}">${esc(n.label)} ${n.have}/${n.min}</span>`)
          .join('')}<small>minimums ${esc(rules.code)}</small></p>`;
      }
    }

    // --- Détail des points
    const refs = pointRefs(doc);
    const points = roomPoints(doc, room.id);
    const orphans = points.filter((p) => isElectrical(p) && p.breaker === null).length;
    const rows = points
      .map((p) => this.pointRow(p, types, refs, byId))
      .join('');

    return `
      <header class="detail-head">
        <button type="button" class="icon back" data-back aria-label="Retour aux pièces">${icon('back', 20)}</button>
        <i class="swatch big" style="background:${kind.color}"></i>
        <input type="text" class="title-input" data-room-name value="${esc(room.label)}" placeholder="${esc(kind.name)}" aria-label="Nom de la pièce">
        <select data-room-kind aria-label="Type de pièce">${ROOM_KIND_IDS.map(
          (k) => `<option value="${k}"${k === room.kind ? ' selected' : ''}>${esc(ROOM_KINDS[k].name)}</option>`,
        ).join('')}</select>
        <button type="button" class="icon" data-room-plan title="Voir cette pièce sur le plan" aria-label="Voir sur le plan">${icon('pin', 18)}</button>
        <button type="button" class="icon danger" data-room-del title="Supprimer la pièce" aria-label="Supprimer la pièce">${icon('trash', 18)}</button>
      </header>
      <p class="muted detail-sub">${plural(points.length, 'point')} · ${area.toFixed(1).replace('.', ',')} m²${room.rough ? ' · dimensions à préciser sur le plan' : ''}</p>

      ${activeBar}

      <div class="counter-grid sockets">${main.filter((t) => t.group === 'prises').map(tile).join('')}</div>
      <div class="counter-grid">${main.filter((t) => t.group !== 'prises').map(tile).join('')}</div>
      ${groups}
      ${hiddenCount > 0 || this.showMore ? `<button type="button" class="more-btn" data-more>${this.showMore ? 'Moins de types' : `Appareils fixes et autres types (${hiddenCount})`} ${icon('down', 14)}</button>` : ''}
      ${minimums}

      ${
        points.length > 0
          ? `<section class="points">
              <header><h3>Détail des points</h3>${orphans > 0 ? `<button type="button" data-connect>${icon('wand', 15)} Raccorder les ${orphans} sans circuit</button>` : ''}</header>
              <ul class="point-list">${rows}</ul>
            </section>`
          : ''
      }`;
  }

  private pointRow(p: SymbolItem, types: PointType[], refs: ReadonlyMap<number, string>, byId: ReadonlyMap<number, CircuitView>): string {
    const type = typeOf(p, types);
    const v = p.breaker === null ? undefined : byId.get(p.breaker);
    const ref = refs.get(p.id);
    const electrical = isElectrical(p);
    const circuit = !electrical
      ? '<span class="muted small">courant faible</span>'
      : `<button type="button" class="chip-btn" data-point-circuit="${p.id}" title="Changer de circuit">
          ${v ? circuitBadge(ref ?? v.ref, v.color) : '<span class="cbadge none">–</span>'}
          <span>${v ? esc(v.name) : 'Sans circuit'}</span>
        </button>`;
    return `<li class="point${p.rough ? ' rough' : ''}">
      ${glyph(p.kind, 24)}
      ${
        isSocketKind(p.kind)
          ? `<select class="point-name point-kind" data-point-kind="${p.id}" aria-label="Type de prise">${SOCKET_SERIES.map((k) => {
              const t = types.find((x) => x.kind === k);
              return `<option value="${k}"${k === p.kind ? ' selected' : ''}>${esc(t?.label ?? k)}</option>`;
            }).join('')}</select>`
          : `<span class="point-name">${esc(type?.label ?? p.kind)}</span>`
      }
      <input type="text" data-point-label="${p.id}" value="${esc(p.label)}" placeholder="Repère libre (ex. plan de travail)" aria-label="Repère du point">
      ${circuit}
      <button type="button" class="icon" data-point-plan="${p.id}" title="${p.rough ? 'Position à vérifier : voir sur le plan' : 'Voir sur le plan'}" aria-label="Voir sur le plan">${icon('pin', 16)}</button>
      <button type="button" class="icon danger" data-point-del="${p.id}" title="Supprimer ce point" aria-label="Supprimer">${icon('trash', 16)}</button>
    </li>`;
  }
}
