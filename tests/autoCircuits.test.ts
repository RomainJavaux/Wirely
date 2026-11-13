import { describe, expect, it } from 'vitest';
import { analyze, generalRcd } from '../src/domain/board/layout';
import { runChecks } from '../src/domain/board/checks';
import { createDoc } from '../src/domain/document';
import { appendCircuits, buildBoardFromPlan, planCircuits, suggestCircuit } from '../src/domain/link/autoCircuits';
import { runLinkChecks } from '../src/domain/link/checks';
import { estimateCables, estimateRoute } from '../src/domain/link/route';
import { RULES } from '../src/domain/rules';
import type { Country, Doc, Item, Room, RoomKind, SymbolItem } from '../src/domain/types';

const room = (id: number, kind: RoomKind, x: number, y: number, w: number, h: number, label = ''): Room => ({
  id, type: 'room', x, y, w, h, label, kind, parts: [],
});
const sym = (id: number, kind: string, x: number, y: number, label = '', breaker: number | null = null): SymbolItem => ({
  id, type: 'symbol', kind, x, y, rot: 0, label, breaker, board: null, height: null,
});
const docOf = (items: Item[], country: Country = 'FR'): Doc => ({ ...createDoc('T', country), items });

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

/** Le même logement avec une salle de bains (pour les règles belges). */
function flatWithBathroom(): Item[] {
  return [
    ...flat(),
    room(4, 'sdb', 160, 180, 100, 140),
    sym(50, 'lampe', 210, 250), sym(51, 'inter', 170, 190), sym(52, 'prise', 250, 300), sym(53, 'prise2', 170, 300),
    sym(54, 'prise_s', 370, 40, 'Lave-vaisselle'),
  ];
}

describe('France : circuits déduits des points', () => {
  it('regroupe par usage et par zone, un circuit par appareil spécialisé', () => {
    const plans = planCircuits(docOf(flat()));
    const byLabel = new Map(plans.map((p) => [p.label, p]));

    // Éclairage : trois locaux éclairés, donc deux circuits 10 A (jour et nuit), commandes comprises.
    const day = byLabel.get('Éclairage jour')!;
    expect(day).toMatchObject({ usage: 'eclairage', rating: 10, section: 1.5, group: 'eclairage' });
    expect(day.itemIds.sort()).toEqual([10, 11, 20, 21]);
    expect(byLabel.get('Éclairage nuit')!.itemIds.sort()).toEqual([30, 31]);

    // Prises : la cuisine a son propre circuit, en 20 A / 2,5 mm².
    const kitchen = plans.find((p) => p.usage === 'prises' && p.rooms[0] === 'Cuisine')!;
    expect(kitchen.itemIds.sort()).toEqual([22, 23, 24]);
    expect(kitchen).toMatchObject({ rating: 20, section: 2.5 });

    // Spécialisées : plaque en 32 A / 6 mm², lave-linge en 20 A ; toutes deux derrière un type A.
    expect(byLabel.get('Plaque de cuisson')).toMatchObject({ rating: 32, section: 6, usage: 'special', typeA: true });
    expect(byLabel.get('Lave-linge')).toMatchObject({ rating: 20, section: 2.5, typeA: true });
    expect(plans.every((p) => !p.wet)).toBe(true);
  });

  it('ne raccorde ni le réseau, ni la télé, ni le tableau, ni les ouvertures', () => {
    const plans = planCircuits(docOf([...flat(), sym(60, 'porte', 0, 60), sym(61, 'tv', 20, 120)]));
    const ids = new Set(plans.flatMap((p) => p.itemIds));
    for (const id of [15, 40, 60, 61]) expect(ids.has(id), String(id)).toBe(false);
  });

  it('8 prises au plus par circuit en 16 A / 1,5 mm² hors cuisine', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 400, 400)];
    for (let i = 0; i < 11; i++) items.push(sym(10 + i, 'prise', 20 + i * 10, 20));
    const plans = planCircuits(docOf(items)).filter((p) => p.usage === 'prises');
    expect(plans.map((p) => p.itemIds.length)).toEqual([8, 3]);
    expect(plans.map((p) => [p.rating, p.section])).toEqual([[16, 1.5], [16, 1.5]]);
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

describe('France : tableau généré', () => {
  const build = () => {
    let id = 1000;
    return buildBoardFromPlan(planCircuits(docOf(flat())), 'Tableau principal', () => id++, RULES.FR)!;
  };

  it('un petit logement : deux différentiels 30 mA, spécialisés en type A et le reste en AC', () => {
    const { board, circuits } = build();
    const rcds = board.devices.filter((d) => d.kind === 'idiff');
    expect(rcds).toHaveLength(2);
    expect(rcds[0]).toMatchObject({ diffType: 'A', sensitivity: 30, row: 0 });
    expect(rcds[1]).toMatchObject({ diffType: 'AC', sensitivity: 30, row: 1 });
    expect(circuits.length).toBe(board.devices.filter((d) => d.kind === 'disj').length);
    expect(board.devices.filter((d) => d.kind === 'disj').every((d) => d.variant === '1P+N')).toBe(true);
  });

  it('un grand logement : l’éclairage est séparé des prises, 8 circuits au plus par différentiel', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 400, 400), room(2, 'chambre', 400, 0, 400, 400), room(3, 'cuisine', 0, 400, 400, 400)];
    let id = 10;
    for (let i = 0; i < 12; i++) items.push(sym(id++, 'lampe', 20 + i * 10, 20 + (i % 2) * 400));
    for (let i = 0; i < 56; i++) items.push(sym(id++, 'prise', 10 + ((i * 7) % 380), 100));
    for (let i = 0; i < 4; i++) items.push(sym(id++, 'prise_s', 30 + i * 15, 300, ['Four', 'Lave-linge', 'Lave-vaisselle', 'Plaque de cuisson'][i]));
    let next = 1000;
    const gen = buildBoardFromPlan(planCircuits(docOf(items)), 'T', () => next++, RULES.FR)!;
    const a = analyze(gen.board);
    expect(a.groups.length).toBeGreaterThanOrEqual(3);
    for (const g of a.groups) {
      expect(g.members.filter((m) => m.kind === 'disj').length).toBeLessThanOrEqual(8);
      const usages = new Set(g.members.map((m) => m.usage));
      expect(usages.has('eclairage') && usages.has('prises')).toBe(false);
    }
  });

  it('chaque circuit est derrière un différentiel, sans alerte bloquante', () => {
    const { board } = build();
    const a = analyze(board);
    expect(a.circuits.every((c) => a.protectedBy.get(c.id) !== null)).toBe(true);
    expect(runChecks(board, RULES.FR).filter((c) => c.severity === 'error')).toEqual([]);
    expect(runChecks(board, RULES.FR).filter((c) => c.message.includes('aucun différentiel'))).toEqual([]);
  });

  it('retourne null sans rien à raccorder', () => {
    expect(buildBoardFromPlan([], 'T', () => 1, RULES.FR)).toBeNull();
  });
});

describe('Belgique : circuits et tableau selon le RGIE', () => {
  const be = () => docOf(flatWithBathroom(), 'BE');

  it('8 points au plus par circuit de prises, toujours en 20 A / 2,5 mm²', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 400, 400)];
    for (let i = 0; i < 11; i++) items.push(sym(10 + i, i % 2 ? 'prise2' : 'prise', 20 + i * 10, 20));
    const plans = planCircuits(docOf(items, 'BE')).filter((p) => p.usage === 'prises');
    expect(plans.map((p) => p.itemIds.length)).toEqual([8, 3]); // une prise double compte pour un point
    expect(plans.every((p) => p.rating === 20 && p.section === 2.5)).toBe(true);
  });

  it('au moins deux circuits d’éclairage dès que plus de deux locaux sont éclairés', () => {
    const plans = planCircuits(be()).filter((p) => p.usage === 'eclairage' && !p.wet);
    expect(plans.length).toBeGreaterThanOrEqual(2);
    expect(plans.every((p) => p.rating === 16 && p.section === 1.5)).toBe(true);
  });

  it('la salle de bains et les appareils humides passent derrière le 30 mA', () => {
    const plans = planCircuits(be());
    const bath = plans.find((p) => p.label === 'Salle de bains')!;
    expect(bath).toMatchObject({ wet: true, rating: 20, section: 2.5 });
    expect(bath.itemIds.sort()).toEqual([50, 51, 52, 53]); // circuit mixte : lumière, commande et prises
    expect(plans.find((p) => p.label === 'Lave-linge')).toMatchObject({ wet: true });
    expect(plans.find((p) => p.label === 'Lave-vaisselle')).toMatchObject({ wet: true });
    expect(plans.find((p) => p.label === 'Plaque de cuisson')).toMatchObject({ wet: false, rating: 32, section: 6 });
  });

  it('le tableau a un différentiel général 300 mA type A, puis un 30 mA pour l’humide', () => {
    let id = 1000;
    const doc = be();
    const gen = buildBoardFromPlan(planCircuits(doc), 'Tableau', () => id++, RULES.BE)!;
    const a = analyze(gen.board, 'letters');
    expect(a.groups).toHaveLength(2);
    expect(a.groups[0]!.head).toMatchObject({ sensitivity: 300, diffType: 'A', rating: 40 });
    expect(a.groups[1]!.head).toMatchObject({ sensitivity: 30, diffType: 'A' });
    expect(generalRcd(gen.board)?.id).toBe(a.groups[0]!.head!.id);
    // Disjoncteurs bipolaires, repérés par des lettres.
    expect(a.circuits.every((d) => d.variant === '2P')).toBe(true);
    expect(a.refs.get(a.circuits[0]!.id)).toBe('A');
    // Les circuits humides sont tous derrière le 30 mA.
    const wetIds = new Set(gen.circuits.filter((c) => c.plan.wet).map((c) => c.device.id));
    expect(a.groups[1]!.members.map((m) => m.id).sort()).toEqual([...wetIds].sort());
    // Rien ne dépasse des rails, même avec des disjoncteurs de deux modules.
    for (const d of gen.board.devices) expect(d.col + (d.kind === 'idiff' || d.kind === 'disj' ? 2 : 1)).toBeLessThanOrEqual(gen.board.cols);
  });

  it('le tableau généré ne lève aucune remarque RGIE', () => {
    let id = 1000;
    const doc = be();
    const gen = buildBoardFromPlan(planCircuits(doc), 'Tableau', () => id++, RULES.BE)!;
    for (const { plan, device } of gen.circuits) {
      doc.items = doc.items.map((i) => (i.type === 'symbol' && plan.itemIds.includes(i.id) ? { ...i, breaker: device.id } : i));
    }
    doc.boards = [gen.board];
    expect(runChecks(gen.board, RULES.BE).filter((c) => c.severity !== 'info')).toEqual([]);
    expect(runLinkChecks(doc, gen.board)).toEqual([]);
  });

  it('un circuit ajouté après coup va derrière le bon différentiel', () => {
    let id = 1000;
    const doc = be();
    const gen = buildBoardFromPlan(planCircuits(doc), 'Tableau', () => id++, RULES.BE)!;
    const extra = planCircuits(docOf([room(1, 'cuisine', 0, 0, 100, 100), sym(900, 'prise_s', 10, 10, 'Sèche-linge'), sym(901, 'prise_s', 30, 10, 'Four')], 'BE'));
    const res = appendCircuits(gen.board, extra, () => id++, RULES.BE);
    const a = analyze(res.board, 'letters');
    const dryer = res.circuits.find((c) => c.plan.label === 'Sèche-linge')!.device;
    const oven = res.circuits.find((c) => c.plan.label === 'Four')!.device;
    expect(a.protectedBy.get(dryer.id)?.sensitivity).toBe(30);
    expect(a.protectedBy.get(oven.id)?.sensitivity).toBe(300);
  });
});

describe('suggestion de circuit', () => {
  /** Plan déjà raccordé à un tableau généré. */
  function linked(): Doc {
    let id = 1000;
    const doc = docOf(flat());
    const gen = buildBoardFromPlan(planCircuits(doc), 'Tableau', () => id++, RULES.FR)!;
    for (const { plan, device } of gen.circuits) {
      doc.items = doc.items.map((i) => (i.type === 'symbol' && plan.itemIds.includes(i.id) ? { ...i, breaker: device.id } : i));
    }
    doc.boards = [gen.board];
    doc.nextId = id;
    return doc;
  }

  it('propose le circuit qui dessert déjà la pièce', () => {
    const doc = linked();
    const s = suggestCircuit(doc, sym(90, 'prise', 300, 20)); // cuisine
    expect(s).not.toBeNull();
    const kitchenPlug = doc.items.find((i) => i.id === 22) as SymbolItem;
    expect(s!.deviceId).toBe(kitchenPlug.breaker);
  });

  it('ne propose rien pour une pièce sans circuit, ni pour un appareil qui a son circuit', () => {
    const doc = linked();
    doc.items.push(room(9, 'garage', 400, 0, 100, 100));
    expect(suggestCircuit(doc, sym(91, 'prise', 450, 50))).toBeNull();
    expect(suggestCircuit(doc, sym(92, 'prise_s', 370, 20, 'Lave-linge'))).toBeNull(); // circuit déjà utilisé
  });

  it('ne propose pas un circuit plein', () => {
    const doc = linked();
    const kitchen = (doc.items.find((i) => i.id === 22) as SymbolItem).breaker!;
    for (let i = 0; i < 9; i++) doc.items.push(sym(200 + i, 'prise', 260 + i * 10, 30, '', kitchen)); // 12 prises
    expect(suggestCircuit(doc, sym(90, 'prise', 300, 20))).toBeNull();
  });

  it('ne propose rien sans tableau', () => {
    expect(suggestCircuit(docOf(flat()), sym(90, 'prise', 300, 20))).toBeNull();
  });
});

describe('estimation du câble', () => {
  function withBoard(): { doc: Doc; deviceId: number } {
    let id = 1000;
    const doc = docOf(flat());
    const gen = buildBoardFromPlan(planCircuits(doc), 'Tableau', () => id++, RULES.FR)!;
    for (const { plan, device } of gen.circuits) {
      doc.items = doc.items.map((i) => (i.type === 'symbol' && plan.itemIds.includes(i.id) ? { ...i, breaker: device.id } : i));
    }
    doc.boards = [gen.board];
    const first = gen.circuits.find((c) => c.plan.label === 'Éclairage jour')!;
    return { doc, deviceId: first.device.id };
  }

  it('part du tableau, relie les appareils et ajoute les descentes', () => {
    const { doc, deviceId } = withBoard();
    const device = doc.boards[0]!.devices.find((d) => d.id === deviceId)!;
    const route = estimateRoute(doc, device)!;
    expect(route.count).toBe(4);
    expect(route.points[0]).toEqual([100, 315]); // le tableau
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
