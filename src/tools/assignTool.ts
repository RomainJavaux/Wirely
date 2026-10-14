import { isElectrical } from '../domain/link/links';
import { BaseTool, type PointerInfo } from './tool';

/**
 * Raccorde au circuit actif les câbles et appareils sur lesquels on clique ; un second clic sur
 * un élément déjà raccordé à ce circuit le détache.
 */
export class AssignTool extends BaseTool {
  readonly id = 'assign' as const;

  override pointerDown(p: PointerInfo): void {
    const { store } = this.ctx;
    const active = store.state.activeCircuit;
    if (active === null || p.targetId === null) return;

    const item = store.getItem(p.targetId);
    if (item?.type !== 'wire' && item?.type !== 'symbol') return;
    if (item.type === 'symbol' && !isElectrical(item)) return;

    store.updateItem({ ...item, breaker: item.breaker === active ? null : active });
    store.commit();
  }
}
