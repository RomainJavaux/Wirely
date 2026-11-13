import { describe, expect, it } from 'vitest';
import { addCircuit, createStandardBoard } from '../src/core/circuitActions';
import { setActiveCircuit } from '../src/core/links';
import { connectUnlinked } from '../src/core/planActions';
import { addPoint, addRoomOfKind } from '../src/core/pointActions';
import { Store } from '../src/core/store';
import { analyze } from '../src/domain/board/layout';
import { createDoc } from '../src/domain/document';
import { pointRefs } from '../src/domain/points';
import { cartouche, docDate, documentSvg, dossierDocs } from '../src/io/documents';
import { renderSchema } from '../src/render/schema/unifilaire';

/** Petit chantier belge : cuisine et salle de bains, circuits générés. */
function belgian(): Store {
  const store = new Store(createDoc('Maison Dupont', 'BE'));
  const cuisine = addRoomOfKind(store, 'cuisine')!;
  const sdb = addRoomOfKind(store, 'sdb')!;
  for (let i = 0; i < 5; i++) addPoint(store, cuisine, 'prise');
  addPoint(store, cuisine, 'lampe');
  addPoint(store, cuisine, 'inter');
  addPoint(store, cuisine, 'plaque');
  addPoint(store, sdb, 'prise');
  addPoint(store, sdb, 'lampe');
  connectUnlinked(store);
  store.state.doc.project = { ...store.state.doc.project, client: 'M. Dupont', address: 'Rue Haute 12, 4000 Liège', installer: 'Élec SRL', date: '2026-11-13' };
  return store;
}

describe('schéma unifilaire', () => {
  it('montre le différentiel général, les circuits lettrés, leur câble et leurs points repérés', () => {
    const store = belgian();
    const { doc } = store.state;
    const r = renderSchema(doc, store.activeBoard!);
    expect(r.svg).toContain('Réseau : 230 V');
    expect(r.svg).toContain('Différentiel général');
    expect(r.svg).toContain('Différentiel 30 mA');
    expect(r.svg).toContain('XVB 3G2,5');
    expect(r.svg).toContain('XVB 3G6'); // la taque de cuisson
    expect(r.svg).toContain('× 5'); // les cinq prises de la cuisine
    // Les repères du schéma sont ceux des points.
    const refs = [...pointRefs(doc).values()];
    expect(refs.length).toBeGreaterThan(0);
    expect(r.svg).toMatch(/A1[–,<]/);
    expect(r.width).toBeGreaterThan(600);
    expect(r.height).toBeGreaterThan(300);
  });

  it('un tableau de vingt-cinq circuits se prolonge sur plusieurs lignes, sans s’élargir sans fin', () => {
    const store = new Store(createDoc('Grand', 'BE'));
    createStandardBoard(store);
    const general = analyze(store.activeBoard!).groups[0]!.head!;
    for (let i = 0; i < 25; i++) addCircuit(store, { rating: 20, headId: general.id, label: `Circuit ${i + 1}` });
    const r = renderSchema(store.state.doc, store.activeBoard!);
    expect(r.width).toBeLessThan(1500);
    expect(r.svg).toContain('suite');
    expect(r.svg).toContain('>Y<'); // vingt-cinquième circuit
  });

  it('signale les circuits sans différentiel, et suit la numérotation française', () => {
    const store = new Store(createDoc('FR', 'FR'));
    const room = addRoomOfKind(store, 'sejour')!;
    const c = addCircuit(store, { rating: 16, label: 'Prises séjour' })!;
    setActiveCircuit(store, c);
    addPoint(store, room, 'prise');
    const r = renderSchema(store.state.doc, store.activeBoard!);
    expect(r.svg).toContain('sans différentiel');
    expect(r.svg).toContain('R2V 3G1,5');
    expect(r.svg).toContain('1.1');
  });

  it('un tableau vide reste dessinable', () => {
    const store = new Store(createDoc('Vide', 'BE'));
    createStandardBoard(store);
    expect(() => renderSchema(store.state.doc, store.activeBoard!)).not.toThrow();
  });
});

describe('documents du dossier', () => {
  it('propose les schémas exigés, cochés d’office, avec leurs repères communs', () => {
    const { doc } = belgian().state;
    const docs = dossierDocs(doc);
    const keys = docs.map((d) => d.key);
    expect(keys.slice(0, 3)).toEqual(['unifilaire', 'position', 'reperage']);
    expect(keys).toEqual(expect.arrayContaining(['labels', 'points', 'devis', 'materiel', 'front']));
    expect(docs.filter((d) => d.included).map((d) => d.key)).toEqual(['unifilaire', 'position', 'reperage']);
    expect(docs.find((d) => d.key === 'position')!.title).toBe('Schéma de position');

    // Le même repère figure sur les deux schémas.
    const ref = [...pointRefs(doc).values()][0]!;
    const uni = documentSvg(doc, docs.find((d) => d.key === 'unifilaire')!);
    const pos = documentSvg(doc, docs.find((d) => d.key === 'position')!);
    expect(uni).toContain(ref.replace(/\d+$/, '')); // lettre du circuit
    expect(pos).toContain(`>${ref}<`);
  });

  it('le cartouche reprend les renseignements du chantier, saisis une seule fois', () => {
    const { doc } = belgian().state;
    const d = dossierDocs(doc)[0]!;
    const c = cartouche(doc, d);
    expect(c.title).toBe('Schéma unifilaire');
    expect(Object.fromEntries(c.rows)).toMatchObject({
      Chantier: 'Maison Dupont',
      'Adresse de l’installation': 'Rue Haute 12, 4000 Liège',
      Client: 'M. Dupont',
      Installateur: 'Élec SRL',
      Référentiel: 'RGIE',
    });
    expect(docDate(doc)).toBe(new Date('2026-11-13T12:00:00').toLocaleDateString('fr-FR'));
    const svg = documentSvg(doc, d);
    expect(svg).toContain('Rue Haute 12');
    expect(svg).toContain('signature du responsable des travaux');
  });

  it('les étiquettes sont à l’échelle : 17,5 mm par module, une bande par rail', () => {
    const store = belgian();
    const labels = dossierDocs(store.state.doc).find((d) => d.key === 'labels')!;
    const board = store.activeBoard!;
    expect(labels.sections.length).toBeGreaterThanOrEqual(2);
    for (const s of labels.sections) {
      expect(s.mm).toBeDefined();
      expect(s.mm!.w / 17.5).toBeCloseTo(Math.round(s.mm!.w / 17.5)); // un nombre entier de modules
      expect(s.mm!.w).toBeLessThanOrEqual(15 * 17.5); // tient sur une feuille A4 en paysage
    }
    expect(board.cols).toBe(18);
    expect(labels.sections.some((s) => s.title.includes('modules 16 à 18')) || labels.sections.length >= 2).toBe(true);
  });

  it('le devis reprend les quantités et la TVA du chantier', () => {
    const { doc } = belgian().state;
    const devis = dossierDocs(doc).find((d) => d.key === 'devis')!;
    const svg = documentSvg(doc, devis);
    expect(svg).toContain('Total hors taxes');
    expect(svg).toContain('TVA 21 %');
    expect(svg).toContain('Taque de cuisson');
  });

  it('en France, le plan s’appelle plan d’implantation ; sans rien, aucun document', () => {
    const fr = new Store(createDoc('FR', 'FR'));
    const room = addRoomOfKind(fr, 'sejour')!;
    addPoint(fr, room, 'prise');
    connectUnlinked(fr);
    expect(dossierDocs(fr.state.doc).find((d) => d.key === 'position')!.title).toBe('Plan d’implantation');
    expect(dossierDocs(createDoc())).toEqual([]);
  });
});
