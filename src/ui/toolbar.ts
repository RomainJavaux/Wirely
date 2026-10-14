import type { Cloud } from '../cloud/cloud';
import type { Store } from '../core/store';
import { createDoc, parseDoc } from '../domain/document';
import { exportBoardCsv, exportBoardPdf, exportBoardPng, exportBoardSvg } from '../io/boardSheet';
import { exportPdf, exportPlanBomCsv, exportPlanRoomsCsv, exportPng, exportSvg, readDocFile, saveJson } from '../io/files';
import { qs } from './dom';

/** Barre du haut : nom du projet, historique, fichiers et export. */
export class Toolbar {
  private readonly nameEl = qs<HTMLInputElement>('#docName');
  private readonly undoEl = qs<HTMLButtonElement>('#undo');
  private readonly redoEl = qs<HTMLButtonElement>('#redo');
  private readonly menuEl = qs<HTMLElement>('#exportMenu');
  private readonly fileEl = qs<HTMLInputElement>('#fileIn');

  constructor(
    private readonly store: Store,
    private readonly cloud: Cloud,
    private readonly fit: () => void,
  ) {
    this.undoEl.onclick = () => store.undo();
    this.redoEl.onclick = () => store.redo();

    this.nameEl.oninput = () => store.change((s) => (s.doc.name = this.nameEl.value));
    this.nameEl.onchange = () => store.commit();

    qs<HTMLButtonElement>('#saveDoc').onclick = () => saveJson(store.state.doc);
    qs<HTMLButtonElement>('#newDoc').onclick = () => this.newDoc();
    qs<HTMLButtonElement>('#openDoc').onclick = () => this.fileEl.click();
    this.fileEl.onchange = () => this.openFile();

    qs<HTMLButtonElement>('#exportBtn').onclick = (e) => {
      e.stopPropagation();
      this.menuEl.classList.toggle('open');
    };
    document.addEventListener('click', () => this.menuEl.classList.remove('open'));
    this.menuEl.addEventListener('click', (e) => {
      const kind = (e.target as Element).closest<HTMLElement>('[data-exp]')?.dataset.exp;
      const doc = store.state.doc;
      const board = store.activeBoard;
      if (store.state.mode === 'board') {
        if (!board) return;
        if (kind === 'png') exportBoardPng(doc, board);
        else if (kind === 'svg') exportBoardSvg(doc, board);
        else if (kind === 'pdf') exportBoardPdf(doc, board);
        else if (kind === 'csv') exportBoardCsv(board);
      } else if (kind === 'png') exportPng(doc);
      else if (kind === 'svg') exportSvg(doc);
      else if (kind === 'pdf') exportPdf(doc);
      else if (kind === 'csv') exportPlanRoomsCsv(doc);
      else if (kind === 'csv2') exportPlanBomCsv(doc);
    });

    store.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    this.menuEl.classList.toggle('board-mode', this.store.state.mode === 'board');
    const csv = document.querySelector<HTMLElement>('#csvBtn');
    if (csv) csv.textContent = this.store.state.mode === 'board' ? 'Circuits (CSV)' : 'Pièces (CSV)';
    this.undoEl.disabled = !this.store.canUndo;
    this.redoEl.disabled = !this.store.canRedo;
    if (document.activeElement !== this.nameEl) this.nameEl.value = this.store.state.doc.name;
  }

  private newDoc(): void {
    const { doc } = this.store.state;
    const online = this.cloud.remote.kind !== 'local';
    if (!online && doc.items.length && !confirm('Créer un nouveau projet ? Le projet actuel sera remplacé (vous pouvez annuler ensuite avec Ctrl+Z).')) return;
    // Un schéma en ligne n'est jamais remplacé : on repart d'un brouillon local.
    if (online) this.cloud.leaveToLocal();
    this.store.replaceDoc(createDoc());
    this.fit();
  }

  private async openFile(): Promise<void> {
    const file = this.fileEl.files?.[0];
    this.fileEl.value = '';
    if (!file) return;
    try {
      const doc = parseDoc(await readDocFile(file));
      // Idem : le fichier ouvert devient un brouillon local, il n'écrase pas le schéma en ligne.
      if (this.cloud.remote.kind !== 'local') this.cloud.leaveToLocal();
      this.store.replaceDoc(doc);
      this.fit();
    } catch {
      alert('Fichier invalide.');
    }
  }
}
