import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/domain/document';
import { equipPlan, equipRooms, incompleteRooms } from '../src/domain/plan/equip';
import { planNeeds, roomNeeds } from '../src/domain/plan/needs';
import type { Doc, Item, Room, RoomKind, SymbolItem } from '../src/domain/types';
import { faceOfSymbol, roomFaces, symbolsOnFace } from '../src/domain/walls/faces';
import { inwardRotation, snapToWall } from '../src/domain/walls/snap';

const room = (id: number, kind: RoomKind, x: number, y: number, w: number, h: number): Room => ({
  id, type: 'room', x, y, w, h, label: '', kind, parts: [],
});
const sym = (id: number, kind: string, x: number, y: number, rot = 0, height: number | null = null): SymbolItem => ({
  id, type: 'symbol', kind, x, y, rot: rot as SymbolItem['rot'], label: '', breaker: null, board: null, height,
});
const docOf = (items: Item[]): Doc => ({ ...createDoc('T'), items });

// 20 unités = 0,5 m : une pièce de 160 × 140 unités fait 4 × 3,5 m.

describe('accrochage aux murs', () => {
  const r = room(1, 'sejour', 0, 0, 200, 100);

  it('oriente le pictogramme vers l’intérieur de la pièce', () => {
    expect(inwardRotation([0, 1])).toBe(180); // mur nord
    expect(inwardRotation([0, -1])).toBe(0); // mur sud
    expect(inwardRotation([-1, 0])).toBe(270); // mur est
    expect(inwardRotation([1, 0])).toBe(90); // mur ouest
  });

  it('accroche une prise au mur le plus proche, le dos contre le mur', () => {
    const doc = docOf([r]);
    const s = snapToWall(doc, 80, 14, 'prise');
    expect(s?.face.key).toBe('N0');
    expect(s?.rot).toBe(180);
    expect(s?.y).toBe(5); // décalage vers l'intérieur
    expect(s?.u).toBe(200); // 80 unités = 2 m
  });

  it('n’accroche ni les appareils de plafond ni un point éloigné de tout mur', () => {
    const doc = docOf([r]);
    expect(snapToWall(doc, 80, 14, 'lampe')).toBeNull();
    expect(snapToWall(doc, 100, 50, 'prise')).toBeNull();
  });

  it('pose les ouvertures sur la ligne du mur', () => {
    const doc = docOf([r]);
    const s = snapToWall(doc, 100, 3, 'porte');
    expect(s).toMatchObject({ y: 0, rot: 180 });
    expect(s?.face.key).toBe('N0');
  });

  it('un appareil accroché est bien « sur » le mur', () => {
    const doc = docOf([r]);
    const s = snapToWall(doc, 60, 10, 'prise')!;
    const item = sym(2, 'prise', s.x, s.y, s.rot);
    expect(faceOfSymbol({ ...doc, items: [r, item] }, item)?.face.key).toBe('N0');
  });
});

describe('besoins d’une pièce', () => {
  it('compare ce qui est demandé à ce qui est posé', () => {
    const k = room(1, 'cuisine', 0, 0, 160, 140); // 4 × 3,5 m = 14 m²
    const doc = docOf([k, sym(2, 'prise', 20, 10), sym(3, 'prise', 60, 10)]);
    const report = roomNeeds(doc, 1)!;
    const prises = report.needs.find((n) => n.id === 'prise')!;
    expect(prises).toMatchObject({ min: 6, have: 2, missing: 4 });
    expect(report.complete).toBe(false);
    expect(report.needs.find((n) => n.id === 'prise_s')?.pointLabels).toContain('Four');
  });

  it('une pièce sans type n’a aucune exigence', () => {
    const doc = docOf([room(1, 'autre', 0, 0, 100, 100)]);
    expect(planNeeds(doc)[0]).toMatchObject({ required: 0, complete: true });
  });
});

describe('équipement automatique', () => {
  const kitchen = room(1, 'cuisine', 0, 0, 160, 140);
  const door = sym(10, 'porte', 40, 140, 0);
  const win = sym(11, 'fenetre', 80, 0, 180);

  it('propose tout ce qui manque, sur les murs de la pièce', () => {
    const doc = docOf([kitchen, door, win]);
    const res = equipRooms(doc, [1]);
    expect(res.byKind).toMatchObject({ prise: 6, prise_s: 3, lampe: 1, inter: 1 });
    expect(res.unplaced).toBe(0);

    // Chaque appareil de mur est rattaché à un mur de la pièce.
    const after = docOf([kitchen, door, win, ...res.items.map((it, i) => ({ ...it, id: 100 + i }) as Item)]);
    for (const it of after.items) {
      if (it.type !== 'symbol' || ['porte', 'fenetre', 'lampe'].includes(it.kind)) continue;
      expect(faceOfSymbol(after, it), it.kind).not.toBeNull();
    }
  });

  it('pose quatre prises au-dessus du plan de travail et nomme les circuits spécialisés', () => {
    const doc = docOf([kitchen, door]);
    const res = equipRooms(doc, [1]);
    const prises = res.items.filter((i) => i.type === 'symbol' && i.kind === 'prise');
    const worktop = prises.filter((i) => i.type === 'symbol' && i.height === 110);
    expect(worktop).toHaveLength(4);
    const labels = res.items.filter((i) => i.type === 'symbol' && i.kind === 'prise_s').map((i) => (i.type === 'symbol' ? i.label : ''));
    expect(labels).toEqual(['Four', 'Plaque de cuisson', 'Lave-vaisselle']);
  });

  it('place l’interrupteur à côté de la porte, jamais devant elle', () => {
    const doc = docOf([kitchen, door]);
    const res = equipRooms(doc, [1]);
    const sw = res.items.find((i) => i.type === 'symbol' && i.kind === 'inter');
    expect(sw?.type).toBe('symbol');
    const after = docOf([kitchen, door, { ...sw!, id: 50 } as Item]);
    const south = roomFaces(kitchen).find((f) => f.key === 'S0')!;
    const [placed] = symbolsOnFace(after, south).filter((p) => p.item.kind === 'inter');
    const [d] = symbolsOnFace(after, south).filter((p) => p.item.kind === 'porte');
    expect(placed).toBeDefined();
    expect(Math.abs(placed!.u - d!.u)).toBeGreaterThanOrEqual(45 / 2 + 10);
    expect(Math.abs(placed!.u - d!.u)).toBeLessThan(90);
  });

  it('ne duplique pas ce qui est déjà posé', () => {
    const doc = docOf([kitchen, door, sym(2, 'lampe', 80, 70)]);
    const res = equipRooms(doc, [1]);
    expect(res.byKind.lampe).toBeUndefined();
  });

  it('une pièce complète n’appelle aucun ajout, et une seconde passe ne change rien', () => {
    const doc = docOf([kitchen, door]);
    const first = equipRooms(doc, [1]);
    const after = docOf([kitchen, door, ...first.items.map((it, i) => ({ ...it, id: 100 + i }) as Item)]);
    expect(roomNeeds(after, 1)!.complete).toBe(true);
    expect(incompleteRooms(after)).toEqual([]);
    expect(equipRooms(after, [1]).items).toHaveLength(0);
  });

  it('les appareils posés ne se chevauchent pas', () => {
    const doc = docOf([kitchen, door, win]);
    const res = equipRooms(doc, [1]);
    const after = docOf([kitchen, door, win, ...res.items.map((it, i) => ({ ...it, id: 100 + i }) as Item)]);
    for (const face of roomFaces(kitchen)) {
      const placed = symbolsOnFace(after, face).filter((p) => p.mounting.where === 'wall');
      for (let i = 1; i < placed.length; i++) {
        // Deux appareils au même niveau gardent au moins 20 cm entre eux.
        const a = placed[i - 1]!;
        const b = placed[i]!;
        if (Math.abs(a.v - b.v) < 20) expect(b.u - a.u).toBeGreaterThanOrEqual(19);
      }
    }
  });

  it('équipe toute la maison : pièces, détecteur de fumée et tableau', () => {
    const items: Item[] = [
      room(1, 'sejour', 0, 0, 240, 180),
      room(2, 'chambre', 240, 0, 160, 180),
      room(3, 'entree', 0, 180, 120, 100),
      sym(10, 'porte', 60, 280),
    ];
    const res = equipPlan(docOf(items));
    expect(res.byKind.fumee).toBe(1);
    expect(res.byKind.tableau).toBe(1);
    expect(res.byKind.prise).toBeGreaterThanOrEqual(5 + 3 + 1);

    // Le tableau est dans l'entrée, sur un mur.
    const tableau = res.items.find((i) => i.type === 'symbol' && i.kind === 'tableau');
    expect(tableau?.type === 'symbol' && tableau.y > 180).toBe(true);
  });

  it('ne rajoute ni détecteur ni tableau quand ils existent déjà', () => {
    const items: Item[] = [room(1, 'sejour', 0, 0, 240, 180), sym(8, 'fumee', 100, 90), sym(9, 'tableau', 5, 60, 90)];
    const res = equipPlan(docOf(items));
    expect(res.byKind.fumee).toBeUndefined();
    expect(res.byKind.tableau).toBeUndefined();
  });
});
