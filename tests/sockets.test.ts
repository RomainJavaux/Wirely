import { describe, expect, it } from 'vitest';
import { addCircuit } from '../src/core/circuitActions';
import { setActiveCircuit } from '../src/core/links';
import { addPoint, addRoomOfKind, setSocketKind } from '../src/core/pointActions';
import { Store } from '../src/core/store';
import { SOCKET_SERIES, getSymbol, isSocketKind, outletsOf, socketKind } from '../src/domain/catalog';
import { createDoc } from '../src/domain/document';
import { planCircuits } from '../src/domain/link/autoCircuits';
import { runLinkChecks } from '../src/domain/link/checks';
import { circuitLinks, linksSummary } from '../src/domain/link/links';
import { roomNeeds } from '../src/domain/plan/needs';
import { pointTypes } from '../src/domain/points';
import { RULES } from '../src/domain/rules';
import type { Country, Doc, Item, SymbolItem } from '../src/domain/types';
import { mountingOf } from '../src/domain/walls/mounting';

const room = (id: number, kind: 'sejour' | 'cuisine', x: number, y: number, w: number, h: number): Item => ({
  id, type: 'room', x, y, w, h, label: '', kind, parts: [],
});
const sym = (id: number, kind: string, x: number, y: number, breaker: number | null = null): SymbolItem => ({
  id, type: 'symbol', kind, x, y, rot: 0, label: '', breaker, board: null, height: null,
});
const docOf = (items: Item[], country: Country): Doc => ({ ...createDoc('T', country), items });

/** Un chantier avec une pièce et un circuit de prises actif. */
function site(country: Country, rating = 16): { store: Store; roomId: number; circuit: number } {
  const store = new Store(createDoc('T', country));
  const roomId = addRoomOfKind(store, 'sejour')!;
  const circuit = addCircuit(store, { rating, label: 'Prises' })!;
  setActiveCircuit(store, circuit);
  return { store, roomId, circuit };
}

describe('prises multiples', () => {
  it('de la simple à la quadruple, avec leur nombre de socles', () => {
    expect(SOCKET_SERIES).toEqual(['prise', 'prise2', 'prise3', 'prise4']);
    expect(SOCKET_SERIES.map(outletsOf)).toEqual([1, 2, 3, 4]);
    expect(outletsOf('prise_s')).toBe(0);
    expect(socketKind(3)).toBe('prise3');
    expect(socketKind(9)).toBe('prise4');
    expect(getSymbol('prise4')?.name).toBe('Prise quadruple');
    expect(isSocketKind('prise3')).toBe(true);
    // Proposées aux compteurs, dans les deux pays.
    for (const c of ['BE', 'FR'] as const) {
      expect(pointTypes(c).filter((t) => t.group === 'prises' && t.main).map((t) => t.kind)).toEqual([...SOCKET_SERIES]);
    }
  });

  it('se posent à hauteur de prise, plus larges à chaque socle', () => {
    const widths = SOCKET_SERIES.map((k) => mountingOf(k));
    expect(widths.every((m) => m.where === 'wall' && m.height === 30)).toBe(true);
    expect(widths.map((m) => m.w)).toEqual([8, 15, 22, 29]);
  });

  it('Belgique : une prise multiple compte pour un point', () => {
    expect(RULES.BE.limit({ sockets: 5, outlets: 14, lights: 0, fixed: 0 }, 2.5)).toEqual({ used: 5, max: 8, unit: 'points' });
  });

  it('France : chaque socle compte (une double en vaut deux)', () => {
    expect(RULES.FR.limit({ sockets: 5, outlets: 9, lights: 0, fixed: 0 }, 1.5)).toEqual({ used: 9, max: 8, unit: 'socles' });
    expect(RULES.FR.limit({ sockets: 5, outlets: 9, lights: 0, fixed: 0 }, 2.5).max).toBe(12);
  });

  it('les circuits proposés tiennent compte des socles en France, pas en Belgique', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 400, 400)];
    for (let i = 0; i < 6; i++) items.push(sym(10 + i, 'prise2', 20 + i * 20, 20));
    const fr = planCircuits(docOf(items, 'FR')).filter((p) => p.usage === 'prises');
    expect(fr.map((p) => p.itemIds.length)).toEqual([4, 2]); // 12 socles : 8 + 4
    const be = planCircuits(docOf(items, 'BE')).filter((p) => p.usage === 'prises');
    expect(be.map((p) => p.itemIds.length)).toEqual([6]); // 6 points
  });

  it('les minimums d’une pièce comptent chaque socle', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 200, 200), sym(10, 'prise4', 20, 20), sym(11, 'prise', 60, 20)];
    const need = roomNeeds(docOf(items, 'FR'), 1)!.needs.find((n) => n.kind === 'prise')!;
    expect(need.have).toBe(5); // 4 + 1
    expect(need.missing).toBe(Math.max(0, need.min - 5));
  });

  it('le circuit dit combien de socles il porte', () => {
    const { store, roomId, circuit } = site('FR');
    addPoint(store, roomId, 'prise');
    addPoint(store, roomId, 'prise3');
    const l = circuitLinks(store.state.doc, circuit);
    expect([l.sockets, l.outlets]).toEqual([2, 4]);
    expect(linksSummary(l)).toContain('2 prises (4 socles)');
  });
});

describe('changer une prise sur place', () => {
  it('garde la place, le circuit et se défait d’un Ctrl+Z', () => {
    const { store, roomId, circuit } = site('BE', 20);
    const id = addPoint(store, roomId, 'prise')!;
    const before = store.getItem(id) as SymbolItem;

    expect(setSocketKind(store, id, 'prise3')).toBe(true);
    const after = store.getItem(id) as SymbolItem;
    expect(after).toMatchObject({ kind: 'prise3', x: before.x, y: before.y, rot: before.rot, breaker: circuit });

    store.undo();
    expect((store.getItem(id) as SymbolItem).kind).toBe('prise');
  });

  it('refuse ce qui n’est pas une prise de courant', () => {
    const { store, roomId } = site('BE');
    const lamp = addPoint(store, roomId, 'lampe')!;
    const plug = addPoint(store, roomId, 'prise')!;
    expect(setSocketKind(store, lamp, 'prise2')).toBe(false);
    expect(setSocketKind(store, plug, 'prise_s')).toBe(false);
    expect(setSocketKind(store, plug, 'prise')).toBe(false); // déjà simple
  });

  it('France : prévient quand le circuit dépasse alors sa limite', () => {
    const { store, roomId, circuit } = site('FR', 16); // 1,5 mm² : 8 socles
    for (let i = 0; i < 6; i++) addPoint(store, roomId, 'prise');
    const last = addPoint(store, roomId, 'prise')!;
    expect(store.state.notice?.text ?? '').not.toContain('au maximum');

    setSocketKind(store, last, 'prise3'); // 6 + 3 = 9 socles
    expect(store.state.notice?.text).toContain('9 socles, 8 au maximum');
    const board = store.state.doc.boards[0]!;
    expect(runLinkChecks(store.state.doc, board).some((c) => c.deviceId === circuit && c.message.includes('9 socles'))).toBe(true);
  });

  it('Belgique : une quadruple reste un seul point', () => {
    const { store, roomId, circuit } = site('BE', 20);
    for (let i = 0; i < 7; i++) addPoint(store, roomId, 'prise');
    const last = addPoint(store, roomId, 'prise')!;
    setSocketKind(store, last, 'prise4');
    const board = store.state.doc.boards[0]!;
    expect(runLinkChecks(store.state.doc, board).filter((c) => c.deviceId === circuit && c.severity === 'warn')).toEqual([]);
  });
});
