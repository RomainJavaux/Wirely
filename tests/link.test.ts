import { describe, expect, it } from 'vitest';
import { addItem, loadExamplePlan } from '../src/core/actions';
import { deleteActiveBoard, removeDevice } from '../src/core/boardActions';
import {
  assignBreaker,
  createLinkedBoard,
  focusDevice,
  linkSymbolToBoard,
  openBoard,
  showCircuitOnPlan,
  showDeviceInBoard,
  showItemOnPlan,
  startAssigning,
} from '../src/core/links';
import { Store } from '../src/core/store';
import { createDevice } from '../src/domain/board/layout';
import { getDeviceDef } from '../src/domain/board/catalog';
import { buildBoard } from '../src/domain/board/templates';
import type { Board, Device } from '../src/domain/board/types';
import { runLinkChecks } from '../src/domain/link/checks';
import {
  allLinks,
  circuitFromTitle,
  circuitInfo,
  circuitOptions,
  circuitTitle,
  linkBadges,
  linksSummary,
  locateDevice,
  matchingDevices,
  symbolOfBoard,
  unlinkedItems,
} from '../src/domain/link/links';
import { createDoc, parseDoc } from '../src/domain/document';
import { runPlanChecks } from '../src/domain/plan/checks';
import type { Doc, Item, Room, SymbolItem, Wire } from '../src/domain/types';
import { buildBoardSheetSvg } from '../src/io/boardSheet';
import { buildExportSvg } from '../src/io/exporter';
import { AssignTool } from '../src/tools/assignTool';
import type { PointerInfo, ToolContext } from '../src/tools/tool';
import { Viewport } from '../src/core/viewport';

// ------------------------------------------------------------------ fixtures

let n = 1000;
const nid = () => n++;

const device = (kind: string, row: number, col: number, patch: Partial<Device> = {}): Device => {
  const def = getDeviceDef(kind);
  if (!def) throw new Error(kind);
  return createDevice(def, nid(), row, col, patch);
};

const room = (id: number, x: number, y: number, w: number, h: number, label: string, kind: Room['kind'] = 'autre'): Room => ({
  id, type: 'room', x, y, w, h, label, kind, parts: [],
});
const sym = (id: number, kind: string, x: number, y: number, breaker: number | null = null, label = ''): SymbolItem => ({
  id, type: 'symbol', kind, x, y, rot: 0, label, breaker, board: null, height: null,
});
const wire = (id: number, breaker: number | null, points: [number, number][] = [[0, 0], [200, 0]]): Wire => ({
  id, type: 'wire', points, wtype: 'prises', breaker,
});

/** Un tableau : différentiel puis deux disjoncteurs (« Prises cuisine » 20 A, « Éclairage » 10 A). */
function fixture(items: Item[] = []): { doc: Doc; board: Board; cuisine: Device; lumiere: Device; rcd: Device } {
  const rcd = device('idiff', 0, 0);
  const cuisine = device('disj', 0, 2, { rating: 20, label: 'Prises cuisine', dest: 'Cuisine' });
  const lumiere = device('disj', 0, 3, { rating: 10, label: 'Éclairage' });
  const board: Board = { id: nid(), name: 'Principal', location: '', supply: 'mono', cols: 13, rows: 1, devices: [rcd, cuisine, lumiere] };
  const doc = { ...createDoc('Test'), items, boards: [board] };
  return { doc, board, cuisine, lumiere, rcd };
}

// ------------------------------------------------------------------ modèle et migration

describe('lecture de fichier : liens', () => {
  it('résout un ancien repère saisi à la main sur le premier tableau', () => {
    const { board, cuisine } = fixture();
    const doc = parseDoc({
      boards: [board],
      items: [
        { id: 1, type: 'wire', points: [[0, 0], [1, 1]], wtype: 'prises', circuit: '1' },
        { id: 2, type: 'symbol', kind: 'prise', x: 0, y: 0, rot: 0, label: '', circuit: '99' },
      ],
    });
    expect(doc.items[0]).toMatchObject({ breaker: cuisine.id });
    expect(doc.items[1]).toMatchObject({ breaker: null }); // repère inexistant : oublié
  });

  it('oublie un disjoncteur ou un tableau qui n’existe plus', () => {
    const { board } = fixture();
    const doc = parseDoc({
      boards: [board],
      items: [
        { id: 1, type: 'wire', points: [[0, 0], [1, 1]], wtype: 'prises', breaker: 424242 },
        { id: 2, type: 'symbol', kind: 'tableau', x: 0, y: 0, rot: 0, label: '', breaker: null, board: 777 },
        { id: 3, type: 'symbol', kind: 'tableau', x: 0, y: 0, rot: 0, label: '', breaker: null, board: board.id },
      ],
    });
    expect(doc.items[0]).toMatchObject({ breaker: null });
    expect(doc.items[1]).toMatchObject({ board: null });
    expect(doc.items[2]).toMatchObject({ board: board.id });
  });

  it('conserve un lien valide dans un aller-retour', () => {
    const { doc, cuisine } = fixture([wire(1, null)]);
    doc.items = [wire(1, cuisine.id)];
    const back = parseDoc(JSON.parse(JSON.stringify(doc)));
    expect(back.items[0]).toMatchObject({ breaker: cuisine.id });
  });
});

// ------------------------------------------------------------------ calculs de liens

describe('ce qu’il y a derrière un disjoncteur', () => {
  it('compte appareils, câbles, longueur et pièces', () => {
    const { doc, cuisine } = fixture();
    doc.items = [
      room(1, 0, 0, 200, 200, 'Cuisine', 'cuisine'),
      room(2, 200, 0, 200, 200, 'Salon', 'sejour'),
      sym(10, 'prise', 50, 50, cuisine.id),
      sym(11, 'prise', 150, 50, cuisine.id),
      sym(12, 'prise', 250, 50, cuisine.id),
      sym(13, 'lampe', 100, 100, cuisine.id),
      sym(14, 'inter', 100, 150, cuisine.id),
      wire(20, cuisine.id, [[0, 0], [200, 0]]), // 200 unités = 5 m
      wire(21, cuisine.id, [[0, 0], [0, 40]]), // 40 unités = 1 m
    ];
    const l = allLinks(doc).get(cuisine.id);
    expect(l).toBeDefined();
    expect([l?.sockets, l?.lights, l?.switches, l?.wires.length]).toEqual([3, 1, 1, 2]);
    expect(l?.length).toBeCloseTo(6);
    expect(l?.rooms.map((r) => [r.label, r.count])).toEqual([['Cuisine', 4], ['Salon', 1]]);
    expect(linksSummary(l!)).toBe('3 prises · 1 point lumineux · 1 commande · 6,0 m');
  });

  it('ne produit rien pour un disjoncteur sans raccordement', () => {
    const { doc, lumiere } = fixture([sym(1, 'prise', 0, 0)]);
    expect(allLinks(doc).get(lumiere.id)).toBeUndefined();
  });

  it('distingue les éléments non raccordés ; portes, fenêtres et tableau n’ont pas à l’être', () => {
    const { doc, cuisine } = fixture([
      sym(1, 'prise', 0, 0, cuisine_id()),
      sym(2, 'prise', 10, 0),
      sym(3, 'porte', 20, 0),
      sym(4, 'fenetre', 30, 0),
      sym(5, 'tableau', 40, 0),
      wire(6, null),
      wire(7, null),
    ]);
    function cuisine_id() {
      return -1; // remplacé ci-dessous
    }
    (doc.items[0] as SymbolItem).breaker = cuisine.id;
    const u = unlinkedItems(doc);
    expect(u.symbols.map((s) => s.id)).toEqual([2]);
    expect(u.wires.map((w) => w.id)).toEqual([6, 7]);
  });

  it('badges : nombre d’éléments par disjoncteur', () => {
    const { doc, cuisine, lumiere } = fixture();
    doc.items = [sym(1, 'prise', 0, 0, cuisine.id), wire(2, cuisine.id), sym(3, 'lampe', 0, 0, lumiere.id)];
    const badges = linkBadges(doc);
    expect(badges.get(cuisine.id)).toBe(2);
    expect(badges.get(lumiere.id)).toBe(1);
  });

  it('retrouve un appareil dans son tableau', () => {
    const { doc, cuisine, board } = fixture();
    expect(locateDevice(doc, cuisine.id)?.board.id).toBe(board.id);
    expect(locateDevice(doc, 99999)).toBeNull();
    expect(locateDevice(doc, null)).toBeNull();
  });
});

// ------------------------------------------------------------------ choix d'un circuit

describe('choix d’un circuit', () => {
  it('liste les disjoncteurs avec repère, couleur et différentiel', () => {
    const { doc, cuisine } = fixture();
    const opts = circuitOptions(doc);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toMatchObject({ id: cuisine.id, ref: '1', label: 'Prises cuisine', group: 'ID1' });
    expect(circuitInfo(doc).get(cuisine.id)).toMatchObject({ ref: '1' });
  });

  it('retrouve un circuit par son libellé, sans tenir compte de la casse', () => {
    const { doc, cuisine } = fixture();
    const title = circuitTitle(doc, circuitOptions(doc)[0]!);
    expect(title).toMatch(/^1 · Prises cuisine · /);
    expect(circuitFromTitle(doc, title.toUpperCase())?.id).toBe(cuisine.id);
    expect(circuitFromTitle(doc, 'inconnu')).toBeNull();
    expect(circuitFromTitle(doc, '   ')).toBeNull();
  });

  it('préfixe le nom du tableau quand il y en a plusieurs (libellés uniques)', () => {
    const a = fixture();
    const b = fixture();
    const doc = { ...a.doc, boards: [a.board, b.board] };
    const titles = circuitOptions(doc).map((o) => circuitTitle(doc, o));
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles[0]).toContain('Principal (1) —');
    expect(titles[titles.length - 1]).toContain('Principal (2) —');
  });
});

// ------------------------------------------------------------------ actions

describe('raccordement', () => {
  it('raccorde et détache un élément, annulable', () => {
    const { doc, cuisine } = fixture([wire(1, null)]);
    const store = new Store(doc);
    store.commit();
    assignBreaker(store, 1, cuisine.id);
    expect(store.getItem(1)).toMatchObject({ breaker: cuisine.id });
    assignBreaker(store, 1, null);
    expect(store.getItem(1)).toMatchObject({ breaker: null });
    store.undo();
    expect(store.getItem(1)).toMatchObject({ breaker: cuisine.id });
  });

  it('refuse un disjoncteur inconnu et les éléments qui ne se raccordent pas', () => {
    const { doc } = fixture([wire(1, null), { ...room(2, 0, 0, 10, 10, '') }]);
    const store = new Store(doc);
    assignBreaker(store, 1, 424242);
    assignBreaker(store, 2, 1);
    expect(store.getItem(1)).toMatchObject({ breaker: null });
  });

  it('avec un circuit actif, ce qu’on dessine s’y raccorde (sauf ouvertures et tableau)', () => {
    const { doc, cuisine } = fixture();
    const store = new Store(doc);
    store.state.activeCircuit = cuisine.id;
    const prise = addItem(store, { type: 'symbol', kind: 'prise', x: 0, y: 0, rot: 0, label: '', breaker: null, board: null, height: null });
    const porte = addItem(store, { type: 'symbol', kind: 'porte', x: 0, y: 0, rot: 0, label: '', breaker: null, board: null, height: null });
    const tableau = addItem(store, { type: 'symbol', kind: 'tableau', x: 0, y: 0, rot: 0, label: '', breaker: null, board: null, height: null });
    const cable = addItem(store, { type: 'wire', points: [[0, 0], [10, 0]], wtype: 'prises', breaker: null });
    expect(store.getItem(prise)).toMatchObject({ breaker: cuisine.id });
    expect(store.getItem(cable)).toMatchObject({ breaker: cuisine.id });
    expect(store.getItem(porte)).toMatchObject({ breaker: null });
    expect(store.getItem(tableau)).toMatchObject({ breaker: null });
  });

  it('supprimer un disjoncteur détache ce qui y était raccordé', () => {
    const { doc, cuisine } = fixture([wire(1, null), sym(2, 'prise', 0, 0)]);
    (doc.items[0] as Wire).breaker = cuisine.id;
    (doc.items[1] as SymbolItem).breaker = cuisine.id;
    const store = new Store(doc);
    store.state.activeCircuit = cuisine.id;
    store.state.deviceSelection = cuisine.id;
    removeDevice(store, cuisine.id);
    expect(store.getItem(1)).toMatchObject({ breaker: null });
    expect(store.getItem(2)).toMatchObject({ breaker: null });
    expect(store.state.activeCircuit).toBeNull();
  });

  it('supprimer un tableau retire les liens du plan', () => {
    const { doc, cuisine, board } = fixture([wire(1, null), sym(2, 'tableau', 0, 0)]);
    (doc.items[0] as Wire).breaker = cuisine.id;
    (doc.items[1] as SymbolItem).board = board.id;
    const store = new Store(doc);
    store.state.boardId = board.id;
    deleteActiveBoard(store);
    expect(store.getItem(1)).toMatchObject({ breaker: null });
    expect(store.getItem(2)).toMatchObject({ board: null });
    expect(store.state.doc.boards).toHaveLength(0);
  });

  it('un tableau n’est représenté que par un seul symbole', () => {
    const { doc, board } = fixture([sym(1, 'tableau', 0, 0), sym(2, 'tableau', 50, 0)]);
    const store = new Store(doc);
    linkSymbolToBoard(store, 1, board.id);
    linkSymbolToBoard(store, 2, board.id);
    expect(store.getItem(1)).toMatchObject({ board: null });
    expect(store.getItem(2)).toMatchObject({ board: board.id });
    expect(symbolOfBoard(store.state.doc, board.id)?.id).toBe(2);
    linkSymbolToBoard(store, 2, null);
    expect(symbolOfBoard(store.state.doc, board.id)).toBeUndefined();
  });

  it('crée un tableau lié à un symbole', () => {
    const store = new Store({ ...createDoc(), items: [sym(1, 'tableau', 0, 0, null, 'Garage')] });
    const boardId = createLinkedBoard(store, 1);
    expect(boardId).not.toBeNull();
    expect(store.state.doc.boards[0]).toMatchObject({ id: boardId, name: 'Garage' });
    expect(store.getItem(1)).toMatchObject({ board: boardId });
    expect(store.state.boardId).toBe(boardId);
  });
});

describe('outil Affecter', () => {
  const tool = (store: Store) => new AssignTool({ store, viewport: new Viewport() } as unknown as ToolContext);
  const click = (id: number | null): PointerInfo => ({ targetId: id } as PointerInfo);

  it('raccorde au circuit actif, puis détache au second clic', () => {
    const { doc, cuisine } = fixture([sym(1, 'prise', 0, 0), wire(2, null)]);
    const store = new Store(doc);
    store.commit();
    store.state.activeCircuit = cuisine.id;
    const t = tool(store);
    t.pointerDown(click(1));
    t.pointerDown(click(2));
    expect(store.getItem(1)).toMatchObject({ breaker: cuisine.id });
    expect(store.getItem(2)).toMatchObject({ breaker: cuisine.id });
    t.pointerDown(click(1));
    expect(store.getItem(1)).toMatchObject({ breaker: null });
  });

  it('ne fait rien sans circuit actif, hors élément ou sur une porte', () => {
    const { doc } = fixture([sym(1, 'prise', 0, 0), sym(2, 'porte', 0, 0), room(3, 0, 0, 10, 10, '')]);
    const store = new Store(doc);
    const t = tool(store);
    t.pointerDown(click(1)); // pas de circuit actif
    expect(store.getItem(1)).toMatchObject({ breaker: null });
    store.state.activeCircuit = doc.boards[0]!.devices[1]!.id;
    t.pointerDown(click(null));
    t.pointerDown(click(2));
    t.pointerDown(click(3));
    expect(store.getItem(2)).toMatchObject({ breaker: null });
  });
});

// ------------------------------------------------------------------ navigation

describe('navigation plan ↔ tableau', () => {
  it('« voir sur le plan » : mode plan, circuit actif, cadrage demandé', () => {
    const { doc, cuisine } = fixture([sym(1, 'prise', 0, 0, null)]);
    const store = new Store(doc);
    store.state.mode = 'board';
    showCircuitOnPlan(store, cuisine.id);
    expect(store.state.mode).toBe('plan');
    expect(store.state.activeCircuit).toBe(cuisine.id);
    expect(store.state.planFocus).toMatchObject({ circuit: cuisine.id });
  });

  it('« voir au tableau » : mode tableau, bon tableau, appareil sélectionné, défilement demandé', () => {
    const a = fixture();
    const b = fixture();
    const store = new Store({ ...a.doc, boards: [a.board, b.board] });
    showDeviceInBoard(store, b.cuisine.id);
    expect(store.state).toMatchObject({ mode: 'board', boardId: b.board.id, deviceSelection: b.cuisine.id });
    expect(store.state.boardFocus?.deviceId).toBe(b.cuisine.id);
  });

  it('les demandes de défilement sont distinctes (numéro de séquence croissant)', () => {
    const { doc, cuisine, lumiere } = fixture();
    const store = new Store(doc);
    focusDevice(store, cuisine.id);
    const first = store.state.boardFocus!.seq;
    focusDevice(store, lumiere.id);
    expect(store.state.boardFocus!.seq).toBeGreaterThan(first);
  });

  it('ouvrir un tableau réinitialise la recherche', () => {
    const { doc, board } = fixture();
    const store = new Store(doc);
    store.state.boardFilter = 'cuisine';
    openBoard(store, board.id);
    expect(store.state.boardFilter).toBe('');
    expect(store.state.mode).toBe('board');
  });

  it('« raccorder depuis le plan » active le circuit et l’outil Affecter', () => {
    const { doc, cuisine } = fixture();
    const store = new Store(doc);
    store.state.mode = 'board';
    startAssigning(store, cuisine.id);
    expect(store.state).toMatchObject({ mode: 'plan', tool: 'assign', activeCircuit: cuisine.id });
  });

  it('« voir un élément » le sélectionne sur le plan', () => {
    const { doc } = fixture([sym(7, 'prise', 5, 5)]);
    const store = new Store(doc);
    store.state.mode = 'board';
    showItemOnPlan(store, 7);
    expect(store.state).toMatchObject({ mode: 'plan', selection: 7 });
    expect(store.state.planFocus).toMatchObject({ itemId: 7 });
  });

  it('un circuit actif devenu inexistant (annulation) est oublié', () => {
    const { doc, cuisine } = fixture();
    const store = new Store(doc);
    store.commit();
    removeDevice(store, cuisine.id);
    store.state.activeCircuit = null;
    store.undo(); // le disjoncteur revient
    store.state.activeCircuit = cuisine.id;
    store.redo(); // il disparaît à nouveau
    expect(store.state.activeCircuit).toBeNull();
  });
});

// ------------------------------------------------------------------ recherche et contrôles

describe('recherche de circuits (gros tableaux)', () => {
  it('trouve par nom, pièce desservie ou appareil, sans accents ni majuscules', () => {
    const { doc, board, cuisine, lumiere } = fixture();
    doc.items = [
      room(1, 0, 0, 200, 200, 'Salle à manger', 'sejour'),
      sym(2, 'prise', 50, 50, cuisine.id, 'Four'),
      sym(3, 'lampe', 60, 60, lumiere.id),
    ];
    expect(matchingDevices(doc, board, '')).toBeNull();
    expect([...matchingDevices(doc, board, 'CUISINE')!]).toEqual([cuisine.id]);
    expect([...matchingDevices(doc, board, 'salle manger')!].sort()).toEqual([cuisine.id, lumiere.id].sort());
    expect([...matchingDevices(doc, board, 'four')!]).toEqual([cuisine.id]);
    expect([...matchingDevices(doc, board, 'éclairage')!]).toEqual([lumiere.id]);
    expect(matchingDevices(doc, board, 'introuvable')!.size).toBe(0);
  });
});

describe('contrôles croisés plan / tableau', () => {
  const withSockets = (count: number, section: number | null) => {
    const f = fixture();
    f.cuisine.section = section;
    f.doc.items = Array.from({ length: count }, (_, i) => sym(i + 1, 'prise', i * 10, 0, f.cuisine.id));
    return f;
  };

  it('signale trop de prises sur un circuit 2,5 mm²', () => {
    const f = withSockets(9, 2.5);
    const checks = runLinkChecks(f.doc, f.board);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ severity: 'warn', deviceId: f.cuisine.id });
    expect(checks[0]!.message).toMatch(/9 prises raccordées, 8 conseillées/);
  });

  it('ne signale rien dans la limite', () => {
    const f = withSockets(8, 2.5);
    expect(runLinkChecks(f.doc, f.board)).toEqual([]);
  });

  it('applique la limite de la section réellement retenue (1,5 mm² → 5 prises)', () => {
    const f = withSockets(6, 1.5);
    expect(runLinkChecks(f.doc, f.board)[0]!.message).toMatch(/5 conseillées/);
  });

  it('le plan signale ce qui n’est raccordé à rien — seulement s’il existe un tableau', () => {
    const { doc } = fixture([room(1, 0, 0, 100, 100, 'Salon', 'sejour'), sym(2, 'prise', 5, 5), wire(3, null)]);
    expect(runPlanChecks(doc).some((c) => c.message.includes('non raccordé'))).toBe(true);
    expect(runPlanChecks({ ...doc, boards: [] }).some((c) => c.message.includes('non raccordé'))).toBe(false);
  });
});

// ------------------------------------------------------------------ exemple et exports

describe('exemple relié', () => {
  it('crée un tableau et relie câbles, appareils et symbole du tableau', () => {
    const store = new Store(createDoc());
    expect(loadExamplePlan(store)).toBe(true);
    const { doc } = store.state;

    expect(doc.boards).toHaveLength(1);
    const tableau = doc.items.find((i): i is SymbolItem => i.type === 'symbol' && i.kind === 'tableau');
    expect(tableau?.board).toBe(doc.boards[0]!.id);
    expect(store.state.boardId).toBe(doc.boards[0]!.id);

    const u = unlinkedItems(doc);
    // Seuls le détecteur de fumée n'a pas de circuit dédié dans l'exemple.
    expect(u.wires).toHaveLength(0);
    expect(u.symbols.every((s) => s.kind === 'fumee')).toBe(true);

    const cuisine = circuitOptions(doc).find((o) => o.label === 'Prises cuisine')!;
    expect(allLinks(doc).get(cuisine.id)?.sockets).toBe(6);
    const plaque = circuitOptions(doc).find((o) => o.label === 'Plaque de cuisson')!;
    expect(allLinks(doc).get(plaque.id)?.wires).toHaveLength(1);
  });

  it('ne duplique pas le tableau s’il en existe déjà un', () => {
    const doc = createDoc();
    doc.boards.push(buildBoard('logement', 'Existant', () => doc.nextId++));
    const store = new Store(doc);
    loadExamplePlan(store);
    expect(store.state.doc.boards).toHaveLength(1);
  });
});

describe('exports avec raccordements', () => {
  it('la fiche du tableau indique ce qui est raccordé au plan', () => {
    const store = new Store(createDoc('Maison'));
    loadExamplePlan(store);
    const { doc } = store.state;
    const svg = buildBoardSheetSvg(doc, doc.boards[0]!, new Date('2026-01-01'));
    expect(svg).toContain('Raccordé au plan');
    expect(svg).toMatch(/6 prises/);
  });

  it('la fiche du plan liste les circuits et les pièces desservies', () => {
    const store = new Store(createDoc('Maison'));
    loadExamplePlan(store);
    const svg = buildExportSvg(store.state.doc, new Date('2026-01-01'));
    expect(svg).toContain('Circuits raccordés au plan');
    expect(svg).toContain('Cuisine (');
  });

  it('un plan sans raccordement n’a pas de section circuits', () => {
    expect(buildExportSvg({ ...createDoc('Vide'), items: [sym(1, 'prise', 0, 0)] })).not.toContain('Circuits raccordés au plan');
  });
});
