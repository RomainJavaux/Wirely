import { describe, expect, it } from 'vitest';
import { addItem, loadExamplePlan } from '../src/core/actions';
import {
  addRoomQuick,
  alignToWalls,
  connectUnlinked,
  equipAll,
  equipRoom,
  generateBoard,
} from '../src/core/planActions';
import { Store } from '../src/core/store';
import { createDoc } from '../src/domain/document';
import { allLinks, unlinkedItems } from '../src/domain/link/links';
import { planNeeds } from '../src/domain/plan/needs';
import { runPlanChecks } from '../src/domain/plan/checks';
import type { Item, Room, SymbolItem } from '../src/domain/types';
import { faceOfSymbol } from '../src/domain/walls/faces';

const room = (id: number, kind: Room['kind'], x: number, y: number, w: number, h: number): Room => ({
  id, type: 'room', x, y, w, h, label: '', kind, parts: [],
});
const sym = (id: number, kind: string, x: number, y: number, label = ''): SymbolItem => ({
  id, type: 'symbol', kind, x, y, rot: 0, label, breaker: null, board: null, height: null,
});

const storeOf = (items: Item[]): Store => {
  const doc = createDoc('T');
  doc.items = items;
  doc.nextId = 1000;
  return new Store(doc);
};

describe('ajouter une pièce par ses dimensions', () => {
  it('pose la première pièce à l’origine, aux dimensions demandées', () => {
    const store = new Store(createDoc('T'));
    const id = addRoomQuick(store, { kind: 'cuisine', name: 'Cuisine', widthM: 4, depthM: 3 });
    const r = store.getItem(id)!;
    expect(r).toMatchObject({ type: 'room', kind: 'cuisine', x: 0, y: 0, w: 160, h: 120, label: '' });
    expect(store.state.selection).toBe(id);
  });

  it('colle les pièces suivantes sans les recouvrir', () => {
    const store = new Store(createDoc('T'));
    const a = addRoomQuick(store, { kind: 'sejour', name: 'Salon', widthM: 5, depthM: 4 })!;
    const b = addRoomQuick(store, { kind: 'chambre', name: 'Chambre 1', widthM: 3, depthM: 3, nearId: a })!;
    const ra = store.getItem(a) as Room;
    const rb = store.getItem(b) as Room;
    expect(rb.x).toBe(ra.x + ra.w); // à droite
    expect(rb.y).toBe(ra.y);
    expect(rb.label).toBe('Chambre 1');
    const c = addRoomQuick(store, { kind: 'sdb', name: 'Salle de bains', widthM: 2, depthM: 2, nearId: a })!;
    const rc = store.getItem(c) as Room;
    // la droite de la première est prise : la suivante se glisse en dessous
    expect(rc.x).toBe(ra.x);
    expect(rc.y).toBe(ra.y + ra.h);
  });

  it('refuse des dimensions invalides', () => {
    const store = new Store(createDoc('T'));
    expect(addRoomQuick(store, { kind: 'autre', name: '', widthM: 0, depthM: 3 })).toBeNull();
    expect(addRoomQuick(store, { kind: 'autre', name: '', widthM: Number.NaN, depthM: 3 })).toBeNull();
    expect(store.state.doc.items).toHaveLength(0);
  });

  it('une seule étape d’historique', () => {
    const store = new Store(createDoc('T'));
    addRoomQuick(store, { kind: 'chambre', name: '', widthM: 3, depthM: 3 });
    store.undo();
    expect(store.state.doc.items).toHaveLength(0);
  });
});

describe('équiper', () => {
  it('une pièce : tout ce qui manque, en une étape annulable', () => {
    const store = storeOf([room(1, 'chambre', 0, 0, 160, 140), sym(5, 'porte', 40, 140)]);
    const n = equipRoom(store, 1);
    expect(n).toBeGreaterThanOrEqual(3 + 1 + 1);
    expect(planNeeds(store.state.doc)[0]!.complete).toBe(true);
    expect(store.state.notice?.text).toContain('Ajouté');
    store.undo();
    expect(store.state.doc.items).toHaveLength(2);
  });

  it('ne fait rien (et le dit) quand la pièce est déjà équipée', () => {
    const store = storeOf([room(1, 'chambre', 0, 0, 160, 140), sym(5, 'porte', 40, 140)]);
    equipRoom(store, 1);
    const count = store.state.doc.items.length;
    expect(equipRoom(store, 1)).toBe(0);
    expect(store.state.doc.items).toHaveLength(count);
    expect(store.state.notice?.text).toContain('déjà');
  });

  it('toute la maison : appareils sur les murs, fumée et tableau', () => {
    const store = storeOf([room(1, 'sejour', 0, 0, 240, 180), room(2, 'entree', 0, 180, 120, 100), sym(5, 'porte', 60, 280)]);
    equipAll(store);
    const { doc } = store.state;
    const symbols = doc.items.filter((i): i is SymbolItem => i.type === 'symbol');
    expect(symbols.some((s) => s.kind === 'tableau')).toBe(true);
    expect(symbols.some((s) => s.kind === 'fumee')).toBe(true);
    // tous les appareils de mur sont sur un mur
    for (const s of symbols) {
      if (['lampe', 'fumee', 'porte'].includes(s.kind)) continue;
      expect(faceOfSymbol(doc, s), s.kind).not.toBeNull();
    }
    expect(runPlanChecks(doc).filter((c) => c.severity === 'warn')).toEqual([]);
  });
});

describe('générer le tableau depuis le plan', () => {
  const equipped = (): Store => {
    const store = storeOf([
      room(1, 'sejour', 0, 0, 240, 180),
      room(2, 'cuisine', 240, 0, 140, 180),
      room(3, 'chambre', 0, 180, 160, 140),
      room(4, 'entree', 160, 180, 100, 140),
      sym(90, 'porte', 200, 320),
    ]);
    equipAll(store);
    return store;
  };

  it('crée un tableau et raccorde tous les appareils alimentés', () => {
    const store = equipped();
    const report = generateBoard(store)!;
    const { doc } = store.state;
    expect(report.circuits).toBeGreaterThanOrEqual(5);
    expect(doc.boards).toHaveLength(1);
    expect(store.state.boardId).toBe(doc.boards[0]!.id);

    const u = unlinkedItems(doc);
    expect(u.symbols).toEqual([]);
    // chaque circuit du tableau dessert au moins un appareil
    const links = allLinks(doc);
    const circuits = doc.boards[0]!.devices.filter((d) => d.kind === 'disj');
    expect(circuits.every((d) => (links.get(d.id)?.symbols.length ?? 0) > 0)).toBe(true);
  });

  it('lie le symbole du tableau et nomme l’emplacement', () => {
    const store = equipped();
    generateBoard(store);
    const t = store.state.doc.items.find((i) => i.type === 'symbol' && i.kind === 'tableau') as SymbolItem;
    expect(t.board).toBe(store.state.doc.boards[0]!.id);
    expect(store.state.doc.boards[0]!.location).not.toBe('');
  });

  it('une seule étape d’historique, et rien à générer sans appareils', () => {
    const store = equipped();
    generateBoard(store);
    store.undo();
    expect(store.state.doc.boards).toHaveLength(0);
    expect(unlinkedItems(store.state.doc).symbols.length).toBeGreaterThan(0);

    const empty = storeOf([room(1, 'sejour', 0, 0, 100, 100)]);
    expect(generateBoard(empty)).toBeNull();
    expect(empty.state.doc.boards).toHaveLength(0);
  });
});

describe('raccorder ce qui reste', () => {
  it('range un nouvel appareil dans le circuit de sa pièce, sinon crée un circuit', () => {
    const store = storeOf([room(1, 'sejour', 0, 0, 240, 180), room(2, 'cuisine', 240, 0, 140, 180), sym(90, 'porte', 120, 180)]);
    equipAll(store);
    generateBoard(store);
    const { doc } = store.state;
    const kitchenCircuit = (allLinks(doc).get(
      (doc.items.find((i) => i.type === 'symbol' && i.kind === 'prise' && i.x > 240) as SymbolItem).breaker!,
    ))!;

    // nouvelle prise dessinée dans la cuisine : raccordée automatiquement (circuit de la cuisine)
    const before = kitchenCircuit.symbols.length;
    const id = addItem(store, { type: 'symbol', kind: 'prise', x: 300, y: 100, rot: 0, label: '', breaker: null, board: null, height: null });
    const added = store.getItem(id) as SymbolItem;
    expect(added.breaker).not.toBeNull();
    expect(allLinks(store.state.doc).get(added.breaker!)!.symbols.length).toBe(before + 1);

    // un radiateur n'a pas de circuit : il en crée un
    const rad = addItem(store, { type: 'symbol', kind: 'radia', x: 20, y: 90, rot: 0, label: '', breaker: null, board: null, height: null });
    expect((store.getItem(rad) as SymbolItem).breaker).toBeNull();
    const report = connectUnlinked(store);
    expect(report.created).toBe(1);
    expect((store.getItem(rad) as SymbolItem).breaker).not.toBeNull();
    expect(unlinkedItems(store.state.doc).symbols).toEqual([]);
  });

  it('sans tableau, raccorder génère le tableau', () => {
    const store = storeOf([room(1, 'sejour', 0, 0, 240, 180), sym(90, 'porte', 120, 180)]);
    equipAll(store);
    const report = connectUnlinked(store);
    expect(report.created).toBeGreaterThan(0);
    expect(store.state.doc.boards).toHaveLength(1);
  });
});

describe('recaler sur les murs', () => {
  it('ramène les appareils proches d’un mur sur ce mur', () => {
    const store = storeOf([room(1, 'sejour', 0, 0, 200, 100), sym(2, 'prise', 20, 40), sym(3, 'prise', 100, 5)]);
    const moved = alignToWalls(store);
    expect(moved).toBe(1); // la seconde est déjà sur le mur nord
    const first = store.getItem(2) as SymbolItem;
    expect(first.x).toBe(5); // plaquée contre le mur ouest
    expect(first.rot).toBe(90);
    expect(faceOfSymbol(store.state.doc, first)?.face.key).toBe('W0');
  });

  it('l’exemple se charge avec ses appareils sur les murs', () => {
    const store = new Store(createDoc('T'));
    expect(loadExamplePlan(store)).toBe(true);
    const { doc } = store.state;
    const wallMounted = doc.items.filter(
      (i): i is SymbolItem => i.type === 'symbol' && ['prise', 'inter', 'prise_s'].includes(i.kind),
    );
    const onWall = wallMounted.filter((s) => faceOfSymbol(doc, s) !== null);
    expect(onWall.length / wallMounted.length).toBeGreaterThan(0.9);
  });
});
