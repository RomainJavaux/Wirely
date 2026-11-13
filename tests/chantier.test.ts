import { describe, expect, it } from 'vitest';
import { addCircuit, addRcd, createStandardBoard, ensureBoard } from '../src/core/circuitActions';
import { setActiveCircuit } from '../src/core/links';
import { connectUnlinked } from '../src/core/planActions';
import {
  addPoint,
  addRoomOfKind,
  confirmPositions,
  deleteRoom,
  movePointsToCircuit,
  removePoint,
  setCountry,
} from '../src/core/pointActions';
import { Store } from '../src/core/store';
import { analyze } from '../src/domain/board/layout';
import { createDoc, parseDoc } from '../src/domain/document';
import { allPoints, pointRefs, pointTypes, roomCounts, typeOf } from '../src/domain/points';
import { buildQuote, fmtMoney } from '../src/domain/quote';
import { RULES, sectionFor } from '../src/domain/rules';
import { projectProgress, runProjectChecks } from '../src/domain/rules/checks';
import type { Room, SymbolItem } from '../src/domain/types';
import { faceOfSymbol } from '../src/domain/walls/faces';

const newStore = (country: 'BE' | 'FR' = 'BE'): Store => new Store(createDoc('Chantier', country));

describe('chantier et pays', () => {
  it('un nouveau chantier est belge par défaut, avec les usages du pays', () => {
    const doc = createDoc();
    expect(doc.project).toMatchObject({ country: 'BE', cable: 'XVB', vat: 21 });
    expect(createDoc('x', 'FR').project).toMatchObject({ country: 'FR', cable: 'R2V', vat: 20 });
  });

  it('relit les renseignements, et tolère un ancien fichier qui n’en a pas', () => {
    const old = parseDoc({ items: [] });
    expect(old.project.country).toBe('BE');
    const doc = parseDoc({
      items: [],
      project: { country: 'FR', client: 'Mme Dupont', address: '1 rue X', installer: 'Élec SRL', date: '2026-11-13', prices: { prise: 60, bad: 'x' }, vat: 6 },
    });
    expect(doc.project).toMatchObject({ country: 'FR', client: 'Mme Dupont', address: '1 rue X', date: '2026-11-13', vat: 6 });
    expect(doc.project.prices).toEqual({ prise: 60 });
  });

  it('changer de pays adapte le câble par défaut, sauf s’il a été choisi à la main', () => {
    const store = newStore('BE');
    setCountry(store, 'FR');
    expect(store.state.doc.project).toMatchObject({ country: 'FR', cable: 'R2V', vat: 20 });
    store.state.doc.project.cable = 'AR2V';
    setCountry(store, 'BE');
    expect(store.state.doc.project.cable).toBe('AR2V');
  });

  it('les sections suivent la table du pays', () => {
    expect(sectionFor(RULES.BE, 40)).toBe(6); // 6 mm² admet 40 A en Belgique
    expect(sectionFor(RULES.FR, 40)).toBe(10);
    expect(sectionFor(RULES.BE, 20)).toBe(2.5);
  });
});

describe('compter des points', () => {
  it('une pièce se crée d’un geste, numérotée, en bloc à préciser', () => {
    const store = newStore();
    const a = addRoomOfKind(store, 'chambre')!;
    const b = addRoomOfKind(store, 'chambre')!;
    const ra = store.getItem(a) as Room;
    const rb = store.getItem(b) as Room;
    expect(ra).toMatchObject({ kind: 'chambre', label: '', rough: true });
    expect(rb.label).toBe('Chambre 2');
    expect(rb.x).toBeGreaterThanOrEqual(ra.x + ra.w); // posée à côté, sans recouvrement
  });

  it('un point compté est posé sur un mur, marqué « à vérifier », sur le circuit actif', () => {
    const store = newStore();
    const room = addRoomOfKind(store, 'cuisine')!;
    const circuit = addCircuit(store, { rating: 20 })!;
    setActiveCircuit(store, circuit);

    const id = addPoint(store, room, 'prise')!;
    const p = store.getItem(id) as SymbolItem;
    expect(p).toMatchObject({ kind: 'prise', breaker: circuit, rough: true });
    expect(faceOfSymbol(store.state.doc, p)).not.toBeNull();

    const light = store.getItem(addPoint(store, room, 'lampe')!) as SymbolItem;
    expect(faceOfSymbol(store.state.doc, light)).toBeNull(); // plafond
    expect(light.breaker).toBe(circuit);
  });

  it('les points suivants ne s’empilent pas', () => {
    const store = newStore();
    const room = addRoomOfKind(store, 'sejour')!;
    const ids = Array.from({ length: 8 }, () => addPoint(store, room, 'prise')!);
    const spots = ids.map((id) => {
      const p = store.getItem(id) as SymbolItem;
      return `${p.x},${p.y}`;
    });
    expect(new Set(spots).size).toBe(8);
    const lamps = [addPoint(store, room, 'lampe')!, addPoint(store, room, 'lampe')!].map((id) => store.getItem(id) as SymbolItem);
    expect(Math.hypot(lamps[0]!.x - lamps[1]!.x, lamps[0]!.y - lamps[1]!.y)).toBeGreaterThan(20);
  });

  it('les appareils fixes sont comptés par nom, avec le vocabulaire du pays', () => {
    const store = newStore('BE');
    const room = addRoomOfKind(store, 'cuisine')!;
    addPoint(store, room, 'plaque');
    addPoint(store, room, 'four');
    addPoint(store, room, 'prise');
    addPoint(store, room, 'prise');
    const counts = roomCounts(store.state.doc, room);
    expect(counts.map((c) => [c.type.key, c.total])).toEqual([['prise', 2], ['four', 1], ['plaque', 1]]);
    expect(counts.find((c) => c.type.key === 'plaque')!.type.label).toBe('Taque de cuisson');

    // Le même appareil reste reconnu si l'on passe le chantier en France.
    setCountry(store, 'FR');
    const fr = roomCounts(store.state.doc, room).find((c) => c.type.key === 'plaque')!;
    expect(fr.total).toBe(1);
    expect(fr.type.label).toBe('Plaque de cuisson');
  });

  it('retirer un point enlève le dernier compté, de préférence sur le circuit actif', () => {
    const store = newStore();
    const room = addRoomOfKind(store, 'sejour')!;
    const a = addCircuit(store, { rating: 20 })!;
    const b = addCircuit(store, { rating: 20 })!;
    setActiveCircuit(store, a);
    const onA = addPoint(store, room, 'prise')!;
    setActiveCircuit(store, b);
    addPoint(store, room, 'prise');
    setActiveCircuit(store, a);
    expect(removePoint(store, room, 'prise')).toBe(true);
    expect(store.getItem(onA)).toBeUndefined();
    expect(roomCounts(store.state.doc, room)[0]!.total).toBe(1);
    expect(removePoint(store, room, 'lampe')).toBe(false);
  });

  it('chaque geste s’annule en une étape', () => {
    const store = newStore();
    const room = addRoomOfKind(store, 'sejour')!;
    addPoint(store, room, 'prise');
    addPoint(store, room, 'prise');
    store.undo();
    expect(allPoints(store.state.doc)).toHaveLength(1);
    deleteRoom(store, room);
    expect(store.state.doc.items).toHaveLength(0);
    store.undo();
    expect(store.state.doc.items).toHaveLength(2);
  });

  it('un symbole inconnu des compteurs (porte, tableau) n’est pas un point', () => {
    const types = pointTypes('BE');
    const door: SymbolItem = { id: 1, type: 'symbol', kind: 'porte', x: 0, y: 0, rot: 0, label: '', breaker: null, board: null, height: null };
    expect(typeOf(door, types)).toBeNull();
    expect(typeOf({ ...door, kind: 'prise_s', label: 'Aquarium' }, types)?.key).toBe('prise_s');
  });
});

describe('circuits au pouce', () => {
  it('ajoute des circuits bipolaires repérés par des lettres, à la bonne section (Belgique)', () => {
    const store = newStore('BE');
    createStandardBoard(store);
    const board = store.activeBoard!;
    expect(board.cols).toBe(18);
    const [general, wet] = analyze(board).groups.map((g) => g.head!);
    expect(general).toMatchObject({ sensitivity: 300, diffType: 'A' });
    expect(wet).toMatchObject({ sensitivity: 30 });

    const a = addCircuit(store, { rating: 20, headId: general!.id })!;
    const b = addCircuit(store, { rating: 16, headId: general!.id })!;
    const c = addCircuit(store, { rating: 20, headId: wet!.id })!;
    const an = analyze(store.activeBoard!, 'letters');
    expect([a, b, c].map((id) => an.refs.get(id))).toEqual(['A', 'B', 'C']);
    const dev = (id: number) => store.activeBoard!.devices.find((d) => d.id === id)!;
    expect(dev(a)).toMatchObject({ variant: '2P', section: 2.5, usage: 'prises' });
    expect(dev(b)).toMatchObject({ section: 1.5, usage: 'eclairage' });
    expect(an.protectedBy.get(c)?.id).toBe(wet!.id);
  });

  it('un rail plein se prolonge sur le suivant, sans casser les groupes', () => {
    const store = newStore('BE');
    createStandardBoard(store);
    const general = analyze(store.activeBoard!).groups[0]!.head!;
    const ids = Array.from({ length: 11 }, () => addCircuit(store, { rating: 20, headId: general.id })!);
    const board = store.activeBoard!;
    const a = analyze(board);
    // 18 modules : le différentiel (2) et 8 disjoncteurs bipolaires ; les trois autres passent en dessous.
    expect(ids.every((id) => a.protectedBy.get(id)?.id === general.id)).toBe(true);
    expect(a.groups[1]!.head?.sensitivity).toBe(30); // le 30 mA est resté un groupe à part, plus bas
    expect(board.rows).toBeGreaterThanOrEqual(3);
    for (const d of board.devices) expect(d.col + 2).toBeLessThanOrEqual(board.cols);
    const cells = new Set(board.devices.flatMap((d) => [`${d.row}:${d.col}`, `${d.row}:${d.col + 1}`]));
    expect(cells.size).toBe(board.devices.length * 2); // aucun chevauchement
  });

  it('sans tableau, le premier circuit en crée un ; sans différentiel, il est signalé', () => {
    const store = newStore('FR');
    const id = addCircuit(store, { rating: 16 })!;
    expect(store.state.doc.boards).toHaveLength(1);
    expect(analyze(store.activeBoard!).protectedBy.get(id)).toBeNull();
    addRcd(store, { sensitivity: 30 });
    const next = addCircuit(store, { rating: 20 })!;
    expect(analyze(store.activeBoard!).protectedBy.get(next)).not.toBeNull();
    expect(ensureBoard(store).id).toBe(store.state.doc.boards[0]!.id);
  });
});

describe('repères des points', () => {
  it('lettre du circuit et rang, dans l’ordre de saisie (Belgique)', () => {
    const store = newStore('BE');
    const room = addRoomOfKind(store, 'sejour')!;
    createStandardBoard(store);
    const a = addCircuit(store, { rating: 20 })!;
    const b = addCircuit(store, { rating: 16 })!;
    setActiveCircuit(store, a);
    const p1 = addPoint(store, room, 'prise')!;
    const p2 = addPoint(store, room, 'prise')!;
    setActiveCircuit(store, b);
    const l1 = addPoint(store, room, 'lampe')!;
    setActiveCircuit(store, null);
    const orphan = addPoint(store, room, 'prise')!;

    const refs = pointRefs(store.state.doc);
    expect([refs.get(p1), refs.get(p2), refs.get(l1)]).toEqual(['A1', 'A2', 'B1']);
    expect(refs.has(orphan)).toBe(false);

    movePointsToCircuit(store, [p2], b);
    expect(pointRefs(store.state.doc).get(p2)).toBe('B1'); // plus ancien que la lampe : il passe devant
  });

  it('numéro du circuit et rang en France', () => {
    const store = newStore('FR');
    const room = addRoomOfKind(store, 'sejour')!;
    const c = addCircuit(store, { rating: 16 })!;
    setActiveCircuit(store, c);
    const p = addPoint(store, room, 'prise')!;
    expect(pointRefs(store.state.doc).get(p)).toBe('1.1');
  });
});

describe('liste de contrôle et avancement', () => {
  it('suit le chantier du premier point au dossier prêt', () => {
    const store = newStore('BE');
    expect(projectProgress(store.state.doc).percent).toBe(0);

    const cuisine = addRoomOfKind(store, 'cuisine')!;
    const sdb = addRoomOfKind(store, 'sdb')!;
    for (let i = 0; i < 4; i++) addPoint(store, cuisine, 'prise');
    addPoint(store, cuisine, 'lampe');
    addPoint(store, sdb, 'prise');
    addPoint(store, sdb, 'lampe');

    let checks = runProjectChecks(store.state.doc);
    expect(checks.some((c) => c.action === 'connect')).toBe(true);
    expect(checks.some((c) => c.where === 'home' && /Adresse/.test(c.text))).toBe(true);
    expect(checks.some((c) => c.action === 'verify')).toBe(true);

    connectUnlinked(store); // génère le tableau belge
    checks = runProjectChecks(store.state.doc);
    expect(checks.filter((c) => c.where === 'board' && c.severity !== 'info')).toEqual([]);

    store.state.doc.project.address = 'Rue du Test 1, 4000 Liège';
    store.state.doc.project.installer = 'Élec SRL';
    confirmPositions(store);
    const progress = projectProgress(store.state.doc);
    expect(progress.steps.map((s) => s.done)).toEqual([true, true, true, true]);
    expect(progress.percent).toBe(100);
    expect(progress.issues).toBe(0);
  });

  it('Belgique : relève une salle de bains raccordée hors 30 mA et un circuit trop chargé', () => {
    const store = newStore('BE');
    const sdb = addRoomOfKind(store, 'sdb')!;
    const sejour = addRoomOfKind(store, 'sejour')!;
    addRcd(store, { sensitivity: 300 });
    const c = addCircuit(store, { rating: 20 })!;
    setActiveCircuit(store, c);
    addPoint(store, sdb, 'prise');
    for (let i = 0; i < 9; i++) addPoint(store, sejour, 'prise');
    const texts = runProjectChecks(store.state.doc).map((x) => x.text);
    expect(texts.some((t) => /30 mA attendu/.test(t))).toBe(true);
    expect(texts.some((t) => /10 points, 8 au maximum \(RGIE\)/.test(t))).toBe(true);
  });
});

describe('devis au point', () => {
  it('compte les points, chiffre le tableau et applique la TVA du chantier', () => {
    const store = newStore('BE');
    const room = addRoomOfKind(store, 'cuisine')!;
    for (let i = 0; i < 3; i++) addPoint(store, room, 'prise');
    addPoint(store, room, 'lampe');
    connectUnlinked(store);
    store.state.doc.project.prices = { prise: 50, lampe: 60, circuit: 40, rcd: 100, board: 200, control: 150 };

    const q = buildQuote(store.state.doc);
    const line = (key: string) => q.lines.find((l) => l.key === key)!;
    expect(line('prise')).toMatchObject({ qty: 3, unit: 50, total: 150 });
    expect(line('lampe')).toMatchObject({ qty: 1, total: 60 });
    expect(line('circuit').qty).toBe(store.activeBoard!.devices.filter((d) => d.kind === 'disj').length);
    expect(line('board').qty).toBe(1);
    expect(q.subtotal).toBe(q.lines.reduce((t, l) => t + l.total, 0));
    expect(q.vatRate).toBe(21);
    expect(q.total).toBeCloseTo(q.subtotal * 1.21);
  });

  it('un chantier vide n’a rien à chiffrer', () => {
    expect(buildQuote(createDoc()).lines).toEqual([]);
    expect(fmtMoney(1234.5)).toBe('1 234,50 €');
  });
});
