import { deviceSpec } from '../domain/board/bom';
import { getDeviceDef } from '../domain/board/catalog';
import { analyze, devicesInRow, deviceWidth, effectiveSection, isCircuitRole } from '../domain/board/layout';
import type { Board } from '../domain/board/types';
import { allLinks, linksSummary } from '../domain/link/links';
import { allPoints, pointRefs } from '../domain/points';
import { buildQuote, fmtMoney } from '../domain/quote';
import { JOB_KINDS, rulesOf } from '../domain/rules';
import type { Doc } from '../domain/types';
import { renderBoard } from '../render/board/boardSvg';
import { renderSchema } from '../render/schema/unifilaire';
import { esc } from '../util/escape';
import { buildBoardSections } from './boardSheet';
import {
  cablesSection,
  legendSection,
  materialsSection,
  planSection,
  pointsSection,
  wallsSection,
} from './exporter';
import { downloadPng, downloadSvg, printHtml, safeName } from './files';
import { table, type SheetSection } from './sheet';

/**
 * Les documents du dossier : ce que l'électricien remet au contrôleur ou au client. Chacun est
 * généré depuis les mêmes points et les mêmes circuits, avec le même cartouche.
 */

export interface DossierDoc {
  /** Identifiant stable (« unifilaire », « position », « labels »…). */
  key: string;
  title: string;
  /** À quoi sert ce document, en une ligne. */
  hint: string;
  /** Regroupement dans la liste : contrôle, chantier, client. */
  group: 'controle' | 'chantier' | 'client';
  sections: SheetSection[];
  /** Coché par défaut dans le dossier à imprimer. */
  included: boolean;
  /** Zone de signature sous le cartouche (schémas remis au contrôle). */
  signed?: boolean;
}

const FONT = 'Arial,sans-serif';
const fmtSection = (s: number): string => `${String(s).replace('.', ',')} mm²`;

/** Date du document : celle saisie pour le chantier, sinon aujourd'hui. */
export function docDate(doc: Doc, now = new Date()): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(doc.project.date) ? new Date(`${doc.project.date}T12:00:00`) : now;
  return d.toLocaleDateString('fr-FR');
}

// ---------------------------------------------------------------- sections propres au dossier

/** Schéma unifilaire : un par tableau. */
function unifilaireSections(doc: Doc): SheetSection[] {
  return doc.boards.map((b) => {
    const r = renderSchema(doc, b);
    return { key: `uni:${b.id}`, title: `${b.name}${b.location ? ` — ${b.location}` : ''}`, svg: r.svg, width: r.width, height: r.height, grow: true };
  });
}

/** Repérage : un tableau par tableau électrique, circuit par circuit. */
function circuitTables(doc: Doc): SheetSection[] {
  const rules = rulesOf(doc);
  const links = allLinks(doc);
  return doc.boards
    .map((b): SheetSection | null => {
      const a = analyze(b, rules.refScheme);
      if (a.circuits.length === 0) return null;
      const t = table(
        1200,
        [
          { title: 'Repère', frac: 0.06, get: (d) => a.refs.get(d.id) ?? '' },
          { title: 'Désignation', frac: 0.2, get: (d) => d.label },
          { title: 'Protection', frac: 0.13, get: (d) => deviceSpec(d) },
          {
            title: 'Différentiel',
            frac: 0.13,
            get: (d) => {
              const rcd = a.protectedBy.get(d.id) ?? null;
              if (!rcd) return '—';
              return rcd.id === d.id ? 'intégré' : `${a.refs.get(rcd.id)} · ${rcd.sensitivity ?? 30} mA`;
            },
          },
          {
            title: 'Câble',
            frac: 0.13,
            get: (d) => {
              const s = effectiveSection(d);
              return s === null ? '' : `${d.cable ?? doc.project.cable} 3G${String(s).replace('.', ',')}`;
            },
          },
          { title: 'Points raccordés', frac: 0.17, get: (d) => (links.get(d.id) ? linksSummary(links.get(d.id)!) : '—') },
          { title: 'Pièces', frac: 0.18, get: (d) => (links.get(d.id)?.rooms ?? []).map((r) => r.label).join(', ') || d.dest },
        ],
        a.circuits,
      );
      return { key: `rep:${b.id}`, title: b.name, svg: t.svg, width: 1200, height: t.height };
    })
    .filter((s): s is SheetSection => s !== null);
}

/** Largeur d'un module, en dixièmes de millimètre : les étiquettes s'impriment à taille réelle. */
const MODULE = 175;
const LABEL_H = 130;
/** Nombre de modules par bande : une bande tient sur une feuille A4 en paysage. */
const STRIP_MODULES = 15;

/** Étiquettes du tableau : une bande par rail, à coller sous les appareils (17,5 mm par module). */
function labelSections(doc: Doc): SheetSection[] {
  const rules = rulesOf(doc);
  const out: SheetSection[] = [];
  for (const b of doc.boards) {
    const a = analyze(b, rules.refScheme);
    for (let row = 0; row < b.rows; row++) {
      const devices = devicesInRow(b, row);
      if (devices.length === 0) continue;
      for (let from = 0; from < b.cols; from += STRIP_MODULES) {
        const to = Math.min(b.cols, from + STRIP_MODULES);
        const inside = devices.filter((d) => d.col < to && d.col + deviceWidth(d) > from);
        if (inside.length === 0) continue;
        const w = (to - from) * MODULE;
        let s = `<rect x="0" y="0" width="${w}" height="${LABEL_H}" fill="#fff" stroke="#111" stroke-width="2"/>`;
        for (const d of inside) {
          const x0 = (Math.max(d.col, from) - from) * MODULE;
          const x1 = (Math.min(d.col + deviceWidth(d), to) - from) * MODULE;
          const cw = x1 - x0;
          const def = getDeviceDef(d.kind);
          const ref = a.refs.get(d.id) ?? '';
          const circuit = def !== undefined && isCircuitRole(def);
          s += `<rect x="${x0}" y="0" width="${cw}" height="${LABEL_H}" fill="none" stroke="#111" stroke-width="1.5"/>`;
          s += `<text x="${x0 + cw / 2}" y="46" font-size="${circuit ? 44 : 30}" font-weight="700" font-family="${FONT}" text-anchor="middle" fill="#111">${esc(ref)}</text>`;
          // Le texte est coupé à la largeur de l'étiquette (environ 11 dixièmes de mm par caractère).
          const max = Math.max(3, Math.floor(cw / 11.5));
          const words = (d.label || (circuit ? '' : (def?.short ?? ''))).split(/\s+/).filter(Boolean);
          const lines: string[] = [];
          let cur = '';
          for (const wd of words) {
            if (cur && (cur + ' ' + wd).length > max) {
              lines.push(cur);
              cur = wd;
            } else cur = cur ? `${cur} ${wd}` : wd;
          }
          if (cur) lines.push(cur);
          lines.slice(0, 3).forEach((l, i) => {
            s += `<text x="${x0 + cw / 2}" y="${72 + i * 21}" font-size="19" font-family="${FONT}" text-anchor="middle" fill="#111">${esc(l.slice(0, max))}</text>`;
          });
        }
        const part = b.cols > STRIP_MODULES ? ` (modules ${from + 1} à ${to})` : '';
        out.push({
          key: `lab:${b.id}:${row}:${from}`,
          title: `${b.name} · rail ${row + 1}${part}`,
          svg: s,
          width: w,
          height: LABEL_H,
          mm: { w: w / 10, h: LABEL_H / 10 },
        });
      }
    }
  }
  return out;
}

/** Devis au point : quantités, prix unitaires, totaux. */
function quoteSection(doc: Doc): SheetSection | null {
  const q = buildQuote(doc);
  if (q.lines.length === 0) return null;
  interface Row {
    label: string;
    qty: string;
    unit: string;
    total: string;
    bold?: boolean;
  }
  const rows: Row[] = q.lines.map((l) => ({ label: l.label, qty: String(l.qty), unit: fmtMoney(l.unit), total: fmtMoney(l.total) }));
  rows.push({ label: 'Total hors taxes', qty: '', unit: '', total: fmtMoney(q.subtotal), bold: true });
  rows.push({ label: `TVA ${String(q.vatRate).replace('.', ',')} %`, qty: '', unit: '', total: fmtMoney(q.vat) });
  rows.push({ label: 'Total toutes taxes comprises', qty: '', unit: '', total: fmtMoney(q.total), bold: true });
  const t = table(
    1000,
    [
      { title: 'Désignation', frac: 0.55, get: (r) => r.label },
      { title: 'Quantité', frac: 0.12, get: (r) => r.qty },
      { title: 'Prix unitaire HT', frac: 0.16, get: (r) => r.unit },
      { title: 'Total HT', frac: 0.17, get: (r) => r.total },
    ],
    rows,
  );
  return { key: 'quote', title: 'Estimation au point', svg: t.svg, width: 1000, height: t.height };
}

/** Légende des circuits : repère, désignation et protection, à lire avec le schéma de position. */
function circuitLegend(doc: Doc): SheetSection | null {
  const rules = rulesOf(doc);
  interface Row {
    ref: string;
    label: string;
    spec: string;
    board: string;
  }
  const rows: Row[] = [];
  for (const b of doc.boards) {
    const a = analyze(b, rules.refScheme);
    for (const d of a.circuits) {
      const s = effectiveSection(d);
      rows.push({
        ref: a.refs.get(d.id) ?? '',
        label: d.label,
        spec: `${deviceSpec(d)}${s === null ? '' : ` · ${fmtSection(s)}`}`,
        board: b.name,
      });
    }
  }
  if (rows.length === 0) return null;
  const many = doc.boards.length > 1;
  const t = table(
    1000,
    [
      { title: 'Circuit', frac: 0.1, get: (r) => r.ref },
      { title: 'Désignation', frac: many ? 0.4 : 0.55, get: (r) => r.label },
      { title: 'Protection et section', frac: 0.35, get: (r) => r.spec },
      ...(many ? [{ title: 'Tableau', frac: 0.15, get: (r: Row) => r.board }] : []),
    ],
    rows,
  );
  return { key: 'legend:circuits', title: 'Circuits', svg: t.svg, width: 1000, height: t.height };
}

function frontSections(doc: Doc): SheetSection[] {
  const rules = rulesOf(doc);
  return doc.boards.map((b: Board) => {
    const r = renderBoard(b, { interactive: false, scheme: rules.refScheme });
    return { key: `front:${b.id}`, title: `${b.name}${b.location ? ` — ${b.location}` : ''}`, svg: r.svg, width: r.width, height: r.height };
  });
}

// ---------------------------------------------------------------- liste des documents

const present = (list: (SheetSection | null)[]): SheetSection[] => list.filter((s): s is SheetSection => s !== null);

/** Tous les documents que le chantier permet de produire, dans l'ordre du dossier. */
export function dossierDocs(doc: Doc): DossierDoc[] {
  const rules = rulesOf(doc);
  const refs = pointRefs(doc);
  const hasPoints = allPoints(doc).length > 0;
  const hasRooms = doc.items.some((i) => i.type === 'room');
  const be = rules.country === 'BE';
  const docs: DossierDoc[] = [];

  const add = (d: Omit<DossierDoc, 'sections'> & { sections: SheetSection[] }): void => {
    if (d.sections.length > 0) docs.push(d);
  };

  add({
    key: 'unifilaire',
    title: rules.docs.unifilaire,
    hint: be ? 'Exigé par le RGIE : circuits, protections, câbles et points repérés.' : 'Circuits, protections, câbles et points alimentés.',
    group: 'controle',
    sections: unifilaireSections(doc),
    included: true,
    signed: true,
  });
  add({
    key: 'position',
    title: rules.docs.position,
    hint: be ? 'Exigé par le RGIE : emplacement de chaque point, avec les mêmes repères.' : 'Emplacement de chaque point, avec les mêmes repères.',
    group: 'controle',
    sections: hasRooms ? present([planSection(doc, refs), legendSection(doc), circuitLegend(doc)]) : [],
    included: true,
    signed: true,
  });
  add({
    key: 'reperage',
    title: 'Repérage des circuits',
    hint: 'Tableau des circuits : protection, différentiel, câble, points et pièces.',
    group: 'controle',
    sections: circuitTables(doc),
    included: true,
  });
  add({
    key: 'labels',
    title: 'Étiquettes du tableau',
    hint: 'À l’échelle 1 (17,5 mm par module) : imprimez à 100 %, découpez, collez.',
    group: 'chantier',
    sections: labelSections(doc),
    included: false,
  });
  add({
    key: 'points',
    title: 'Liste des points par pièce',
    hint: 'Chaque point avec son repère, son mur, sa hauteur et son circuit.',
    group: 'chantier',
    sections: hasPoints ? present([pointsSection(doc)]) : [],
    included: false,
  });
  add({
    key: 'front',
    title: 'Face avant du tableau',
    hint: 'Implantation des appareils sur les rails, et nomenclature.',
    group: 'chantier',
    sections: [
      ...frontSections(doc),
      ...doc.boards.flatMap((b) => buildBoardSections(b, doc).filter((s) => s.key === 'bom').map((s) => ({ ...s, key: `bom:${b.id}`, title: `${b.name} · ${s.title}` }))),
    ],
    included: false,
  });
  add({
    key: 'murs',
    title: 'Élévations des murs',
    hint: 'Position et hauteur de chaque appareil, mur par mur.',
    group: 'chantier',
    sections: present([wallsSection(doc)]),
    included: false,
  });
  add({
    key: 'devis',
    title: 'Estimation au point',
    hint: 'Quantités et prix unitaires : un ordre de prix pour le client.',
    group: 'client',
    sections: present([quoteSection(doc)]),
    included: false,
  });
  add({
    key: 'materiel',
    title: 'Matériel et câbles',
    hint: 'Appareillage à commander et câble à prévoir par section.',
    group: 'client',
    sections: present([materialsSection(doc), cablesSection(doc)]),
    included: false,
  });
  return docs;
}

export const DOC_GROUPS: Readonly<Record<DossierDoc['group'], string>> = {
  controle: 'Pour le contrôle',
  chantier: 'Pour le chantier',
  client: 'Pour le client',
};

// ---------------------------------------------------------------- cartouche

export interface Cartouche {
  title: string;
  rows: [string, string][];
}

/** Cartouche d'un document : ce qui l'identifie (chantier, adresse, client, installateur, date). */
export function cartouche(doc: Doc, d: DossierDoc, now = new Date()): Cartouche {
  const rules = rulesOf(doc);
  const p = doc.project;
  return {
    title: d.title,
    rows: [
      ['Chantier', doc.name],
      ['Adresse de l’installation', p.address || '—'],
      ['Client', p.client || '—'],
      ['Installateur', p.installer || '—'],
      ['Nature des travaux', JOB_KINDS[p.kind]],
      ['Date', docDate(doc, now)],
      ['Référentiel', rules.code],
    ],
  };
}

const PAGE_W = 1260;
const PAD = 30;

/** Un document en un seul SVG (aperçu à l'écran, export PNG ou SVG). */
export function documentSvg(doc: Doc, d: DossierDoc, now = new Date()): string {
  const c = cartouche(doc, d, now);
  const inner = PAGE_W - PAD * 2;
  let y = PAD;
  let out = '';

  // Titre à gauche, cartouche à droite.
  const boxW = 520;
  const rowH = 19;
  const boxH = c.rows.length * rowH + 8;
  out += `<text x="${PAD}" y="${y + 26}" font-size="26" font-weight="700" font-family="${FONT}" fill="#111">${esc(c.title)}</text>`;
  out += `<text x="${PAD}" y="${y + 48}" font-size="13" font-family="${FONT}" fill="#5b6474">${esc(doc.name)}</text>`;
  const bx = PAGE_W - PAD - boxW;
  out += `<rect x="${bx}" y="${y}" width="${boxW}" height="${boxH}" fill="#fff" stroke="#1f2430" stroke-width="1.2"/>`;
  c.rows.forEach(([k, v], i) => {
    const ry = y + 4 + i * rowH;
    if (i > 0) out += `<line x1="${bx}" y1="${ry}" x2="${bx + boxW}" y2="${ry}" stroke="#c4cbd6"/>`;
    out += `<text x="${bx + 8}" y="${ry + 14}" font-size="10.5" font-family="${FONT}" fill="#5b6474">${esc(k)}</text>`;
    out += `<text x="${bx + 170}" y="${ry + 14}" font-size="11" font-weight="700" font-family="${FONT}" fill="#111">${esc(v.slice(0, 58))}</text>`;
  });
  out += `<line x1="${bx + 162}" y1="${y}" x2="${bx + 162}" y2="${y + boxH}" stroke="#c4cbd6"/>`;
  y += Math.max(boxH, 60) + 22;

  for (const sec of d.sections) {
    out += `<text x="${PAD}" y="${y + 14}" font-size="15" font-weight="700" font-family="${FONT}" fill="#1f2430">${esc(sec.title)}</text>`;
    out += `<line x1="${PAD}" y1="${y + 22}" x2="${PAGE_W - PAD}" y2="${y + 22}" stroke="#cfd5df"/>`;
    y += 34;
    // Un schéma étroit est agrandi (jusqu'à 1,6 fois) pour rester lisible sur la page.
    const scale = Math.min(sec.grow ? 1.6 : 1, inner / sec.width);
    out += `<g transform="translate(${PAD} ${y}) scale(${scale})">${sec.svg}</g>`;
    y += sec.height * scale + 28;
  }

  if (d.signed) {
    const w = 360;
    out += `<rect x="${PAD}" y="${y}" width="${w}" height="74" fill="none" stroke="#1f2430"/>`;
    out += `<text x="${PAD + 8}" y="${y + 16}" font-size="10.5" font-family="${FONT}" fill="#5b6474">Date et signature du responsable des travaux</text>`;
    out += `<rect x="${PAD + w + 20}" y="${y}" width="${w}" height="74" fill="none" stroke="#1f2430"/>`;
    out += `<text x="${PAD + w + 28}" y="${y + 16}" font-size="10.5" font-family="${FONT}" fill="#5b6474">Date et signature du propriétaire ou de l’exploitant</text>`;
    y += 74 + 14;
  }

  const height = Math.round(y + PAD - 10);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${height}" viewBox="0 0 ${PAGE_W} ${height}">` +
    `<rect width="100%" height="100%" fill="#fff"/>${out}</svg>`
  );
}

/** Page d'impression : un document par page, cartouche en tête, étiquettes à taille réelle. */
export function printDocuments(doc: Doc, docs: DossierDoc[], now = new Date()): void {
  const css =
    `@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:${FONT};color:#111}` +
    `article{break-after:page}article:last-child{break-after:auto}` +
    `header{display:flex;justify-content:space-between;gap:10mm;align-items:flex-start;margin-bottom:5mm}` +
    `h1{font-size:20px;margin:0 0 2px}header p{margin:0;color:#5b6474;font-size:11px}` +
    `table.c{border-collapse:collapse;font-size:10px;min-width:95mm}table.c td{border:1px solid #9aa3b2;padding:2px 6px}` +
    `table.c td:first-child{color:#5b6474;white-space:nowrap}table.c td:last-child{font-weight:700}` +
    `h2{font-size:13px;margin:0 0 4px;border-bottom:1px solid #cfd5df;padding-bottom:3px}` +
    `section{break-inside:avoid;margin-bottom:5mm}svg{display:block;width:100%;height:auto;max-height:160mm}` +
    `svg.real{max-height:none}.sign{display:flex;gap:8mm;margin-top:6mm}.sign div{flex:1;height:22mm;border:1px solid #1f2430;padding:2mm;font-size:10px;color:#5b6474}` +
    `.note{font-size:10px;color:#5b6474;margin:0 0 3mm}`;

  const body = docs
    .map((d) => {
      const c = cartouche(doc, d, now);
      const sections = d.sections
        .map((s) => {
          const size = s.mm ? ` class="real" style="width:${s.mm.w}mm;height:${s.mm.h}mm"` : '';
          return `<section><h2>${esc(s.title)}</h2><svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 ${s.width} ${s.height}">${s.svg}</svg></section>`;
        })
        .join('');
      const real = d.sections.some((s) => s.mm) ? '<p class="note">Imprimer à 100 % (taille réelle, sans « ajuster à la page ») : un module mesure 17,5 mm.</p>' : '';
      const sign = d.signed
        ? '<div class="sign"><div>Date et signature du responsable des travaux</div><div>Date et signature du propriétaire ou de l’exploitant</div></div>'
        : '';
      return (
        `<article><header><div><h1>${esc(c.title)}</h1><p>${esc(doc.name)}</p></div>` +
        `<table class="c">${c.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></header>` +
        `${real}${sections}${sign}</article>`
      );
    })
    .join('');
  printHtml(`${doc.name} - dossier`, css, body);
}

export const exportDocumentSvg = (doc: Doc, d: DossierDoc): void =>
  downloadSvg(documentSvg(doc, d), safeName(`${doc.name} - ${d.title}`, 'svg'));

export const exportDocumentPng = (doc: Doc, d: DossierDoc): void =>
  downloadPng(documentSvg(doc, d), safeName(`${doc.name} - ${d.title}`, 'png'));
