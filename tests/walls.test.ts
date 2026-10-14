import { describe, expect, it } from 'vitest';
import { setCeiling } from '../src/core/actions';
import { showItemIn3D, showItemOnWall, showWall } from '../src/core/links';
import { Store } from '../src/core/store';
import { createDoc, parseDoc } from '../src/domain/document';
import { buildExportSvg, buildPlanSections } from '../src/io/exporter';
import { renderElevation } from '../src/render/walls/elevationSvg';
import { MAX_SWITCH_HEIGHT, MIN_SOCKET_HEIGHT, runWallChecks } from '../src/domain/walls/checks';
import type { Doc, Item, Room, SymbolItem } from '../src/domain/types';
import { buildScene3D } from '../src/domain/view3d/model';
import {
  faceLabel,
  faceOfSymbol,
  moveAlongFace,
  roomFaces,
  symbolsOnFace,
  unitsToCm,
  cmToUnits,
} from '../src/domain/walls/faces';
import { effectiveHeight, isCeilingKind, isOpeningKind, mountingOf } from '../src/domain/walls/mounting';

const room = (id: number, x: number, y: number, w: number, h: number, parts: Room['parts'] = []): Room => ({
  id, type: 'room', x, y, w, h, label: 'Salon', kind: 'sejour', parts,
});
const sym = (id: number, kind: string, x: number, y: number, height: number | null = null): SymbolItem => ({
  id, type: 'symbol', kind, x, y, rot: 0, label: '', breaker: null, board: null, height,
});
const docOf = (items: Item[]): Doc => ({ ...createDoc('T'), items });

// 20 unités = 0,5 m  ->  1 unité = 2,5 cm

describe('hauteurs de pose', () => {
  it('donne une hauteur usuelle par type, remplaçable', () => {
    expect(effectiveHeight(sym(1, 'prise', 0, 0))).toBe(30);
    expect(effectiveHeight(sym(1, 'inter', 0, 0))).toBe(110);
    expect(effectiveHeight(sym(1, 'prise', 0, 0, 105))).toBe(105);
    expect(mountingOf('inconnu').where).toBe('wall');
  });

  it('distingue ouvertures, plafond et mur', () => {
    expect(isOpeningKind('porte')).toBe(true);
    expect(isOpeningKind('fenetre')).toBe(true);
    expect(isCeilingKind('lampe')).toBe(true);
    expect(isCeilingKind('prise')).toBe(false);
    expect(mountingOf('fenetre').height).toBe(90);
    expect(mountingOf('porte').height).toBe(0);
  });
});

describe('faces de murs', () => {
  it('une pièce rectangulaire a quatre murs, vus de l’intérieur', () => {
    const faces = roomFaces(room(1, 0, 0, 200, 100));
    expect(faces.map((f) => f.key)).toEqual(['N0', 'E0', 'S0', 'W0']);

    const [n, e, s, w] = faces;
    // Nord : de l'ouest (gauche) vers l'est (droite)
    expect(n).toMatchObject({ a: [0, 0], b: [200, 0], length: 200, inward: [0, 1], dir: [1, 0] });
    // Est : du nord (gauche) vers le sud (droite)
    expect(e).toMatchObject({ a: [200, 0], b: [200, 100], length: 100, inward: [-1, 0] });
    // Sud : de l'est (gauche) vers l'ouest (droite)
    expect(s).toMatchObject({ a: [200, 100], b: [0, 100], inward: [0, -1] });
    // Ouest : du sud (gauche) vers le nord (droite)
    expect(w).toMatchObject({ a: [0, 100], b: [0, 0], inward: [1, 0] });
    expect(n?.name).toBe('Mur nord');
  });

  it('une pièce en L a six murs, les arêtes alignées étant recollées', () => {
    const l = room(1, 0, 0, 200, 100, [{ x: 0, y: 100, w: 100, h: 100 }]);
    const faces = roomFaces(l);
    expect(faces).toHaveLength(6);
    const west = faces.filter((f) => f.orientation === 'W');
    expect(west).toHaveLength(1);
    expect(west[0]?.length).toBe(200); // les deux rectangles ne font qu'un seul mur
    expect(faces.filter((f) => f.orientation === 'S')).toHaveLength(2);
    expect(faces.filter((f) => f.orientation === 'E')).toHaveLength(2);
  });

  it('numérote les murs d’une même orientation', () => {
    const l = room(1, 0, 0, 200, 100, [{ x: 0, y: 100, w: 100, h: 100 }]);
    const faces = roomFaces(l);
    const south = faces.filter((f) => f.orientation === 'S');
    expect(faceLabel(south[0]!, faces)).toBe('Mur sud (1)');
    expect(faceLabel(south[1]!, faces)).toBe('Mur sud (2)');
    expect(faceLabel(faces.find((f) => f.orientation === 'N')!, faces)).toBe('Mur nord');
  });

  it('convertit centimètres et unités du plan', () => {
    expect(unitsToCm(0.5, 20)).toBe(50);
    expect(cmToUnits(0.5, 50)).toBe(20);
    expect(cmToUnits(0.5, unitsToCm(0.5, 37))).toBeCloseTo(37);
  });
});

describe('appareillage posé sur un mur', () => {
  const r = room(1, 0, 0, 200, 100);
  const north = () => roomFaces(r).find((f) => f.key === 'N0')!;
  const south = () => roomFaces(r).find((f) => f.key === 'S0')!;

  it('donne la position le long du mur et la hauteur', () => {
    const doc = docOf([r, sym(2, 'prise', 50, 0), sym(3, 'inter', 100, 6, 105)]);
    const placed = symbolsOnFace(doc, north());
    expect(placed.map((p) => [p.item.id, Math.round(p.u), p.v])).toEqual([
      [2, 125, 30],
      [3, 250, 105],
    ]);
  });

  it('ne retient ni le centre de la pièce ni le plafond', () => {
    const doc = docOf([r, sym(2, 'prise', 100, 50), sym(3, 'lampe', 100, 2)]);
    expect(symbolsOnFace(doc, north())).toEqual([]);
  });

  it('place les ouvertures sur la ligne du mur, avec leur allège', () => {
    const doc = docOf([r, sym(2, 'fenetre', 100, 0)]);
    const [p] = symbolsOnFace(doc, north());
    expect(p).toMatchObject({ v: 90 });
    expect(p?.mounting.where).toBe('opening');
  });

  it('vu de l’intérieur, la gauche du mur sud est à l’est', () => {
    const doc = docOf([r, sym(2, 'prise', 150, 100)]);
    const [p] = symbolsOnFace(doc, south());
    expect(Math.round(p!.u)).toBe(125); // 50 unités du coin est (x = 200)
  });

  it('déplace le long du mur en conservant l’écart', () => {
    const doc = docOf([r, sym(2, 'prise', 50, 10)]);
    const item = doc.items[1] as SymbolItem;
    const [x, y] = moveAlongFace(doc, north(), item, 200); // 2 m = 80 unités
    expect([Math.round(x), Math.round(y)]).toEqual([80, 10]);
  });

  it('borne le déplacement aux extrémités du mur', () => {
    const doc = docOf([r, sym(2, 'prise', 50, 0)]);
    const item = doc.items[1] as SymbolItem;
    expect(moveAlongFace(doc, north(), item, 99999)[0]).toBe(200);
    expect(moveAlongFace(doc, north(), item, -50)[0]).toBe(0);
  });

  it('retrouve le mur d’un appareil', () => {
    const doc = docOf([r, sym(2, 'prise', 50, 0)]);
    const hit = faceOfSymbol(doc, doc.items[1] as SymbolItem);
    expect(hit?.face.key).toBe('N0');
    expect(faceOfSymbol(doc, sym(9, 'lampe', 50, 0))).toBeNull();
    expect(faceOfSymbol(doc, sym(9, 'prise', 100, 50))).toBeNull();
  });
});

describe('modèle 3D', () => {
  // Mur de 5 m (200 unités) le long du nord d'une pièce de 5 × 2,5 m.
  const base: Item[] = [
    room(1, 0, 0, 200, 100),
    { id: 2, type: 'wall', points: [[0, 0], [200, 0]] },
  ];

  it('perce un mur par une fenêtre : allège, linteau et vitrage', () => {
    const scene = buildScene3D(docOf([...base, sym(3, 'fenetre', 100, 0)]));
    const walls = scene.boxes.filter((b) => b.role === 'wall');
    const glass = scene.boxes.filter((b) => b.role === 'glass');
    expect(walls).toHaveLength(4); // gauche, sous la fenêtre, au-dessus, droite
    expect(glass).toHaveLength(1);
    expect(glass[0]!.cy).toBeCloseTo(1.5); // entre 0,9 m et 2,1 m
    expect(glass[0]!.w).toBeCloseTo(1.2);

    const below = walls.find((b) => b.cy < 0.5)!;
    expect(below.h).toBeCloseTo(0.9);
  });

  it('ne laisse qu’un linteau au-dessus d’une porte', () => {
    const scene = buildScene3D(docOf([...base, sym(3, 'porte', 40, 0)]));
    const walls = scene.boxes.filter((b) => b.role === 'wall');
    expect(walls).toHaveLength(3); // gauche, linteau, droite
    expect(scene.boxes.some((b) => b.role === 'glass')).toBe(false);
    const lintel = walls.find((b) => b.cy > 2)!;
    expect(lintel.h).toBeCloseTo(2.5 - 2.04);
  });

  it('un mur plein n’est qu’une boîte de la hauteur sous plafond', () => {
    const scene = buildScene3D(docOf(base));
    const walls = scene.boxes.filter((b) => b.role === 'wall');
    expect(walls).toHaveLength(1);
    expect(walls[0]).toMatchObject({ w: 5, h: 2.5 });
  });

  it('respecte la hauteur sous plafond du document et la coupe demandée', () => {
    const tall = { ...docOf(base), ceiling: 300 };
    expect(buildScene3D(tall).boxes.find((b) => b.role === 'wall')!.h).toBeCloseTo(3);
    expect(buildScene3D(tall, { wallHeight: 1.2 }).boxes.find((b) => b.role === 'wall')!.h).toBeCloseTo(1.2);
  });

  it('pose une prise sur la face du mur tournée vers la pièce, à sa hauteur', () => {
    const scene = buildScene3D(docOf([...base, sym(3, 'prise', 60, 4)]));
    const [mark] = scene.marks;
    expect(mark).toMatchObject({ kind: 'prise', onWall: true, ceiling: false });
    expect(mark!.y).toBeCloseTo(0.3);
    expect(mark!.x).toBeCloseTo(1.5); // 60 unités = 1,5 m
    expect(mark!.nz).toBe(1); // vers l'intérieur (le sud, côté pièce)
    expect(mark!.z).toBeGreaterThan(0.07); // devant le parement
  });

  it('accroche un appareil de plafond au plafond', () => {
    const scene = buildScene3D(docOf([...base, sym(3, 'lampe', 100, 50)]));
    expect(scene.marks[0]).toMatchObject({ ceiling: true, onWall: false });
    expect(scene.marks[0]!.y).toBeGreaterThan(2.4);
  });

  it('sans mur dessiné, déduit les murs du contour des pièces', () => {
    const scene = buildScene3D(docOf([room(1, 0, 0, 100, 100)]));
    expect(scene.boxes.filter((b) => b.role === 'wall').length).toBe(4);
    expect(scene.boxes.filter((b) => b.role === 'floor')).toHaveLength(1);
  });

  it('sans mur dessiné, pose les appareils sur le côté de la pièce', () => {
    const scene = buildScene3D(docOf([room(1, 0, 0, 100, 100), sym(2, 'prise', 50, 0)]));
    expect(scene.marks[0]).toMatchObject({ onWall: true, nz: 1 });
  });

  it('trace les câbles au plafond et calcule l’emprise', () => {
    const scene = buildScene3D(
      docOf([...base, { id: 9, type: 'wire', points: [[0, 0], [40, 0]], wtype: 'prises', breaker: null }]),
    );
    expect(scene.wires[0]!.points[1]![0]).toBeCloseTo(1);
    expect(scene.wires[0]!.points[0]![1]).toBeGreaterThan(2.3);
    expect(scene.bounds.maxX).toBeGreaterThanOrEqual(5);
  });

  it('une scène vide a une emprise par défaut', () => {
    const scene = buildScene3D(createDoc());
    expect(scene.boxes).toEqual([]);
    expect(scene.bounds.maxX).toBeGreaterThan(0);
  });
});

describe('hauteur sous plafond du document', () => {
  it('vaut 2,50 m par défaut, et est bornée à la lecture', () => {
    expect(createDoc().ceiling).toBe(250);
    expect(parseDoc({ items: [] }).ceiling).toBe(250);
    expect(parseDoc({ items: [], ceiling: 300 }).ceiling).toBe(300);
    expect(parseDoc({ items: [], ceiling: 10 }).ceiling).toBe(250);
    expect(parseDoc({ items: [], ceiling: 9999 }).ceiling).toBe(250);
  });

  it('se règle par l’action, bornée et annulable', () => {
    const store = new Store(createDoc());
    setCeiling(store, 270);
    expect(store.state.doc.ceiling).toBe(270);
    setCeiling(store, 5);
    expect(store.state.doc.ceiling).toBe(180);
    setCeiling(store, Number.NaN);
    expect(store.state.doc.ceiling).toBe(180);
    store.undo();
    expect(store.state.doc.ceiling).toBe(270);
  });
});

describe('élévation d’un mur', () => {
  const r = room(1, 0, 0, 200, 100);
  const north = () => roomFaces(r).find((f) => f.key === 'N0')!;

  it('dessine les appareils à leur position et leur hauteur', () => {
    const doc = docOf([r, sym(2, 'prise', 50, 0), sym(3, 'inter', 100, 0, 105)]);
    const scene = renderElevation(doc, r, north(), { interactive: true });
    expect(scene.lengthCm).toBe(500);
    expect(scene.ceilingCm).toBe(250);
    expect(scene.placements.map((p) => p.item.id)).toEqual([2, 3]);
    // Les zones de clic portent l'identifiant de l'appareil.
    expect(scene.svg).toContain('data-id="2"');
    expect(scene.svg).toContain('data-id="3"');
    expect(scene.svg).toContain('h 105');
    expect(scene.svg).toContain('data-wall="1"');
  });

  it('convertit entre pixels et centimètres dans les deux sens', () => {
    const scene = renderElevation(docOf([r]), r, north(), { interactive: true });
    const { x, y } = scene.toPx(120, 80);
    const back = scene.toCm(x, y);
    expect(back.u).toBeCloseTo(120);
    expect(back.v).toBeCloseTo(80);
  });

  it('n’ajoute aucune zone de clic dans le rendu d’export', () => {
    const doc = docOf([r, sym(2, 'prise', 50, 0)]);
    const scene = renderElevation(doc, r, north(), { interactive: false });
    expect(scene.svg).not.toContain('data-id');
    expect(scene.svg).not.toContain('data-wall');
  });

  it('suit la hauteur sous plafond du document', () => {
    const doc = { ...docOf([r]), ceiling: 300 };
    const scene = renderElevation(doc, r, north(), { interactive: false });
    expect(scene.ceilingCm).toBe(300);
    const a = scene.toPx(0, 0).y;
    const b = scene.toPx(0, 300).y;
    expect(a - b).toBeCloseTo(300 * 1.2);
  });
});

describe('contrôles d’un mur', () => {
  const r = room(1, 0, 0, 200, 100);
  const north = roomFaces(r).find((f) => f.key === 'N0')!;

  it('signale une prise posée au ras du sol', () => {
    const doc = docOf([r, sym(2, 'prise', 50, 0, 2)]);
    const checks = runWallChecks(doc, r, north);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ severity: 'warn', itemId: 2 });
    expect(checks[0]!.message).toContain(String(MIN_SOCKET_HEIGHT));
  });

  it('signale une commande trop haute, sans alerte pour une hauteur usuelle', () => {
    const doc = docOf([r, sym(2, 'inter', 50, 0, 160), sym(3, 'inter', 80, 0), sym(4, 'prise', 120, 0)]);
    const checks = runWallChecks(doc, r, north);
    expect(checks.map((c) => c.itemId)).toEqual([2]);
    expect(checks[0]!.message).toContain(String(MAX_SWITCH_HEIGHT));
  });
});

describe('navigation vers les murs et la 3D', () => {
  const r = room(1, 0, 0, 200, 100);

  it('ouvre l’éditeur de murs sur la face et sélectionne l’appareil', () => {
    const store = new Store(docOf([r, sym(2, 'prise', 50, 0)]));
    expect(showItemOnWall(store, 2)).toBe(true);
    expect(store.state.mode).toBe('walls');
    expect(store.state.wallFace).toEqual({ roomId: 1, key: 'N0' });
    expect(store.state.selection).toBe(2);
  });

  it('refuse un appareil de plafond ou hors d’un mur', () => {
    const store = new Store(docOf([r, sym(2, 'lampe', 50, 0), sym(3, 'prise', 100, 50)]));
    expect(showItemOnWall(store, 2)).toBe(false);
    expect(showItemOnWall(store, 3)).toBe(false);
    expect(showItemOnWall(store, 99)).toBe(false);
    expect(store.state.mode).toBe('plan');
  });

  it('showWall choisit une face précise, showItemIn3D ouvre la vue 3D', () => {
    const store = new Store(docOf([r, sym(2, 'prise', 50, 0)]));
    showWall(store, 1, 'S0');
    expect(store.state).toMatchObject({ mode: 'walls', wallFace: { roomId: 1, key: 'S0' }, selection: null });
    showItemIn3D(store, 2);
    expect(store.state).toMatchObject({ mode: 'view3d', selection: 2 });
  });

  it('un nouveau document réinitialise la face affichée', () => {
    const store = new Store(docOf([r]));
    showWall(store, 1, 'E0');
    store.reset(createDoc());
    expect(store.state.wallFace).toBeNull();
  });
});

describe('fiche exportée', () => {
  const r = room(1, 0, 0, 200, 100);

  it('ajoute les élévations des seuls murs équipés', () => {
    const doc = docOf([
      r,
      sym(2, 'prise', 50, 0),
      sym(3, 'inter', 150, 100),
      sym(4, 'fenetre', 200, 50), // une ouverture seule n'équipe pas un mur
    ]);
    const walls = buildPlanSections(doc).find((x) => x.title === 'Élévations des murs');
    expect(walls).toBeDefined();
    expect(walls!.svg).toContain('Mur nord');
    expect(walls!.svg).toContain('Mur sud');
    expect(walls!.svg).not.toContain('Mur est');
    expect(walls!.svg).not.toContain('Mur ouest');
  });

  it('n’ajoute rien quand aucun mur n’est équipé', () => {
    const doc = docOf([r, sym(2, 'lampe', 100, 50), sym(3, 'fenetre', 200, 50)]);
    expect(buildPlanSections(doc).some((x) => x.title === 'Élévations des murs')).toBe(false);
    expect(buildExportSvg(doc, new Date(2026, 0, 1))).not.toContain('Élévations');
  });
});
