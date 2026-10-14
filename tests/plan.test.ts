import { describe, expect, it } from 'vitest';
import { loadExamplePlan, moveSelection, rotateSelection, setScale } from '../src/core/actions';
import { Store } from '../src/core/store';
import { createDoc, parseDoc } from '../src/domain/document';
import { runPlanChecks } from '../src/domain/plan/checks';
import { planBomCsv, planBomRows, planRoomsCsv, roomRows } from '../src/domain/plan/export';
import { planSummary, polylineLength, roomAt, roomStats, toMeters, toUnits } from '../src/domain/plan/metrics';
import { ROOM_KINDS } from '../src/domain/plan/roomKinds';
import { examplePlan } from '../src/domain/plan/templates';
import type { Doc, Item, NewItem, Room } from '../src/domain/types';
import { buildExportSvg } from '../src/io/exporter';
import { niceScaleBar } from '../src/render/scaleBar';

const room = (id: number, x: number, y: number, w: number, h: number, kind: Room['kind'] = 'autre', label = ''): Item => ({
  id, type: 'room', x, y, w, h, label, kind,
});
const sym = (id: number, kind: string, x: number, y: number): Item => ({
  id, type: 'symbol', kind, x, y, rot: 0, label: '', circuit: '', height: null,
});
const docWith = (items: Item[], scale = 0.5): Doc => ({ ...createDoc('Test'), items, scale });
const exampleDoc = (): Doc => {
  const doc = createDoc('Ex');
  examplePlan().items.forEach((d, i) => doc.items.push({ ...d, id: i + 1 } as Item));
  return doc;
};

describe('échelle', () => {
  it('convertit unités et mètres (1 carreau = 20 unités)', () => {
    expect(toMeters(0.5, 20)).toBe(0.5);
    expect(toMeters(0.5, 200)).toBe(5);
    expect(toUnits(0.5, 5)).toBe(200);
    expect(toMeters(1, toUnits(1, 3.7))).toBeCloseTo(3.7);
  });

  it('mesure une ligne brisée', () => {
    expect(polylineLength([[0, 0], [30, 0], [30, 40]])).toBe(70);
    expect(polylineLength([[5, 5]])).toBe(0);
  });

  it('choisit une barre d’échelle « ronde » et assez large', () => {
    expect(niceScaleBar(40).meters).toBe(2); // 2 m = 80 px >= 64 px
    expect(niceScaleBar(40).px).toBe(80);
    expect(niceScaleBar(400).meters).toBe(0.2);
    expect(niceScaleBar(0.1).meters).toBe(100);
    expect(niceScaleBar(Number.NaN).px).toBeGreaterThan(0);
  });

  it('setScale borne et valide', () => {
    const store = new Store(createDoc());
    setScale(store, 0.25);
    expect(store.state.doc.scale).toBe(0.25);
    setScale(store, 999);
    expect(store.state.doc.scale).toBe(5);
    setScale(store, 0);
    expect(store.state.doc.scale).toBe(0.05);
    setScale(store, Number.NaN);
    expect(store.state.doc.scale).toBe(0.05);
    store.undo();
    expect(store.state.doc.scale).toBe(5);
  });
});

describe('surfaces et équipements par pièce', () => {
  it('calcule dimensions et surface', () => {
    const [s] = roomStats(docWith([room(1, 0, 0, 240, 180)]));
    expect(s?.width).toBe(6);
    expect(s?.depth).toBe(4.5);
    expect(s?.area).toBe(27);
  });

  it('range chaque symbole dans la pièce qui contient son centre', () => {
    const doc = docWith([
      room(1, 0, 0, 100, 100, 'sejour'),
      room(2, 100, 0, 100, 100, 'cuisine'),
      sym(3, 'prise', 10, 10),
      sym(4, 'prise', 150, 50),
      sym(5, 'lampe', 150, 60),
      sym(6, 'inter', 5, 5),
      sym(7, 'prise', 500, 500),
    ]);
    const [a, b] = roomStats(doc);
    expect([a?.sockets, a?.switches, a?.lights]).toEqual([1, 1, 0]);
    expect([b?.sockets, b?.lights]).toEqual([1, 1]);
  });

  it('une pièce imbriquée l’emporte sur la plus grande', () => {
    const rooms = [room(1, 0, 0, 300, 300), room(2, 100, 100, 50, 50)] as Room[];
    expect(roomAt(rooms, 120, 120)?.id).toBe(2);
    expect(roomAt(rooms, 10, 10)?.id).toBe(1);
    expect(roomAt(rooms, 900, 900)).toBeNull();
  });

  it('ne compte pas les prises spécialisées, RJ45 et TV comme prises 16 A', () => {
    const doc = docWith([room(1, 0, 0, 200, 200), sym(2, 'prise_s', 10, 10), sym(3, 'rj45', 20, 20), sym(4, 'tv', 30, 30)]);
    expect(roomStats(doc)[0]?.sockets).toBe(0);
  });

  it('totalise surfaces, appareils et longueurs de câble', () => {
    const doc = docWith([
      room(1, 0, 0, 200, 200),
      { id: 2, type: 'wire', points: [[0, 0], [100, 0]], wtype: 'prises', circuit: '' },
      { id: 3, type: 'wire', points: [[0, 0], [0, 100]], wtype: 'prises', circuit: '' },
      sym(4, 'prise', 1, 1),
    ]);
    const s = planSummary(doc);
    expect(s.area).toBe(25);
    expect(s.wires).toEqual([{ type: 'prises', length: 5 }]); // 200 unités = 5 m
    expect(s.byCategory).toEqual([{ category: 'Prises', count: 1 }]);
  });
});

describe('contrôles du plan', () => {
  const messages = (doc: Doc) => runPlanChecks(doc).map((c) => c.message);

  it('signale un séjour sous-équipé, avec le minimum proportionnel à la surface', () => {
    const doc = docWith([room(1, 0, 0, 240, 180, 'sejour', 'Salon'), sym(2, 'prise', 10, 10)]);
    const msg = messages(doc).find((m) => m.includes('Salon'));
    expect(msg).toMatch(/1 prise, 7 conseillées/); // 27 m² -> 7
  });

  it('un séjour correctement équipé ne déclenche pas d’alerte de prises', () => {
    const items: Item[] = [room(1, 0, 0, 240, 180, 'sejour'), sym(2, 'lampe', 100, 100)];
    for (let i = 0; i < 7; i++) items.push(sym(10 + i, 'prise', 10 + i, 10));
    expect(messages(docWith(items)).some((m) => m.includes('prise'))).toBe(false);
  });

  it('signale l’absence de point lumineux et de détecteur de fumée', () => {
    const doc = docWith([room(1, 0, 0, 100, 100, 'chambre')]);
    const m = messages(doc);
    expect(m.some((x) => x.includes('aucun point lumineux'))).toBe(true);
    expect(m.some((x) => x.includes('détecteur de fumée'))).toBe(true);
  });

  it('ne dit rien d’un plan sans pièce', () => {
    expect(runPlanChecks(docWith([sym(1, 'prise', 0, 0)]))).toEqual([]);
  });

  it('les exigences par type de pièce sont définies', () => {
    expect(ROOM_KINDS.chambre.minSockets?.(12)).toBe(3);
    expect(ROOM_KINDS.cuisine.minSockets?.(10)).toBe(6);
    expect(ROOM_KINDS.cuisine.minSockets?.(3)).toBe(3);
    expect(ROOM_KINDS.sejour.minSockets?.(10)).toBe(5);
    expect(ROOM_KINDS.exterieur.minSockets).toBeNull();
  });
});

describe('exemple d’appartement', () => {
  it('est cohérent : pièces typées, appareillage, câbles', () => {
    const s = planSummary(exampleDoc());
    expect(s.rooms).toBe(5);
    expect(s.area).toBeGreaterThan(70);
    expect(s.wires.length).toBeGreaterThanOrEqual(3);
    expect(s.byKind.some((k) => k.kind === 'tableau')).toBe(true);
  });

  it('respecte les minimums qu’il illustre (aucune alerte de prises ni de lumière)', () => {
    const warn = runPlanChecks(exampleDoc()).filter((c) => c.severity === 'warn');
    expect(warn).toEqual([]);
  });

  it('se charge une seule fois, uniquement sur un plan vide', () => {
    const store = new Store(createDoc());
    expect(loadExamplePlan(store)).toBe(true);
    const n = store.state.doc.items.length;
    expect(n).toBeGreaterThan(30);
    expect(loadExamplePlan(store)).toBe(false);
    expect(store.state.doc.items).toHaveLength(n);
    // annulable
    store.undo();
    expect(store.state.doc.items).toHaveLength(0);
  });

  it('attribue des identifiants uniques', () => {
    const store = new Store(createDoc());
    loadExamplePlan(store);
    const ids = store.state.doc.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(store.state.doc.nextId).toBeGreaterThan(Math.max(...ids));
  });
});

describe('actions du plan', () => {
  it('déplace la sélection par pas de grille et peut annuler', () => {
    const store = new Store(createDoc());
    store.state.doc.items.push(sym(1, 'prise', 100, 100));
    store.commit(); // état initial
    store.state.selection = 1;
    moveSelection(store, 10, -20);
    expect(store.getItem(1)).toMatchObject({ x: 110, y: 80 });
    store.undo();
    expect(store.getItem(1)).toMatchObject({ x: 100, y: 100 });
  });

  it('pivote dans les deux sens', () => {
    const store = new Store(createDoc());
    store.state.doc.items.push(sym(1, 'prise', 0, 0));
    store.state.selection = 1;
    rotateSelection(store, -90);
    expect(store.getItem(1)).toMatchObject({ rot: 270 });
    rotateSelection(store, 90);
    expect(store.getItem(1)).toMatchObject({ rot: 0 });
  });
});

describe('fichiers et compatibilité', () => {
  it('un ancien fichier reçoit les valeurs par défaut', () => {
    const doc = parseDoc({
      items: [
        { id: 1, type: 'room', x: 0, y: 0, w: 100, h: 100, label: 'Salon' },
        { id: 2, type: 'symbol', kind: 'prise', x: 5, y: 5, rot: 0, label: '' },
        { id: 3, type: 'wire', points: [[0, 0], [10, 0]], wtype: 'prises' },
      ],
    });
    expect(doc.scale).toBe(0.5);
    expect(doc.items[0]).toMatchObject({ kind: 'autre' });
    expect(doc.items[1]).toMatchObject({ circuit: '', height: null });
    expect(doc.items[2]).toMatchObject({ circuit: '' });
  });

  it('borne les valeurs saisies à la main dans un fichier', () => {
    const doc = parseDoc({
      scale: 9999,
      items: [
        { id: 1, type: 'room', x: 0, y: 0, w: 10, h: 10, label: '', kind: 'inconnu' },
        { id: 2, type: 'symbol', kind: 'prise', x: 0, y: 0, rot: 0, label: '', circuit: 'x'.repeat(200), height: 9999 },
      ],
    });
    expect(doc.scale).toBe(0.5);
    expect(doc.items[0]).toMatchObject({ kind: 'autre' });
    const symbol = doc.items[1];
    expect(symbol?.type === 'symbol' && symbol.circuit.length).toBe(40);
    expect(symbol).toMatchObject({ height: null });
  });

  it('conserve l’échelle dans un aller-retour', () => {
    const doc = createDoc();
    doc.scale = 0.25;
    expect(parseDoc(JSON.parse(JSON.stringify(doc))).scale).toBe(0.25);
  });
});

describe('exports du plan', () => {
  it('liste les pièces avec leurs équipements', () => {
    const rows = roomRows(exampleDoc());
    expect(rows).toHaveLength(5);
    const sejour = rows.find((r) => r.name === 'Séjour');
    expect(sejour).toMatchObject({ type: 'Séjour', width: '6,00', depth: '4,50', area: '27,0', sockets: 7, lights: 1 });
  });

  it('produit une nomenclature : appareils comptés, câbles mesurés', () => {
    const rows = planBomRows(exampleDoc());
    expect(rows.find((r) => r.name === 'Prise 2P+T')?.qty).toBe(19); // 7 + 6 + 3 + 2 + 1
    const cable = rows.find((r) => r.section === 'Câbles');
    expect(cable?.length).toBeGreaterThan(0);
    expect(cable?.qty).toBeNull();
  });

  it('exporte des CSV compatibles Excel', () => {
    const rooms = planRoomsCsv(exampleDoc());
    expect(rooms.startsWith('﻿Pièce;Type;')).toBe(true);
    expect(rooms).toContain('Séjour;Séjour;6,00;4,50;27,0;7;1');
    const bom = planBomCsv(exampleDoc());
    expect(bom).toContain('Appareillage;Prises;Prise 2P+T;19;');
    expect(bom.split('\r\n').every((l) => !l.includes('NaN'))).toBe(true);
  });

  it('la fiche contient plan, légende chiffrée, pièces et nomenclature', () => {
    const svg = buildExportSvg(exampleDoc(), new Date('2026-01-01'));
    for (const text of ['Ex', '5 pièces', '76,0 m²', 'Échelle : 1 carreau = 0,50 m', 'Plan', 'Légende', 'Pièces', 'Nomenclature', '× 19', 'Surface']) {
      expect(svg, text).toContain(text);
    }
    expect(svg).not.toContain('data-id');
  });

  it('la fiche d’un plan vide ne plante pas', () => {
    expect(() => buildExportSvg(createDoc('Vide'))).not.toThrow();
  });
});

// Garde-fou de typage : les brouillons d'exemple respectent bien NewItem.
const _check: NewItem[] = examplePlan().items;
void _check;
