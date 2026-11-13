import './styles.css';
import './shell.css';
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
import { CircuitsView } from './ui/board/circuitsView';
import { SchemaView } from './ui/board/schemaView';
import { CloudBar } from './ui/cloud/cloudBar';
import { qs } from './ui/dom';
import { DossierView } from './ui/dossier/dossierView';
import { Header } from './ui/header';
import { HomeView } from './ui/home/homeView';
import { Nav } from './ui/nav';
import { PlanChips } from './ui/planChips';
import { PropertiesPanel } from './ui/properties';
import { RoomForm } from './ui/roomForm';
import { RoomsView } from './ui/rooms/roomsView';
import { installShortcuts } from './ui/shortcuts';
import { Sidebar } from './ui/sidebar';
import { Stage } from './ui/stage';
import { Toast } from './ui/toast';
import { View3dWorkspace } from './ui/view3d/view3dWorkspace';
import { WallDrawer } from './ui/walls/wallDrawer';

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

  new Nav(store); // avant les vues : chacune doit savoir si elle est visible
  const tools = new ToolManager(store, ctx);
  canvas = new CanvasView(svg, store, viewport, tools);
  properties = new PropertiesPanel(store);

  // Le plan n'est mesurable que lorsqu'il est affiché : on le cadre à sa première ouverture, et à
  // nouveau quand le document est remplacé pendant qu'il était masqué.
  let framed = '';
  let wasPlan = false;
  let lastFocus = 0;
  const boundsKey = (): string => JSON.stringify(unionBounds(store.state.doc.items));
  const fit = (): void => {
    const { width, height } = canvas.size;
    if (width < 120 || height < 120) {
      framed = '';
      return;
    }
    viewport.fit(unionBounds(store.state.doc.items), width, height);
    framed = boundsKey();
  };
  store.subscribe(() => {
    const isPlan = store.state.mode === 'plan';
    if (isPlan && !wasPlan) {
      const focus = store.state.planFocus?.seq ?? 0;
      if (focus !== lastFocus) {
        // « Voir sur le plan » : le plan se cadre lui-même sur l'élément demandé.
        lastFocus = focus;
        framed = boundsKey();
      } else if (framed !== boundsKey()) {
        // Des pièces ont été ajoutées ailleurs : on recadre l'ensemble.
        requestAnimationFrame(fit);
      }
    }
    wasPlan = isPlan;
  });

  const auth = new Auth();
  const cloud = new Cloud(store, auth);

  new HomeView(store);
  new RoomsView(store);
  new CircuitsView(store);
  new SchemaView(store);
  new BoardWorkspace(store);
  new WallDrawer(store);
  new PlanChips(store);
  new DossierView(store);
  new RoomForm(store);
  new Toast(store);
  new View3dWorkspace(store);
  new Sidebar(store);
  new CloudBar(auth, cloud);
  new Header(store, cloud, fit);
  new Stage(store, viewport, fit);
  installShortcuts(store, tools, canvas);
  // Le brouillon n'est gardé dans le navigateur que s'il n'est pas lié à un chantier en ligne.
  enableAutosave(store, () => cloud.savesLocally);

  document.addEventListener('wirely:fit-plan', fit);

  // L'espace retrouvé après un rechargement (voir Nav) se dessine une première fois.
  store.change(() => undefined);
  fit();
  void cloud.start().then(fit);
}

bootstrap();
