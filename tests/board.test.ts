import { describe, expect, it } from 'vitest';
import { circuitRows, circuitsCsv, bomLines, outputRows } from '../src/domain/board/bom';
import { getDeviceDef } from '../src/domain/board/catalog';
import { runChecks } from '../src/domain/board/checks';
import { analyze, canPlace, compactDevices, createDevice, deviceWidth, firstFreeSlot } from '../src/domain/board/layout';
import { parseBoards } from '../src/domain/board/parse';
import { buildBoard } from '../src/domain/board/templates';
import type { Board } from '../src/domain/board/types';
import { createDoc, parseDoc } from '../src/domain/document';
import { buildBoardSheetSvg } from '../src/io/boardSheet';

let id = 100;
const next = () => id++;
const dev = (kind: string, row: number, col: number, patch = {}) => {
  const def = getDeviceDef(kind);
  if (!def) throw new Error(kind);
  return createDevice(def, next(), row, col, patch);
};
const board = (devices: Board['devices'], over: Partial<Board> = {}): Board => ({
  id: 1, name: 'T', location: '', supply: 'mono', cols: 13, rows: 2, devices, ...over,
});

describe('placement sur les rails', () => {
  it('refuse un chevauchement et un dépassement', () => {
    const b = board([dev('idiff', 0, 0)]); // 2 modules : 0 et 1
    expect(canPlace(b, 0, 1, 1)).toBe(false);
    expect(canPlace(b, 0, 2, 1)).toBe(true);
    expect(canPlace(b, 0, 12, 2)).toBe(false);
    expect(canPlace(b, 2, 0, 1)).toBe(false);
  });

  it('ignore l’appareil déplacé lui-même', () => {
    const d = dev('disj', 0, 3);
    expect(canPlace(board([d]), 0, 3, 1, d.id)).toBe(true);
  });

  it('trouve le premier emplacement libre', () => {
    const b = board([dev('disj', 0, 0), dev('disj', 0, 1)]);
    expect(firstFreeSlot(b, 1)).toEqual({ row: 0, col: 2 });
    expect(firstFreeSlot(board([], { cols: 6, rows: 1 }), 7)).toBeNull();
  });

  it('compacte chaque rail en conservant l’ordre', () => {
    const b = board([dev('disj', 0, 5, { label: 'b' }), dev('disj', 0, 2, { label: 'a' }), dev('idiff', 1, 4)]);
    const out = compactDevices(b);
    expect(out.filter((d) => d.row === 0).map((d) => [d.label, d.col])).toEqual([['a', 0], ['b', 1]]);
    expect(out.find((d) => d.row === 1)?.col).toBe(0);
  });

  it('utilise la largeur de la variante', () => {
    expect(deviceWidth(dev('disj', 0, 0, { variant: '3P' }))).toBe(3);
    expect(deviceWidth(dev('agcp', 0, 0))).toBe(3);
  });
});

describe('analyse électrique', () => {
  it('un différentiel protège les disjoncteurs à sa droite jusqu’au suivant', () => {
    const id1 = dev('idiff', 0, 0);
    const a1 = dev('disj', 0, 2);
    const id2 = dev('idiff', 0, 3);
    const a2 = dev('disj', 0, 5);
    const a = analyze(board([id1, a1, id2, a2]));
    expect(a.protectedBy.get(a1.id)?.id).toBe(id1.id);
    expect(a.protectedBy.get(a2.id)?.id).toBe(id2.id);
  });

  it('un disjoncteur sans différentiel amont n’est pas protégé', () => {
    const d = dev('disj', 0, 0);
    expect(analyze(board([d])).protectedBy.get(d.id)).toBeNull();
  });

  it('le différentiel d’un rail ne protège pas le rail suivant', () => {
    const d = dev('disj', 1, 0);
    expect(analyze(board([dev('idiff', 0, 0), d])).protectedBy.get(d.id)).toBeNull();
  });

  it('numérote les circuits dans l’ordre rail par rail', () => {
    const a = dev('disj', 1, 0);
    const b = dev('disj', 0, 4);
    const c = dev('disj', 0, 1);
    const refs = analyze(board([a, b, c])).refs;
    expect([c, b, a].map((d) => refs.get(d.id))).toEqual(['1', '2', '3']);
  });
});

describe('contrôles', () => {
  const codes = (b: Board) => runChecks(b).map((c) => `${c.severity}:${c.message}`);

  it('signale un calibre trop élevé pour la section', () => {
    const b = board([dev('idiff', 0, 0), dev('disj', 0, 2, { rating: 32, section: 1.5, label: 'Four' })]);
    expect(codes(b).some((m) => m.startsWith('error:') && m.includes('trop élevé'))).toBe(true);
  });

  it('accepte une section déduite automatiquement', () => {
    const b = board([dev('idiff', 0, 0), dev('disj', 0, 2, { rating: 32, label: 'Four' })]);
    expect(codes(b).some((m) => m.includes('trop élevé'))).toBe(false);
  });

  it('signale l’absence de différentiel en amont', () => {
    const b = board([dev('disj', 0, 0, { label: 'x' })]);
    expect(codes(b).some((m) => m.includes('aucun différentiel'))).toBe(true);
  });

  it('signale un différentiel trop chargé', () => {
    const circuits = Array.from({ length: 6 }, (_, i) => dev('disj', 0, 2 + i, { label: `c${i}` }));
    const b = board([dev('idiff', 0, 0, { rating: 25 }), ...circuits]);
    expect(codes(b).some((m) => m.includes('maximum conseillé'))).toBe(true);
  });

  it('rappelle la réserve de 20 % quand le tableau est plein', () => {
    const full = Array.from({ length: 13 }, (_, i) => dev('disj', 0, i, { label: 'x' }));
    const b = board([dev('idiff', 1, 0), ...full], { rows: 1, cols: 13 });
    expect(codes(b).some((m) => m.startsWith('info:Réserve'))).toBe(true);
  });

  it('un exemple de logement est sans erreur bloquante', () => {
    let n = 1;
    const ex = buildBoard('logement', 'Ex', () => n++);
    expect(runChecks(ex).filter((c) => c.severity === 'error')).toEqual([]);
  });
});

describe('documentation', () => {
  const example = (): Board => {
    let n = 1;
    return buildBoard('logement', 'Principal', () => n++);
  };

  it('génère le tableau de repérage des circuits', () => {
    const rows = circuitRows(example());
    expect(rows.length).toBe(12);
    expect(rows[0]).toMatchObject({ ref: '1', label: 'Éclairage', section: '1,5 mm²' });
    expect(rows[4]).toMatchObject({ label: 'Plaque de cuisson', section: '6 mm²' });
  });

  it('regroupe les appareils identiques dans la nomenclature', () => {
    const lines = bomLines(example());
    const total = lines.reduce((s, l) => s + l.qty, 0);
    expect(total).toBe(example().devices.length);
    expect(lines.length).toBeLessThan(total);
  });

  it('exporte un CSV Excel (BOM, séparateur point-virgule, guillemets échappés)', () => {
    const b = board([dev('idiff', 0, 0), dev('disj', 0, 2, { label: 'Prises "salon"; cuisine' })]);
    const csv = circuitsCsv(b);
    expect(csv.startsWith('﻿Repère;Désignation')).toBe(true);
    expect(csv).toContain('"Prises ""salon""; cuisine"');
  });

  it('produit une fiche SVG complète', () => {
    const doc = createDoc('Maison');
    doc.boards.push(example());
    const svg = buildBoardSheetSvg(doc, doc.boards[0] as Board, new Date('2026-01-01'));
    for (const text of ['Principal', 'Face avant', 'Schéma unifilaire', 'Repérage des circuits', 'Nomenclature']) {
      expect(svg).toContain(text);
    }
    expect(svg).not.toContain('data-dev');
  });
});

describe('persistance', () => {
  it('valide et normalise les tableaux', () => {
    const boards = parseBoards([
      { id: 1, name: '', cols: 999, rows: 0, devices: [{ id: 2, kind: 'disj', row: 0, col: 0, variant: 'bidon' }, { id: 3, kind: 'inconnu', row: 0, col: 0 }] },
      'oups',
    ]);
    expect(boards).toHaveLength(1);
    expect(boards[0]).toMatchObject({ name: 'Tableau', cols: 36, rows: 1 });
    expect(boards[0]?.devices).toHaveLength(1);
    expect(boards[0]?.devices[0]?.variant).toBe('1P+N');
  });

  it('un ancien fichier sans tableaux reste lisible, et les ids ne collisionnent pas', () => {
    expect(parseDoc({ name: 'a', items: [] }).boards).toEqual([]);
    const doc = parseDoc({ items: [], boards: [{ id: 40, devices: [{ id: 41, kind: 'disj', row: 0, col: 0 }] }] });
    expect(doc.nextId).toBeGreaterThan(41);
  });
});

describe('modules Niko sur bus', () => {
  it('utilise les largeurs des fiches constructeur', () => {
    const width = (kind: string) => deviceWidth(dev(kind, 0, 0));
    expect(width('nb_sw12')).toBe(14); // 05-000-02
    expect(width('nb_sw4')).toBe(4); // 05-002-02
    expect(width('nb_pclink')).toBe(4); // 05-200
    expect(width('nb_dim')).toBe(14); // 05-007-02, fiche Cebeo : 14E
    expect(width('nb_dim4')).toBe(4); // 05-008-02, fiche Cebeo : 4E
    expect(width('niko_dimmer')).toBe(1); // 330-00700, 17,5 mm
    expect(width('nhc_cc')).toBe(6); // 550-00003
    expect(width('nhc_ps')).toBe(4); // 550-00010
    expect(width('nhc_rc')).toBe(2); // 550-00020
    expect(width('nhc_sw3')).toBe(2); // 550-00103
    expect(width('nhc_sw6')).toBe(4); // 550-00106
  });

  it('chaque module du bus cite sa fiche, et les données incertaines sont signalées', () => {
    for (const kind of ['nb_sw12', 'nb_sw4', 'nb_dim', 'nb_dim4', 'niko_dimmer', 'nb_pclink', 'nhc_cc', 'nhc_ps', 'nhc_rc', 'nhc_sw3', 'nhc_sw6', 'nhc_dim']) {
      const def = getDeviceDef(kind);
      expect(def?.source, kind).toMatch(/^https:\/\//);
      expect(def?.ref, kind).toBeTruthy();
    }
    expect(getDeviceDef('nb_shutter')?.unverified).toBeTruthy();
  });

  it('les modules du bus sont hors des groupes protégés par un différentiel', () => {
    const sw = dev('nb_sw12', 0, 2);
    const a = analyze(board([dev('idiff', 0, 0), sw]));
    expect(a.busModules.map((d) => d.id)).toEqual([sw.id]);
    expect(a.groups[0]?.members).toHaveLength(0);
    expect(a.refs.get(sw.id)).toBe('NB1');
  });

  it('un module à plusieurs sorties se nomme sortie par sortie', () => {
    const sw = dev('nhc_sw3', 0, 0, { outputs: ['Salon', '', 'Cuisine'] });
    const rows = outputRows(board([sw]));
    expect(rows.map((r) => r.output)).toEqual(['1', '2', '3']);
    expect(rows.map((r) => r.label)).toEqual(['Salon', '', 'Cuisine']);
  });

  it('Home Control II : alimentation ou accoupleur obligatoire à gauche du rail', () => {
    const bad = board([dev('nhc_sw3', 0, 0)]);
    expect(runChecks(bad).some((c) => c.severity === 'warn' && c.message.includes('accoupleur'))).toBe(true);

    const ok = board([dev('nhc_rc', 0, 0), dev('nhc_sw3', 0, 2)]);
    expect(runChecks(ok).some((c) => c.message.includes('accoupleur'))).toBe(false);
  });

  it('Home Control II : un seul contrôleur connecté par installation', () => {
    const two = board([dev('nhc_cc', 0, 0), dev('nhc_cc', 1, 0)]);
    expect(runChecks(two).some((c) => c.message.includes('un seul contrôleur'))).toBe(true);
    const none = board([dev('nhc_ps', 0, 0), dev('nhc_sw3', 0, 4)]);
    expect(runChecks(none).some((c) => c.message.includes('aucun contrôleur'))).toBe(true);
  });

  it('Nikobus : aucune règle Home Control appliquée', () => {
    const b = board([dev('nb_sw12', 0, 0)]);
    expect(runChecks(b).some((c) => c.message.includes('Home Control'))).toBe(false);
  });

  it('la fiche inclut les sorties des modules', () => {
    const doc = createDoc('Maison');
    doc.boards.push(board([dev('nb_sw4', 0, 0, { outputs: ['Lustre', 'Applique'] })]));
    const svg = buildBoardSheetSvg(doc, doc.boards[0] as Board, new Date('2026-01-01'));
    expect(svg).toContain('Sorties des modules de commande');
    expect(svg).toContain('Lustre');
  });

  it('les sorties survivent à la sauvegarde', () => {
    const [b] = parseBoards([{ id: 1, devices: [{ id: 2, kind: 'nb_sw4', row: 0, col: 0, outputs: ['A', 7, 'B'] }] }]);
    expect(b?.devices[0]?.outputs).toEqual(['A', 'B']);
  });

  it('le variateur 330-00700 est un appareil autonome, pas un module de bus', () => {
    const rcd = dev('idiff', 0, 0);
    const dimmer = dev('niko_dimmer', 0, 2);
    const a = analyze(board([rcd, dimmer]));
    expect(a.busModules).toHaveLength(0);
    expect(a.groups[0]?.members.map((d) => d.id)).toEqual([dimmer.id]);
  });
});

describe('calibres', () => {
  it('l’interrupteur différentiel propose les calibres 16 A et 32 A', () => {
    const ratings = getDeviceDef('idiff')?.ratings ?? [];
    expect(ratings).toContain(16);
    expect(ratings).toContain(32);
    expect([...ratings]).toEqual([...ratings].sort((a, b) => a - b));
  });
});
