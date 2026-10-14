import { setActiveCircuit, showDeviceInBoard, showItemOnPlan, showItemOnWall } from '../../core/links';
import type { Store } from '../../core/store';
import { circuitInfo, circuitOptions, circuitTitle } from '../../domain/link/links';
import { getRoomKind } from '../../domain/plan/roomKinds';
import { CATEGORY_COLORS, buildScene3D, type Scene3D } from '../../domain/view3d/model';
import { faceLabel, faceOfSymbol, roomFaces, symbolsOnFace } from '../../domain/walls/faces';
import { effectiveHeight, isCeilingKind } from '../../domain/walls/mounting';
import type { ThreeView } from '../../render/view3d/threeView';
import { esc } from '../../util/escape';
import { qs } from '../dom';

/** Hauteur de coupe proposée à l'ouverture : on voit l'intérieur des pièces et l'appareillage bas. */
const DEFAULT_CUT = 1.3;
const CUT_MIN = 0.2;

const COMPASS = `<svg viewBox="-20 -20 40 40" width="44" height="44" aria-hidden="true">
  <circle r="18" fill="#fff" stroke="#c9d0dc"/>
  <path d="M0 -14L5 4L0 1L-5 4Z" fill="#c62828"/>
  <path d="M0 14L5 -4L0 -1L-5 -4Z" fill="#9aa3b2" transform="rotate(0)"/>
  <text y="-15.5" font-size="7" font-weight="700" text-anchor="middle" font-family="Arial,sans-serif" fill="#1f2430" stroke="#fff" stroke-width="2" paint-order="stroke">N</text>
</svg>`;

/**
 * Vue 3D du logement : murs, sols, ouvertures, appareillage à sa vraie hauteur et câbles.
 * Three.js n'est chargé qu'à la première ouverture de la vue.
 */
export class View3dWorkspace {
  private view: ThreeView | null = null;
  private loading = false;
  private failed = false;

  private cut: number | null = null;
  private wires = true;
  private ceilingMarks = true;

  private model: Scene3D | null = null;
  private sceneKey = '';
  private sideKey = '';
  private wasActive = false;
  /** À l'ouverture de la vue : se placer face à l'appareil sélectionné dès que la scène est prête. */
  private focusPending = false;

  private readonly stage = qs<HTMLElement>('#view3dStage');
  private readonly side = qs<HTMLElement>('#view3dSide');
  private readonly canvasHost: HTMLElement;
  private readonly message: HTMLElement;
  private readonly compass: HTMLElement;
  private readonly tip: HTMLElement;

  constructor(private readonly store: Store) {
    this.stage.innerHTML = `
      <div class="v3d-canvas"></div>
      <div class="v3d-compass" title="Le nord du plan">${COMPASS}</div>
      <div class="v3d-tip" hidden></div>
      <div class="v3d-msg"></div>
      <div class="v3d-help">Glisser : tourner · Molette : zoomer · Clic droit ou Maj + glisser : déplacer · Clic sur un appareil : détails</div>`;
    this.canvasHost = qs<HTMLElement>('.v3d-canvas', this.stage);
    this.message = qs<HTMLElement>('.v3d-msg', this.stage);
    this.compass = qs<HTMLElement>('.v3d-compass', this.stage);
    this.tip = qs<HTMLElement>('.v3d-tip', this.stage);

    store.subscribe(() => this.render());
  }

  // ---------------------------------------------------------------- chargement

  private async ensureView(): Promise<void> {
    if (this.view || this.loading || this.failed) return;
    this.loading = true;
    this.showMessage('Chargement de la vue 3D…');
    try {
      const { ThreeView } = await import('../../render/view3d/threeView');
      this.view = await ThreeView.create(this.canvasHost, {
        pick: (id) => this.store.change((s) => (s.selection = id)),
        hover: (id, x, y) => this.hover(id, x, y),
        camera: (azimuth) => {
          this.compass.style.transform = `rotate(${azimuth}rad)`;
        },
      });
      this.showMessage('');
    } catch {
      this.failed = true;
      this.showMessage('La vue 3D n’est pas disponible : votre navigateur ou votre carte graphique ne permet pas WebGL.');
    } finally {
      this.loading = false;
    }
    this.sceneKey = '';
    this.render();
  }

  private showMessage(text: string): void {
    this.message.textContent = text;
    this.message.hidden = text === '';
  }

  // ---------------------------------------------------------------- rendu

  private cutHeight(ceilingM: number): number {
    return Math.min(ceilingM, Math.max(CUT_MIN, this.cut ?? Math.min(DEFAULT_CUT, ceilingM)));
  }

  private render(): void {
    const { store } = this;
    const active = store.state.mode === 'view3d';
    if (active && !this.wasActive) this.focusPending = true;
    this.wasActive = active;
    if (!active) return;

    void this.ensureView();
    const { doc, selection, activeCircuit } = store.state;
    const ceilingM = doc.ceiling / 100;
    const cut = this.cutHeight(ceilingM);

    const sceneKey = `${store.revision}:${cut}`;
    if (this.view && sceneKey !== this.sceneKey) {
      this.sceneKey = sceneKey;
      this.model = buildScene3D(doc, { wallHeight: cut });
      this.view.setScene(this.model);
    }
    if (this.view) {
      const known = this.model?.marks.some((m) => m.id === selection) ? selection : null;
      this.view.setDisplay({ wires: this.wires, ceilingMarks: this.ceilingMarks });
      this.view.setHighlight({ selectedId: known, activeCircuit });
      if (this.focusPending) {
        this.focusPending = false;
        if (known !== null) this.view.focus(known);
      }
    }

    const key = `${selection}:${activeCircuit}:${store.revision}:${this.model ? 'ready' : 'wait'}`;
    if (key !== this.sideKey) {
      this.sideKey = key;
      this.renderSide(cut, ceilingM);
    }
  }

  private hover(id: number | null, x: number, y: number): void {
    const mark = id === null ? undefined : this.model?.marks.find((m) => m.id === id);
    if (!mark) {
      this.tip.hidden = true;
      return;
    }
    const info = mark.breaker !== null ? circuitInfo(this.store.state.doc).get(mark.breaker) : undefined;
    const rect = this.stage.getBoundingClientRect();
    const height = mark.ceiling ? 'plafond' : `h ${Math.round(mark.y * 100)} cm`;
    this.tip.innerHTML = `<b>${esc(mark.name)}</b>${mark.label.trim() ? ` · ${esc(mark.label.trim())}` : ''}<br>
      <span>${height}${info ? ` · circuit ${esc(info.ref)}` : ''}</span>`;
    this.tip.style.left = `${Math.min(x - rect.left + 14, rect.width - 190)}px`;
    this.tip.style.top = `${Math.max(8, y - rect.top - 8)}px`;
    this.tip.hidden = false;
  }

  private renderSide(cut: number, ceilingM: number): void {
    const { store } = this;
    const { doc, selection, activeCircuit } = store.state;
    const options = circuitOptions(doc);
    const fmt = (m: number): string => m.toFixed(2).replace('.', ',');

    const presets = [
      { id: 'full', label: 'Murs entiers', value: ceilingM },
      { id: 'cut', label: `Coupe ${fmt(Math.min(DEFAULT_CUT, ceilingM))} m`, value: Math.min(DEFAULT_CUT, ceilingM) },
      { id: 'floor', label: 'Sol seul', value: CUT_MIN },
    ];

    const total = this.model?.marks.length ?? 0;
    const onCeiling = this.model?.marks.filter((m) => m.ceiling).length ?? 0;

    let selected = '';
    const mark = this.model?.marks.find((m) => m.id === selection);
    const item = store.getItem(selection);
    if (mark && item?.type === 'symbol') {
      const ceiling = isCeilingKind(item.kind);
      const found = ceiling ? null : faceOfSymbol(doc, item);
      let where = ceiling ? 'Au plafond' : 'Hors d’un mur';
      if (found) {
        const placed = symbolsOnFace(doc, found.face).find((p) => p.item.id === item.id);
        const room = found.room.label.trim() || getRoomKind(found.room.kind).name;
        where = `${faceLabel(found.face, roomFaces(found.room))} · ${room}`;
        if (placed) where += `<br>à ${Math.round(placed.u)} cm du coin gauche, à ${Math.round(effectiveHeight(item))} cm du sol`;
      }
      const info = item.breaker !== null ? circuitInfo(doc).get(item.breaker) : undefined;
      const option = item.breaker !== null ? options.find((o) => o.id === item.breaker) : undefined;
      const circuit = option
        ? `<p class="muted"><i class="dot" style="background:${info?.color ?? '#6b7385'}"></i>${esc(circuitTitle(doc, option))}</p>`
        : '<p class="muted">Non raccordé à un disjoncteur.</p>';
      selected = `
        <h3>Appareil sélectionné</h3>
        <div class="v3d-card">
          <b>${esc(mark.name)}</b>${item.label.trim() ? ` <span class="muted">« ${esc(item.label.trim())} »</span>` : ''}
          <p class="muted">${where}</p>
          ${circuit}
          <div class="row">
            <button type="button" id="v3Wall"${found ? '' : ' disabled'}>Régler sur le mur ↗</button>
            <button type="button" id="v3Plan">Plan ↗</button>
            ${option ? '<button type="button" id="v3Board">Tableau ↗</button>' : ''}
          </div>
          ${option && activeCircuit !== item.breaker ? '<div class="row"><button type="button" id="v3Light">Mettre ce circuit en évidence</button></div>' : ''}
        </div>`;
    }

    const legend = Object.entries(CATEGORY_COLORS)
      .map(([name, color]) => `<li><i style="background:${color}"></i>${esc(name)}</li>`)
      .join('');

    this.side.innerHTML = `
      <h3>Murs</h3>
      <div class="presets">${presets
        .map((p) => `<button type="button" data-cut="${p.value}" class="${Math.abs(p.value - cut) < 0.011 ? 'active' : ''}">${esc(p.label)}</button>`)
        .join('')}</div>
      <label class="f" for="v3Cut">Hauteur des murs : <b id="v3CutOut">${fmt(cut)} m</b></label>
      <input type="range" id="v3Cut" min="${CUT_MIN}" max="${ceilingM}" step="0.05" value="${cut}">

      <h3>Affichage</h3>
      <label class="chk-line"><input type="checkbox" id="v3Wires"${this.wires ? ' checked' : ''}> Câbles (au plafond)</label>
      <label class="chk-line"><input type="checkbox" id="v3Ceil"${this.ceilingMarks ? ' checked' : ''}> Appareils de plafond${onCeiling ? ` <small>(${onCeiling})</small>` : ''}</label>
      <div class="row">
        <button type="button" id="v3Iso">Perspective</button>
        <button type="button" id="v3Top">Vue du dessus</button>
      </div>

      <h3>Circuit en évidence</h3>
      <select id="v3Circuit" aria-label="Circuit en évidence"${options.length ? '' : ' disabled'}>
        <option value="">${options.length ? '— tous les circuits —' : 'Aucun tableau'}</option>
        ${options
          .map((o) => `<option value="${o.id}"${o.id === activeCircuit ? ' selected' : ''}>${esc(circuitTitle(doc, o))}</option>`)
          .join('')}
      </select>
      <p class="muted">Le reste de la maison est atténué : on voit d’un coup d’œil ce que ce disjoncteur alimente.</p>

      ${selected}

      <h3>Légende</h3>
      <ul class="legend">${legend}</ul>
      <p class="muted">${total} appareil${total > 1 ? 's' : ''} posé${total > 1 ? 's' : ''}. Les plaques sont agrandies pour rester lisibles ; les hauteurs sont celles du plan.</p>`;

    this.bindSide();
  }

  private bindSide(): void {
    const { store } = this;
    const $ = <T extends HTMLElement>(sel: string) => this.side.querySelector<T>(sel);
    const fmt = (m: number): string => m.toFixed(2).replace('.', ',');

    const setCut = (value: number): void => {
      this.cut = value;
      this.render();
    };
    this.side.querySelectorAll<HTMLButtonElement>('[data-cut]').forEach((b) => {
      b.onclick = () => {
        setCut(Number(b.dataset.cut));
        this.sideKey = '';
        this.render();
      };
    });
    const range = $<HTMLInputElement>('#v3Cut');
    if (range) {
      range.oninput = () => {
        const out = $('#v3CutOut');
        if (out) out.textContent = `${fmt(Number(range.value))} m`;
        setCut(Number(range.value));
      };
      range.onchange = () => {
        this.sideKey = '';
        this.render();
      };
    }

    const wires = $<HTMLInputElement>('#v3Wires');
    if (wires) {
      wires.onchange = () => {
        this.wires = wires.checked;
        this.view?.setDisplay({ wires: this.wires, ceilingMarks: this.ceilingMarks });
      };
    }
    const ceil = $<HTMLInputElement>('#v3Ceil');
    if (ceil) {
      ceil.onchange = () => {
        this.ceilingMarks = ceil.checked;
        this.view?.setDisplay({ wires: this.wires, ceilingMarks: this.ceilingMarks });
      };
    }
    const on = (sel: string, fn: () => void): void => {
      const b = $<HTMLButtonElement>(sel);
      if (b) b.onclick = fn;
    };
    on('#v3Iso', () => this.view?.view('iso'));
    on('#v3Top', () => this.view?.view('top'));

    const circuit = $<HTMLSelectElement>('#v3Circuit');
    if (circuit) circuit.onchange = () => setActiveCircuit(store, circuit.value ? Number(circuit.value) : null);

    const id = store.state.selection;
    if (id === null) return;
    const item = store.getItem(id);
    on('#v3Wall', () => showItemOnWall(store, id));
    on('#v3Plan', () => showItemOnPlan(store, id));
    on('#v3Board', () => {
      if (item?.type === 'symbol' && item.breaker !== null) showDeviceInBoard(store, item.breaker);
    });
    on('#v3Light', () => {
      if (item?.type === 'symbol' && item.breaker !== null) setActiveCircuit(store, item.breaker);
    });
  }
}
