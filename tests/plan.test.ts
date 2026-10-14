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
  id, type: 'room', x, y, w, h, label, kind, parts: [],
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

// ---------------------------------------------------------------- pièces composées (fusion)

import { detachRoomPart, mergeRoomsInto } from '../src/core/actions';
import { translateItem, itemBounds } from '../src/domain/geometry';
import { detachPart, isConnected, mergeRooms, outlineSegments, roomArea, roomContains, unionArea } from '../src/domain/plan/rooms';

describe('pièces composées', () => {
  const perimeter = (segs: [number, number, number, number][]) =>
    segs.reduce((s, [x1, y1, x2, y2]) => s + Math.abs(x2 - x1) + Math.abs(y2 - y1), 0);

  // Une pièce en L : un grand rectangle 200×100 et un bras 100×100 en dessous à gauche.
  const L = [
    { x: 0, y: 0, w: 200, h: 100 },
    { x: 0, y: 100, w: 100, h: 100 },
  ];

  it('calcule la surface de l’union, recouvrements comptés une fois', () => {
    expect(unionArea(L)).toBe(30000);
    expect(unionArea([{ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 0, w: 100, h: 100 }])).toBe(15000);
    expect(unionArea([{ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 }])).toBe(10000);
    expect(unionArea([])).toBe(0);
  });

  it('trace le contour extérieur sans les arêtes communes', () => {
    // Périmètre du L : 200 + 100 + 100 + 100 + 100 + 200 = 800 ; l'arête commune (0–100, y=100) disparaît.
    expect(perimeter(outlineSegments(L))).toBe(800);
    // Un rectangle seul : 2 × (w + h).
    expect(perimeter(outlineSegments([{ x: 0, y: 0, w: 100, h: 50 }]))).toBe(300);
    // Deux rectangles côte à côte forment un grand rectangle 200×100 : périmètre 600.
    expect(perimeter(outlineSegments([{ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 100, h: 100 }]))).toBe(600);
  });

  it('reconnaît qu’un point appartient à n’importe laquelle des parties', () => {
    const room = { ...room0(), parts: [L[1] as { x: number; y: number; w: number; h: number }] };
    expect(roomContains(room, 150, 50)).toBe(true); // rectangle principal
    expect(roomContains(room, 50, 150)).toBe(true); // partie
    expect(roomContains(room, 150, 150)).toBe(false); // le creux du L
  });

  function room0(): Room {
    return { id: 1, type: 'room', x: 0, y: 0, w: 200, h: 100, label: 'Salon', kind: 'sejour', parts: [] };
  }

  it('fusionne : la pièce garde son nom, absorbe les rectangles et leurs parties', () => {
    const a = room0();
    const b: Room = { id: 2, type: 'room', x: 0, y: 100, w: 100, h: 100, label: 'Coin', kind: 'autre', parts: [{ x: 100, y: 100, w: 20, h: 20 }] };
    const merged = mergeRooms(a, b);
    expect(merged.label).toBe('Salon');
    expect(merged.kind).toBe('sejour');
    expect(merged.parts).toHaveLength(2);
    expect(roomArea(merged)).toBe(20000 + 10000 + 400);
  });

  it('détache une partie sans perdre la pièce', () => {
    const merged = mergeRooms(room0(), { ...room0(), id: 2, x: 0, y: 100, w: 100, h: 100 });
    const res = detachPart(merged, 0);
    expect(res?.room.parts).toHaveLength(0);
    expect(res?.part).toEqual({ x: 0, y: 100, w: 100, h: 100 });
    expect(detachPart(merged, 5)).toBeNull();
  });

  it('détecte des parties qui ne se touchent pas', () => {
    expect(isConnected(L)).toBe(true);
    expect(isConnected([{ x: 0, y: 0, w: 10, h: 10 }, { x: 500, y: 500, w: 10, h: 10 }])).toBe(false);
  });

  it('le déplacement et la boîte englobante tiennent compte des parties', () => {
    const merged = mergeRooms(room0(), { ...room0(), id: 2, x: 0, y: 100, w: 100, h: 100 });
    expect(itemBounds(merged)).toEqual({ x0: 0, y0: 0, x1: 200, y1: 200 });
    const moved = translateItem(merged, 40, 10);
    expect(moved.parts[0]).toEqual({ x: 40, y: 110, w: 100, h: 100 });
    expect(merged.parts[0]).toEqual({ x: 0, y: 100, w: 100, h: 100 }); // l'original n'est pas modifié
  });

  it('les équipements des parties comptent pour la pièce unique', () => {
    const sejour: Room = { ...room0(), parts: [{ x: 0, y: 100, w: 100, h: 100 }] };
    const doc = docWith([
      sejour,
      sym(2, 'prise', 150, 50),
      sym(3, 'prise', 50, 150),
      sym(4, 'lampe', 40, 180),
    ]);
    const stats = roomStats(doc);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ sockets: 2, lights: 1, merged: true });
    expect(stats[0]?.area).toBeCloseTo((30000 / 400) * 0.25); // 75 carreaux × 0,25 m²
    expect(roomAt([sejour], 50, 150)?.id).toBe(1);
  });

  it('une pièce fusionnée n’est plus comptée comme deux pièces ni deux fois en surface', () => {
    const doc = docWith([
      room(1, 0, 0, 200, 100, 'sejour', 'Salon'),
      room(2, 200, 0, 40, 100, 'autre'),
    ]);
    expect(planSummary(doc).rooms).toBe(2);
    const store = new Store(doc);
    store.commit();
    expect(mergeRoomsInto(store, 1, 2)).toBe(true);
    const after = planSummary(store.state.doc);
    expect(after.rooms).toBe(1);
    expect(after.area).toBeCloseTo((240 * 100) / 400 * 0.25);
  });

  it('la fusion se fait par l’action, sélectionne la pièce conservée et s’annule', () => {
    const store = new Store(docWith([room(1, 0, 0, 100, 100), room(2, 100, 0, 100, 100)]));
    store.commit();
    store.change((s) => (s.mergeFrom = 1));
    expect(mergeRoomsInto(store, 1, 2)).toBe(true);
    expect(store.state.selection).toBe(1);
    expect(store.state.mergeFrom).toBeNull();
    expect(store.state.doc.items).toHaveLength(1);
    store.undo();
    expect(store.state.doc.items).toHaveLength(2);
  });

  it('refuse de fusionner une pièce avec elle-même ou avec autre chose qu’une pièce', () => {
    const store = new Store(docWith([room(1, 0, 0, 100, 100), sym(2, 'prise', 5, 5)]));
    expect(mergeRoomsInto(store, 1, 1)).toBe(false);
    expect(mergeRoomsInto(store, 1, 2)).toBe(false);
    expect(mergeRoomsInto(store, 1, 99)).toBe(false);
    expect(store.state.doc.items).toHaveLength(2);
  });

  it('détacher recrée une pièce du même type, sélectionnée', () => {
    const doc = docWith([room(1, 0, 0, 100, 100, 'cuisine', 'Cuisine'), room(2, 100, 0, 50, 100)]);
    doc.nextId = 10; // le compteur d'identifiants dépasse ceux des éléments existants
    const store = new Store(doc);
    store.commit();
    mergeRoomsInto(store, 1, 2);
    detachRoomPart(store, 1, 0);
    const rooms = store.state.doc.items.filter((i): i is Room => i.type === 'room');
    expect(rooms).toHaveLength(2);
    const created = rooms.find((r) => r.id === store.state.selection);
    expect(created).toMatchObject({ kind: 'cuisine', x: 100, w: 50, parts: [] });
    expect(rooms.find((r) => r.id === 1)?.parts).toHaveLength(0);
  });

  it('les parties survivent à l’enregistrement et sont validées à la lecture', () => {
    const doc = parseDoc({
      items: [
        {
          id: 1,
          type: 'room',
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          parts: [
            { x: 100, y: 0, w: 50, h: 100 },
            { x: 'x', y: 0, w: 10, h: 10 },
            { x: 0, y: 0, w: -5, h: 10 },
            'bidon',
          ],
        },
      ],
    });
    const r = doc.items[0] as Room;
    expect(r.parts).toEqual([{ x: 100, y: 0, w: 50, h: 100 }]);
    expect(parseDoc(JSON.parse(JSON.stringify(doc))).items[0]).toEqual(r);
  });

  it('l’exemple et les anciens fichiers restent des pièces simples', () => {
    expect(parseDoc({ items: [{ id: 1, type: 'room', x: 0, y: 0, w: 10, h: 10 }] }).items[0]).toMatchObject({ parts: [] });
  });
});
