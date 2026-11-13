import type { Cloud } from '../cloud/cloud';
import { loadExamplePlan } from '../core/actions';
import { setActiveCircuit } from '../core/links';
import type { Store } from '../core/store';
import { createDoc, parseDoc } from '../domain/document';
import { rulesOf } from '../domain/rules';
import { readDocFile, saveJson } from '../io/files';
import { esc } from '../util/escape';
import { openCircuitPicker } from './circuitPicker';
import { qs } from './dom';
import { circuitBadge, circuitViews, flag, icon } from './kit';

/**
 * En-tête : nom du chantier, pays, circuit actif, annuler / rétablir et fichiers. Le circuit actif
 * est toujours visible : c'est lui qui reçoit ce que l'on compte.
 */
export class Header {
  private readonly nameEl = qs<HTMLInputElement>('#docName');
  private readonly undoEl = qs<HTMLButtonElement>('#undo');
  private readonly redoEl = qs<HTMLButtonElement>('#redo');
  private readonly menuEl = qs<HTMLElement>('#fileMenu');
  private readonly fileEl = qs<HTMLInputElement>('#fileIn');
  private readonly countryEl = qs<HTMLButtonElement>('#countryBtn');
  private readonly activeEl = qs<HTMLButtonElement>('#activeChip');
  private activeKey = '';

  constructor(
    private readonly store: Store,
    private readonly cloud: Cloud,
    private readonly fit: () => void,
  ) {
    this.undoEl.onclick = () => store.undo();
    this.redoEl.onclick = () => store.redo();

    this.nameEl.oninput = () => store.change((s) => (s.doc.name = this.nameEl.value));
    this.nameEl.onchange = () => store.commit();

    this.countryEl.onclick = () => store.change((s) => (s.mode = 'home'));
    this.activeEl.onclick = () => pickActiveCircuit(store);

    qs<HTMLButtonElement>('#fileBtn').onclick = (e) => {
      e.stopPropagation();
      this.menuEl.classList.toggle('open');
    };
    document.addEventListener('click', () => this.menuEl.classList.remove('open'));
    qs<HTMLButtonElement>('#saveDoc').onclick = () => saveJson(store.state.doc);
    qs<HTMLButtonElement>('#newDoc').onclick = () => this.newDoc();
    qs<HTMLButtonElement>('#openDoc').onclick = () => this.fileEl.click();
    qs<HTMLButtonElement>('#exampleDoc').onclick = () => this.example();
    this.fileEl.onchange = () => this.openFile();

    // D'autres écrans (accueil, plan vide) proposent les mêmes actions.
    document.addEventListener('wirely:new', () => this.newDoc());
    document.addEventListener('wirely:open', () => this.fileEl.click());
    document.addEventListener('wirely:example', () => this.example());

    store.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const { store } = this;
    const { doc, activeCircuit, mode } = store.state;
    this.undoEl.disabled = !store.canUndo;
    this.redoEl.disabled = !store.canRedo;
    if (document.activeElement !== this.nameEl) this.nameEl.value = doc.name;

    const rules = rulesOf(doc);
    this.countryEl.innerHTML = `${flag(rules.country)} ${esc(rules.code)}`;

    // Circuit actif : visible là où l'on ajoute des points.
    const show = doc.boards.length > 0 && (mode === 'rooms' || mode === 'plan' || mode === 'board');
    const key = `${store.revision}:${activeCircuit}:${show}`;
    if (key === this.activeKey) return;
    this.activeKey = key;
    this.activeEl.hidden = !show;
    if (!show) return;
    const v = circuitViews(doc).find((c) => c.device.id === activeCircuit);
    this.activeEl.innerHTML = v
      ? `${circuitBadge(v.ref, v.color)}<span>${esc(v.name)}</span>${icon('down', 14)}`
      : `<span class="cbadge none">–</span><span>Sans circuit actif</span>${icon('down', 14)}`;
    this.activeEl.classList.toggle('on', v !== undefined);
  }

  private confirmReplace(): boolean {
    const { doc } = this.store.state;
    const online = this.cloud.remote.kind !== 'local';
    if (!online && (doc.items.length > 0 || doc.boards.length > 0)) {
      return confirm('Remplacer le chantier ouvert ? (Ctrl+Z pour revenir en arrière.)');
    }
    return true;
  }

  private newDoc(): void {
    if (!this.confirmReplace()) return;
    // Un chantier en ligne n'est jamais remplacé : on repart d'un brouillon local.
    if (this.cloud.remote.kind !== 'local') this.cloud.leaveToLocal();
    const country = this.store.state.doc.project.country;
    this.store.replaceDoc(createDoc(undefined, country));
    this.store.change((s) => {
      s.mode = 'home';
      s.activeCircuit = null;
      s.roomId = null;
    });
  }

  private example(): void {
    if (!this.confirmReplace()) return;
    if (this.cloud.remote.kind !== 'local') this.cloud.leaveToLocal();
    this.store.replaceDoc(createDoc(undefined, this.store.state.doc.project.country));
    loadExamplePlan(this.store);
    this.store.change((s) => (s.mode = 'home'));
    this.fit();
  }

  private async openFile(): Promise<void> {
    const file = this.fileEl.files?.[0];
    this.fileEl.value = '';
    if (!file) return;
    try {
      const doc = parseDoc(await readDocFile(file));
      if (this.cloud.remote.kind !== 'local') this.cloud.leaveToLocal();
      this.store.replaceDoc(doc);
      this.store.change((s) => (s.mode = 'home'));
      this.fit();
    } catch {
      alert('Fichier invalide.');
    }
  }
}

/** Ouvre le choix du circuit actif (depuis l'en-tête ou l'écran des pièces). */
export function pickActiveCircuit(store: Store): void {
  openCircuitPicker(store, {
    title: 'Circuit actif',
    hint: 'Ce que vous comptez ou posez ensuite se raccorde à ce circuit.',
    current: store.state.activeCircuit,
    allowNone: true,
    onPick: (id) => setActiveCircuit(store, id),
  });
}
