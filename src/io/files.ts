import { buildExportSvg } from './exporter';
import { parseDoc } from '../domain/document';
import type { Doc } from '../domain/types';
import { esc } from '../util/escape';

/** Nom de fichier sûr dérivé du nom du projet. */
export const fileName = (doc: Doc, ext: string): string =>
  `${doc.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'schema'}.${ext}`;

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function saveJson(doc: Doc): void {
  download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), fileName(doc, 'json'));
}

export function exportSvg(doc: Doc): void {
  download(new Blob([buildExportSvg(doc)], { type: 'image/svg+xml' }), fileName(doc, 'svg'));
}

export function exportPng(doc: Doc, scale = 2): void {
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
    canvas.toBlob((blob) => blob && download(blob, fileName(doc, 'png')), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildExportSvg(doc));
}

/** Ouvre le plan dans une fenêtre d'impression (choisir « Enregistrer en PDF »). */
export function exportPdf(doc: Doc): void {
  const w = window.open('', '_blank');
  if (!w) {
    alert('Autorisez les fenêtres pop-up pour exporter en PDF.');
    return;
  }
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.name)}</title>` +
      `<style>@page{size:A4 landscape;margin:10mm}body{margin:0;display:flex;justify-content:center}` +
      `svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${buildExportSvg(doc)}` +
      `<script>onload=()=>setTimeout(()=>print(),200)</script></body></html>`,
  );
  w.document.close();
}

/** Lit un fichier .json choisi par l'utilisateur. Rejette si le contenu est invalide. */
export function readDocFile(file: File): Promise<Doc> {
  return file.text().then((text) => parseDoc(JSON.parse(text)));
}
