import { setTool } from '../core/actions';
import type { Store } from '../core/store';
import { SYMBOLS, SYMBOL_CATEGORIES, WIRE_TYPES, WIRE_TYPE_IDS } from '../domain/catalog';
import type { WireTypeId } from '../domain/types';
import { GLYPH_ATTRS } from '../render/items';
import { TOOLS_META } from '../tools/meta';
import { esc } from '../util/escape';
import { qs } from './dom';

/** Panneau de gauche : outils, types de câble et palette de symboles. */
export class Sidebar {
  private readonly toolsEl = qs<HTMLElement>('#tools');
  private readonly wiresEl = qs<HTMLElement>('#wireTypes');
  private readonly paletteEl = qs<HTMLElement>('#palette');

  constructor(private readonly store: Store) {
    this.buildTools();
    this.buildWireTypes();
    this.buildPalette();
    store.subscribe(() => this.sync());
    this.sync();
  }

  private buildTools(): void {
    this.toolsEl.innerHTML = TOOLS_META.filter((t) => t.inToolbar)
      .map((t) => `<button data-tool="${t.id}" title="${(t.key ?? '').toUpperCase()}">${esc(t.label)}</button>`)
      .join('');
    this.toolsEl.addEventListener('click', (e) => {
      const id = (e.target as Element).closest<HTMLElement>('[data-tool]')?.dataset.tool;
      if (id) setTool(this.store, id as Parameters<typeof setTool>[1]);
    });
  }

  private buildWireTypes(): void {
    this.wiresEl.innerHTML = WIRE_TYPE_IDS.map((id) => {
      const w = WIRE_TYPES[id];
      const dashed = w.dash ? ';border-top-style:dashed' : '';
      return `<button data-wire="${id}"><i style="border-color:${w.color}${dashed}"></i>${esc(w.name)}</button>`;
    }).join('');
    this.wiresEl.addEventListener('click', (e) => {
      const id = (e.target as Element).closest<HTMLElement>('[data-wire]')?.dataset.wire as WireTypeId | undefined;
      if (!id) return;
      const selected = this.store.selectedItem;
      if (selected?.type === 'wire' && this.store.state.tool === 'select') {
        this.store.state.wireType = id;
        this.store.updateItem({ ...selected, wtype: id });
        this.store.commit();
      } else {
        this.store.change((s) => (s.wireType = id));
        setTool(this.store, 'wire');
      }
    });
  }

  private buildPalette(): void {
    this.paletteEl.innerHTML = SYMBOL_CATEGORIES.map((cat) => {
      const buttons = SYMBOLS.filter((s) => s.category === cat)
        .map(
          (s) =>
            `<button data-sym="${s.id}" title="${esc(s.name)}"><svg viewBox="-18 -18 36 36" ${GLYPH_ATTRS}>${s.svg}</svg>${esc(s.name)}</button>`,
        )
        .join('');
      return `<h3>${esc(cat)}</h3><div class="palette">${buttons}</div>`;
    }).join('');
    this.paletteEl.addEventListener('click', (e) => {
      const kind = (e.target as Element).closest<HTMLElement>('[data-sym]')?.dataset.sym;
      if (kind) setTool(this.store, 'symbol', kind);
    });
  }

  private sync(): void {
    const { tool, symbolKind, wireType } = this.store.state;
    this.toolsEl.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) =>
      b.classList.toggle('active', b.dataset.tool === tool),
    );
    this.wiresEl.querySelectorAll<HTMLElement>('[data-wire]').forEach((b) =>
      b.classList.toggle('active', b.dataset.wire === wireType),
    );
    this.paletteEl.querySelectorAll<HTMLElement>('[data-sym]').forEach((b) =>
      b.classList.toggle('active', tool === 'symbol' && b.dataset.sym === symbolKind),
    );
  }
}
