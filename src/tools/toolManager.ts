import type { Store } from '../core/store';
import type { Tool, ToolContext } from './tool';
import { AssignTool } from './assignTool';
import { PolylineTool } from './polylineTool';
import { RoomTool } from './roomTool';
import { SelectTool } from './selectTool';
import { SymbolTool } from './symbolTool';
import { TextTool } from './textTool';

/** Instancie les outils et garde l'outil actif aligné sur `store.state.tool`. */
export class ToolManager {
  private readonly tools: Map<string, Tool>;
  private current: Tool;

  constructor(
    private readonly store: Store,
    ctx: ToolContext,
  ) {
    const all: Tool[] = [
      new SelectTool(ctx),
      new RoomTool(ctx),
      new PolylineTool(ctx, 'wall'),
      new PolylineTool(ctx, 'wire'),
      new SymbolTool(ctx),
      new TextTool(ctx),
      new AssignTool(ctx),
    ];
    this.tools = new Map(all.map((t) => [t.id, t]));
    this.current = this.tools.get(store.state.tool) as Tool;
  }

  get active(): Tool {
    return this.current;
  }

  /** À appeler après chaque changement d'état : bascule l'outil si besoin. */
  sync(): void {
    const wanted = this.tools.get(this.store.state.tool);
    if (wanted && wanted !== this.current) {
      // Remplacer avant d'annuler : cancel() redemande un rendu, qui rappelle sync().
      const previous = this.current;
      this.current = wanted;
      previous.cancel();
    }
  }
}
