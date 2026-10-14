import type { Store } from '../core/store';
import type { Viewport } from '../core/viewport';
import { distance } from '../domain/geometry';
import type { Point } from '../domain/types';
import { toolMeta } from '../tools/meta';
import type { PointerInfo } from '../tools/tool';
import type { ToolManager } from '../tools/toolManager';
import { snap } from '../domain/geometry';
import { openBoard } from '../core/links';
import { circuitInfo, itemsOfCircuit } from '../domain/link/links';
import { unionBounds } from '../domain/geometry';
import { renderScene } from './items';

interface PanState {
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

/**
 * Vue SVG de l'éditeur : dessine le document, convertit les événements pointeur
 * en `PointerInfo` et les confie à l'outil actif. Gère aussi le zoom et le panoramique.
 */
export class CanvasView {
  private pan: PanState | null = null;
  private spacePan = false;
  private readonly world: SVGGElement;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly store: Store,
    private readonly viewport: Viewport,
    private readonly tools: ToolManager,
  ) {
    this.world = svg.querySelector<SVGGElement>('#world') as SVGGElement;
    store.subscribe(() => this.render());
    viewport.subscribe(() => this.render());

    svg.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    svg.addEventListener('pointermove', (e) => this.onPointerMove(e));
    svg.addEventListener('pointerup', (e) => this.onPointerUp(e));
    svg.addEventListener('pointerleave', () => this.tools.active.pointerLeave());
    svg.addEventListener('dblclick', (e) => {
      this.tools.active.finish();
      // Double-clic sur le symbole d'un tableau lié : on ouvre le tableau.
      if (this.store.state.tool !== 'select') return;
      const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
      const item = id == null ? undefined : this.store.getItem(Number(id));
      if (item?.type === 'symbol' && item.board !== null) openBoard(this.store, item.board);
    });
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('resize', () => this.render());
    // Le tiroir des murs change la hauteur du canevas : on le redessine.
    new ResizeObserver(() => this.render()).observe(svg);
  }

  /** Taille du canevas en pixels. */
  get size(): { width: number; height: number } {
    const r = this.svg.getBoundingClientRect();
    return { width: r.width, height: r.height };
  }

  setSpacePan(on: boolean): void {
    this.spacePan = on;
    this.applyCursor();
  }

  beginPan(e: PointerEvent): void {
    this.pan = { clientX: e.clientX, clientY: e.clientY, originX: this.viewport.x, originY: this.viewport.y };
  }

  render(): void {
    this.tools.sync();
    const { doc, selection, view, activeCircuit } = this.store.state;
    if (this.applyFocusRequest()) return; // le cadrage relance un rendu
    const scene = renderScene(doc, {
      interactive: true,
      selectedId: selection,
      circuits: circuitInfo(doc),
      activeCircuit,
      scale: view.dims ? doc.scale : undefined,
      hide: { wires: !view.wires, symbols: !view.symbols, texts: !view.texts },
    });
    this.svg.classList.toggle('no-grid', !view.grid);
    this.world.innerHTML = scene + this.tools.active.overlay();

    const { x, y, k } = this.viewport;
    this.world.setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
    const pattern = `translate(${x} ${y}) scale(${k})`;
    this.svg.querySelector('#gridS')?.setAttribute('patternTransform', pattern);
    this.svg.querySelector('#gridL')?.setAttribute('patternTransform', pattern);
    this.applyCursor();
  }

  private lastFocusSeq = 0;

  /**
   * Cadre la vue sur le circuit ou l'élément demandé (« voir sur le plan »). La demande n'est
   * consommée que lorsque le canevas a une taille exploitable (il peut être encore masqué).
   */
  private applyFocusRequest(): boolean {
    const req = this.store.state.planFocus;
    if (!req || req.seq === this.lastFocusSeq) return false;
    const { width, height } = this.size;
    if (width < 120 || height < 120) return false;
    this.lastFocusSeq = req.seq;

    const { doc } = this.store.state;
    const items = req.itemId !== null
      ? doc.items.filter((i) => i.id === req.itemId)
      : req.circuit !== null
        ? itemsOfCircuit(doc, req.circuit)
        : [];
    const b = unionBounds(items);
    if (!b) return false;
    const pad = 70;
    this.viewport.fit({ x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }, width, height);
    return true;
  }

  private applyCursor(): void {
    this.svg.style.cursor = this.spacePan ? 'grab' : toolMeta(this.store.state.tool).cursor;
  }

  private info(e: PointerEvent): PointerInfo {
    const rect = this.svg.getBoundingClientRect();
    const world = this.viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    const snapped: Point = [snap(world[0]), snap(world[1])];
    const target = e.target instanceof Element ? e.target : null;
    const id = target?.closest('[data-id]')?.getAttribute('data-id');
    return {
      raw: e,
      world,
      snapped,
      magnet: this.magnetize(world, snapped),
      targetId: id == null ? null : Number(id),
      handle: target?.closest('[data-h]')?.getAttribute('data-h') ?? null,
    };
  }

  /** Attire le point vers le centre du symbole le plus proche (rayon constant à l'écran). */
  private magnetize(world: Point, fallback: Point): Point {
    const radius = 18 / Math.max(this.viewport.k, 0.5);
    let best: Point | null = null;
    let bestDist = radius;
    for (const it of this.store.state.doc.items) {
      if (it.type !== 'symbol') continue;
      const c: Point = [it.x, it.y];
      const d = distance(c, world);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best ?? fallback;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 2) {
      this.tools.active.finish();
      return;
    }
    this.svg.setPointerCapture(e.pointerId);
    if (e.button === 1 || this.spacePan) {
      this.beginPan(e);
      return;
    }
    this.tools.active.pointerDown(this.info(e));
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pan) {
      this.viewport.panTo(
        this.pan.originX + e.clientX - this.pan.clientX,
        this.pan.originY + e.clientY - this.pan.clientY,
      );
      return;
    }
    this.tools.active.pointerMove(this.info(e));
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pan) {
      this.pan = null;
      return;
    }
    this.tools.active.pointerUp(this.info(e));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    this.viewport.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }
}
