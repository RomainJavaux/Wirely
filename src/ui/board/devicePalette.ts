import { DEVICES, DEVICE_CATEGORIES } from '../../domain/board/catalog';
import { createDevice } from '../../domain/board/layout';
import { devicePreview } from '../../render/board/deviceGlyph';
import type { Store } from '../../core/store';
import { esc } from '../../util/escape';

/**
 * Palette des appareils du tableau. Un clic « arme » l'appareil (puis un clic sur un rail le pose) ;
 * un glisser-déposer le pose directement. Le glisser est géré par l'espace de travail.
 */
export class DevicePalette {
  constructor(
    private readonly el: HTMLElement,
    private readonly store: Store,
    onPointerDown: (kind: string, e: PointerEvent) => void,
  ) {
    el.innerHTML = DEVICE_CATEGORIES.map((cat) => {
      const items = DEVICES.filter((d) => d.category === cat)
        .map((def) => {
          const preview = devicePreview(def, createDevice(def, 0, 0, 0));
          const width = def.variants.find((v) => v.id === def.defaultVariant)?.width ?? 1;
          return (
            `<button class="dev" data-kind="${def.id}" title="${esc(def.name)}">` +
            `${preview}<span class="dev-name">${esc(def.name)}</span>` +
            `<span class="dev-mod">${width} module${width > 1 ? 's' : ''}</span></button>`
          );
        })
        .join('');
      return `<h3>${esc(cat)}</h3><div class="devgrid">${items}</div>`;
    }).join('');

    el.addEventListener('pointerdown', (e) => {
      const kind = (e.target as Element).closest<HTMLElement>('[data-kind]')?.dataset.kind;
      if (kind && e.button === 0) {
        e.preventDefault();
        onPointerDown(kind, e);
      }
    });
    store.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const armed = this.store.state.armedKind;
    this.el.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.classList.toggle('active', b.dataset.kind === armed));
  }
}
