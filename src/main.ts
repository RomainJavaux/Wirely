import './styles.css';
import { Auth } from './cloud/auth';
import { Cloud } from './cloud/cloud';
import { Store } from './core/store';
import { Viewport } from './core/viewport';
import { createDoc } from './domain/document';
import { unionBounds } from './domain/geometry';
import { enableAutosave, loadSavedDoc } from './io/persistence';
import { CanvasView } from './render/canvasView';
import type { ToolContext } from './tools/tool';
import { ToolManager } from './tools/toolManager';
import { BoardWorkspace } from './ui/board/boardWorkspace';
import { CloudBar } from './ui/cloud/cloudBar';
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

  new ModeSwitch(store); // avant les vues : le plan doit être visible quand elles mesurent leur taille
  const tools = new ToolManager(store, ctx);
  canvas = new CanvasView(svg, store, viewport, tools);
  properties = new PropertiesPanel(store);

  const fit = () => {
    const { width, height } = canvas.size;
    viewport.fit(unionBounds(store.state.doc.items), width, height);
  };

  const auth = new Auth();
  const cloud = new Cloud(store, auth);

  new BoardWorkspace(store);
  new Sidebar(store);
  new CloudBar(auth, cloud);
  new Toolbar(store, cloud, fit);
  new Stage(store, viewport, fit);
  installShortcuts(store, tools, canvas);
  // Le brouillon n'est gardé dans le navigateur que s'il n'est pas lié à un schéma en ligne.
  enableAutosave(store, () => cloud.savesLocally);

  fit();
  void cloud.start().then(fit);
}

bootstrap();
