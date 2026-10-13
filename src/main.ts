import './styles.css';
import { Store } from './core/store';
import { Viewport } from './core/viewport';
import { createDoc } from './domain/document';
import { unionBounds } from './domain/geometry';
import { enableAutosave, loadSavedDoc } from './io/persistence';
import { CanvasView } from './render/canvasView';
import type { ToolContext } from './tools/tool';
import { ToolManager } from './tools/toolManager';
import { BoardWorkspace } from './ui/board/boardWorkspace';
import { ModeSwitch } from './ui/modeSwitch';
import { qs } from './ui/dom';
import { PropertiesPanel } from './ui/properties';
import { installShortcuts } from './ui/shortcuts';
import { Sidebar } from './ui/sidebar';
import { Stage } from './ui/stage';
import { Toolbar } from './ui/toolbar';

/** Racine de composition : assemble les couches, sans logique métier. */
function bootstrap(): void {
  const store = new Store(loadSavedDoc() ?? createDoc());
  const viewport = new Viewport();
  const svg = qs<SVGSVGElement>('#svg');

  let canvas!: CanvasView;
  let properties!: PropertiesPanel;

  const ctx: ToolContext = {
    store,
    viewport,
    requestRender: () => canvas.render(),
    beginPan: (e) => canvas.beginPan(e),
    promptText: (message) => window.prompt(message),
    focusLabel: () => properties.focusLabel(),
  };

  const tools = new ToolManager(store, ctx);
  canvas = new CanvasView(svg, store, viewport, tools);
  properties = new PropertiesPanel(store);

  const fit = () => {
    const { width, height } = canvas.size;
    viewport.fit(unionBounds(store.state.doc.items), width, height);
  };

  new ModeSwitch(store);
  new BoardWorkspace(store);
  new Sidebar(store);
  new Toolbar(store, fit);
  new Stage(store, viewport, fit);
  installShortcuts(store, tools, canvas);
  enableAutosave(store);

  fit();
}

bootstrap();
