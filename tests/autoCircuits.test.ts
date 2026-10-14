import { describe, expect, it } from 'vitest';
import { analyze } from '../src/domain/board/layout';
import { runChecks } from '../src/domain/board/checks';
import { createDoc } from '../src/domain/document';
import { buildBoardFromPlan, planCircuits, suggestCircuit } from '../src/domain/link/autoCircuits';
import { estimateCables, estimateRoute } from '../src/domain/link/route';
import type { Doc, Item, Room, RoomKind, SymbolItem } from '../src/domain/types';

const room = (id: number, kind: RoomKind, x: number, y: number, w: number, h: number, label = ''): Room => ({
  id, type: 'room', x, y, w, h, label, kind, parts: [],
});
const sym = (id: number, kind: string, x: number, y: number, label = '', breaker: number | null = null): SymbolItem => ({
  id, type: 'symbol', kind, x, y, rot: 0, label, breaker, board: null, height: null,
});
const docOf = (items: Item[]): Doc => ({ ...createDoc('T'), items });

/** Appartement minimal : séjour, cuisine, chambre. */
function flat(): Item[] {
  return [
    room(1, 'sejour', 0, 0, 240, 180),
    room(2, 'cuisine', 240, 0, 140, 180),
    room(3, 'chambre', 0, 180, 160, 140),
    // séjour
    sym(10, 'lampe', 100, 90), sym(11, 'inter', 230, 160),
    sym(12, 'prise', 20, 40), sym(13, 'prise', 20, 140), sym(14, 'prise', 200, 170), sym(15, 'rj45', 20, 90),
    // cuisine
    sym(20, 'lampe', 310, 90), sym(21, 'inter', 250, 160),
    sym(22, 'prise', 255, 70), sym(23, 'prise', 290, 170), sym(24, 'prise', 330, 170),
    sym(25, 'prise_s', 370, 160, 'Plaque de cuisson'), sym(26, 'prise_s', 370, 100, 'Lave-linge'),
    // chambre
    sym(30, 'lampe', 80, 250), sym(31, 'inter', 150, 190),
    sym(32, 'prise', 20, 200), sym(33, 'prise', 140, 300),
    sym(40, 'tableau', 100, 315),
  ];
}

describe('circuits déduits du plan', () => {
  it('regroupe par usage et par zone, un circuit par appareil spécialisé', () => {
    const plans = planCircuits(docOf(flat()));
    const byLabel = new Map(plans.map((p) => [p.label, p]));

    // Éclairage : 3 points, un seul circuit 10 A qui porte aussi les commandes.
    const light = byLabel.get('Éclairage')!;
    expect(light).toMatchObject({ usage: 'eclairage', rating: 10, group: 'eclairage' });
    expect(light.itemIds.sort()).toEqual([10, 11, 20, 21, 30, 31]);

    // Prises : la cuisine a son propre circuit.
    const kitchen = plans.find((p) => p.usage === 'prises' && p.rooms[0] === 'Cuisine')!;
    expect(kitchen.itemIds.sort()).toEqual([22, 23, 24]);

    // Spécialisées : plaque en 32 A, lave-linge en 20 A.
    expect(byLabel.get('Plaque de cuisson')).toMatchObject({ rating: 32, usage: 'special', group: 'special' });
    expect(byLabel.get('Lave-linge')).toMatchObject({ rating: 20, usage: 'special' });
  });

  it('ne raccorde ni le réseau, ni la télé, ni le tableau, ni les ouvertures', () => {
    const plans = planCircuits(docOf([...flat(), sym(50, 'porte', 0, 60), sym(51, 'tv', 20, 120)]));
    const ids = new Set(plans.flatMap((p) => p.itemIds));
    for (const id of [15, 40, 50, 51]) expect(ids.has(id), String(id)).toBe(false);
  });

  it('un circuit de prises ne dépasse pas 8 prises, et passe en 20 A au-delà de 5', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 400, 400)];
    for (let i = 0; i < 11; i++) items.push(sym(10 + i, 'prise', 20 + i * 10, 20));
    const plans = planCircuits(docOf(items)).filter((p) => p.usage === 'prises');
    expect(plans.map((p) => p.itemIds.length)).toEqual([8, 3]);
    expect(plans[0]!.rating).toBe(20);
    expect(plans[1]!.rating).toBe(16);
  });

  it('sépare l’éclairage jour et nuit au-delà de 8 points', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 200, 200), room(2, 'chambre', 200, 0, 200, 200)];
    for (let i = 0; i < 5; i++) items.push(sym(10 + i, 'lampe', 20 + i * 10, 50));
    for (let i = 0; i < 5; i++) items.push(sym(30 + i, 'lampe', 220 + i * 10, 50));
    const labels = planCircuits(docOf(items)).map((p) => p.label);
    expect(labels).toEqual(['Éclairage jour', 'Éclairage nuit']);
  });

  it('ne reprend que ce qui n’est pas encore raccordé', () => {
    const items = flat().map((i) => (i.id === 12 ? { ...i, breaker: 999 } : i)) as Item[];
    const ids = new Set(planCircuits(docOf(items)).flatMap((p) => p.itemIds));
    expect(ids.has(12)).toBe(false);
    const all = new Set(planCircuits(docOf(items), { onlyUnlinked: false }).flatMap((p) => p.itemIds));
    expect(all.has(12)).toBe(true);
  });
});

describe('tableau généré', () => {
  const build = () => {
    let id = 1000;
    return buildBoardFromPlan(planCircuits(docOf(flat())), 'Tableau principal', () => id++)!;
  };

  it('un petit logement : deux différentiels, spécialisés en type A et le reste en AC', () => {
    const { board, circuits } = build();
    const rcds = board.devices.filter((d) => d.kind === 'idiff');
    expect(rcds).toHaveLength(2);
    expect(rcds[0]).toMatchObject({ diffType: 'A', sensitivity: 30, row: 0 });
    expect(rcds[1]).toMatchObject({ diffType: 'AC', sensitivity: 30, row: 1 });
    expect(circuits.length).toBe(board.devices.filter((d) => d.kind === 'disj').length);
  });

  it('un grand logement : l’éclairage est séparé des prises, 8 circuits au plus par différentiel', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 400, 400), room(2, 'chambre', 400, 0, 400, 400), room(3, 'cuisine', 0, 400, 400, 400)];
    let id = 10;
    for (let i = 0; i < 12; i++) items.push(sym(id++, 'lampe', 20 + i * 10, 20 + (i % 2) * 400));
    for (let i = 0; i < 56; i++) items.push(sym(id++, 'prise', 10 + ((i * 7) % 380), 100));
    for (let i = 0; i < 4; i++) items.push(sym(id++, 'prise_s', 30 + i * 15, 300, ['Four', 'Lave-linge', 'Lave-vaisselle', 'Plaque de cuisson'][i]));
    let next = 1000;
    const gen = buildBoardFromPlan(planCircuits(docOf(items)), 'T', () => next++)!;
    const a = analyze(gen.board);
    expect(a.groups.length).toBeGreaterThanOrEqual(3);
    for (const g of a.groups) {
      const n = g.members.filter((m) => m.kind === 'disj').length;
      expect(n).toBeLessThanOrEqual(8);
      // un rail porte soit l'éclairage, soit les prises (jamais les deux)
      const usages = new Set(g.members.map((m) => m.usage));
      expect(usages.has('eclairage') && usages.has('prises')).toBe(false);
    }
  });

  it('chaque circuit est derrière un différentiel, sans alerte bloquante', () => {
    const { board } = build();
    const a = analyze(board);
    expect(a.circuits.every((c) => a.protectedBy.get(c.id) !== null)).toBe(true);
    expect(runChecks(board).filter((c) => c.severity === 'error')).toEqual([]);
    expect(runChecks(board).filter((c) => c.message.includes('aucun différentiel'))).toEqual([]);
  });

  it('garde 20 % de réserve et ne dépasse pas les rails', () => {
    const { board } = build();
    const a = analyze(board);
    expect(a.totalModules - a.usedModules).toBeGreaterThanOrEqual(a.totalModules * 0.2);
    for (const d of board.devices) expect(d.col + 1).toBeLessThanOrEqual(board.cols);
  });

  it('retourne null sans rien à raccorder', () => {
    expect(buildBoardFromPlan([], 'T', () => 1)).toBeNull();
  });
});

describe('suggestion de circuit', () => {
  /** Plan déjà raccordé à un tableau généré. */
  function linked(): Doc {
    let id = 1000;
    const doc = docOf(flat());
    const gen = buildBoardFromPlan(planCircuits(doc), 'Tableau', () => id++)!;
    for (const { plan, device } of gen.circuits) {
      doc.items = doc.items.map((i) => (i.type === 'symbol' && plan.itemIds.includes(i.id) ? { ...i, breaker: device.id } : i));
    }
    doc.boards = [gen.board];
    doc.nextId = id;
    return doc;
  }

  it('propose le circuit qui dessert déjà la pièce', () => {
    const doc = linked();
    const added = sym(90, 'prise', 300, 20); // cuisine
    const s = suggestCircuit(doc, added);
    expect(s).not.toBeNull();
    const kitchenPlug = doc.items.find((i) => i.id === 22) as SymbolItem;
    expect(s!.deviceId).toBe(kitchenPlug.breaker);
  });

  it('ne propose rien pour une pièce sans circuit, ni pour un appareil qui a son circuit', () => {
    const doc = linked();
    doc.items.push(room(9, 'garage', 400, 0, 100, 100));
    expect(suggestCircuit(doc, sym(91, 'prise', 450, 50))).toBeNull();
    // le circuit « Lave-linge » est déjà utilisé
    expect(suggestCircuit(doc, sym(92, 'prise_s', 370, 20, 'Lave-linge'))).toBeNull();
  });

  it('ne propose rien sans tableau', () => {
    expect(suggestCircuit(docOf(flat()), sym(90, 'prise', 300, 20))).toBeNull();
  });
});

describe('estimation du câble', () => {
  function withBoard(): { doc: Doc; deviceId: number } {
    let id = 1000;
    const doc = docOf(flat());
    const gen = buildBoardFromPlan(planCircuits(doc), 'Tableau', () => id++)!;
    for (const { plan, device } of gen.circuits) {
      doc.items = doc.items.map((i) => (i.type === 'symbol' && plan.itemIds.includes(i.id) ? { ...i, breaker: device.id } : i));
    }
    doc.boards = [gen.board];
    const first = gen.circuits.find((c) => c.plan.label === 'Éclairage')!;
    return { doc, deviceId: first.device.id };
  }

  it('part du tableau, relie les appareils et ajoute les descentes', () => {
    const { doc, deviceId } = withBoard();
    const device = doc.boards[0]!.devices.find((d) => d.id === deviceId)!;
    const route = estimateRoute(doc, device)!;
    expect(route.count).toBe(6);
    expect(route.points[0]).toEqual([100, 315]); // le tableau
    // 6 appareils de 3 à 6 m de distance chacun : plusieurs dizaines de mètres, pas quelques centimètres.
    expect(route.length).toBeGreaterThan(10);
    expect(route.length).toBeLessThan(60);
  });

  it('un circuit sans appareil n’a pas d’estimation', () => {
    const { doc } = withBoard();
    const empty = doc.boards[0]!.devices.find((d) => d.kind === 'idiff')!;
    expect(estimateRoute(doc, empty)).toBeNull();
  });

  it('totalise par section, sans compter les circuits déjà tracés à la main', () => {
    const { doc, deviceId } = withBoard();
    const before = estimateCables(doc);
    expect(before.some((c) => c.section === 1.5)).toBe(true);
    expect(before.reduce((n, c) => n + c.circuits, 0)).toBeGreaterThanOrEqual(5);

    doc.items.push({ id: 700, type: 'wire', points: [[0, 0], [10, 0]], wtype: 'eclairage', breaker: deviceId });
    const after = estimateCables(doc);
    const sum = (list: typeof before) => list.reduce((n, c) => n + c.circuits, 0);
    expect(sum(after)).toBe(sum(before) - 1);
  });
});
