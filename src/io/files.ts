import { buildExportSvg, planSheetHeader } from './exporter';
import { planBomCsv, planRoomsCsv } from '../domain/plan/export';
import { sheetHtml } from './sheet';
import { parseDoc } from '../domain/document';
import type { Doc } from '../domain/types';
import { esc } from '../util/escape';

/** Nom de fichier sûr dérivé d'un nom de projet. */
export const safeName = (name: string, ext: string): string =>
  `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'schema'}.${ext}`;

export const fileName = (doc: Doc, ext: string): string => safeName(doc.name, ext);

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const downloadSvg = (svg: string, name: string): void =>
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), name);

/** Rastérise un SVG autonome (dimensions width/height renseignées) en PNG. */
export function downloadPng(svg: string, name: string, scale = 2): void {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.scale(scale, scale);
    g.drawImage(img, 0, 0);
    canvas.toBlob((blob) => blob && downloadBlob(blob, name), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Ouvre une page dans une nouvelle fenêtre et lance l'impression (choisir « Enregistrer en PDF »). */
export function printHtml(title: string, css: string, body: string): void {
  const w = window.open('', '_blank');
  if (!w) {
    alert('Autorisez les fenêtres pop-up pour exporter en PDF.');
    return;
  }
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head>` +
      `<body>${body}<script>onload=()=>setTimeout(()=>print(),250)</script></body></html>`,
  );
  w.document.close();
}

export function saveJson(doc: Doc): void {
  downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), fileName(doc, 'json'));
}

export const exportSvg = (doc: Doc): void => downloadSvg(buildExportSvg(doc), fileName(doc, 'svg'));
export const exportPng = (doc: Doc): void => downloadPng(buildExportSvg(doc), fileName(doc, 'png'));

/** PDF : une section par bloc (plan, légende, tableaux), sans coupure au milieu d'un tableau. */
export function exportPdf(doc: Doc): void {
  const { css, body } = sheetHtml(planSheetHeader(doc));
  printHtml(doc.name, css, body);
}

const csvBlob = (csv: string): Blob => new Blob([csv], { type: 'text/csv;charset=utf-8' });

export const exportPlanRoomsCsv = (doc: Doc): void =>
  downloadBlob(csvBlob(planRoomsCsv(doc)), safeName(`${doc.name} - pièces`, 'csv'));

export const exportPlanBomCsv = (doc: Doc): void =>
  downloadBlob(csvBlob(planBomCsv(doc)), safeName(`${doc.name} - nomenclature`, 'csv'));

/** Lit un fichier .json choisi par l'utilisateur. Rejette si le contenu est invalide. */
export function readDocFile(file: File): Promise<Doc> {
  return file.text().then((text) => parseDoc(JSON.parse(text)));
}
