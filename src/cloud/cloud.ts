import type { Store } from '../core/store';
import { createDoc, parseDoc } from '../domain/document';
import { loadSavedDoc } from '../io/persistence';
import { ApiError, api, friendlyError } from './api';
import type { Auth } from './auth';

export type ShareMode = 'private' | 'view';

export interface ProjectSummary {
  id: string;
  name: string;
  share_mode: ShareMode;
  version: number;
  updated_at: string;
}

interface ProjectDetail extends ProjectSummary {
  data: unknown;
  is_owner: boolean;
  owner_name: string | null;
}

/** D'où vient le document affiché. */
export type Remote =
  | { kind: 'local' }
  | { kind: 'owned'; id: string; version: number; shareMode: ShareMode }
  | { kind: 'viewing'; id: string; ownerName: string };

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const AUTOSAVE_DELAY = 1200;
const RETRY_DELAY = 5000;

const HASH = /^#\/p\/([a-z0-9]{6,16})$/i;
export const projectHash = (id: string): string => `#/p/${id}`;
export const shareUrl = (id: string): string => `${location.origin}${location.pathname}${projectHash(id)}`;

/**
 * Synchronise le document courant avec le serveur :
 * - brouillon local (`#/`), conservé dans le navigateur ;
 * - projet à moi (`#/p/<id>`) : enregistré automatiquement dans mon compte ;
 * - projet partagé par quelqu'un d'autre : consultation, copie de travail non enregistrée.
 */
export class Cloud {
  remote: Remote = { kind: 'local' };
  saveState: SaveState = 'idle';
  /** Message d'erreur à afficher (schéma introuvable, conflit…). */
  error: string | null = null;
  /** Identifiant demandé par l'URL mais impossible à ouvrir (introuvable, privé, réseau). */
  failedId: string | null = null;
  loading = false;

  private listeners = new Set<() => void>();
  private seenRevision = 0;
  private timer: number | undefined;
  private inFlight = false;
  private dirty = false;
  /** Vrai pendant le remplacement du document : ce n'est pas une modification de l'utilisateur. */
  private muted = false;

  constructor(
    private readonly store: Store,
    private readonly auth: Auth,
  ) {
    this.seenRevision = store.revision;
    store.subscribe(() => this.onStoreChange());
    window.addEventListener('hashchange', () => void this.syncWithHash());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  /** Le brouillon local doit-il être sauvegardé dans le navigateur ? */
  get savesLocally(): boolean {
    return this.remote.kind === 'local';
  }

  // ---------------------------------------------------------------- ouverture

  /** Ouvre le projet désigné par l'URL, ou le brouillon local. À appeler au démarrage. */
  async start(): Promise<void> {
    await this.auth.init();
    await this.syncWithHash();
  }

  private currentId(): string | null {
    const m = HASH.exec(location.hash);
    return m ? (m[1] as string) : null;
  }

  private async syncWithHash(): Promise<void> {
    const id = this.currentId();
    if (!id) {
      if (this.remote.kind !== 'local') this.leaveToLocal();
      return;
    }
    if (this.remote.kind !== 'local' && this.remote.id === id) return;
    await this.load(id);
  }

  /** Ouvre un projet : dans mon compte, ou en consultation si c'est celui de quelqu'un d'autre. */
  async load(id: string): Promise<void> {
    this.loading = true;
    this.error = null;
    this.failedId = null;
    this.notify();
    try {
      const p = await api<ProjectDetail>('GET', `/projects/${id}`);
      const doc = parseDoc(p.data);
      doc.name = p.name;
      this.cancelSave();
      this.remote = p.is_owner
        ? { kind: 'owned', id: p.id, version: p.version, shareMode: p.share_mode }
        : { kind: 'viewing', id: p.id, ownerName: p.owner_name ?? 'un autre utilisateur' };
      this.saveState = p.is_owner ? 'saved' : 'idle';
      this.replaceDoc(doc);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.auth.forget();
      this.failedId = id;
      this.error =
        e instanceof ApiError && e.status === 404
          ? 'Schéma introuvable ou privé. S’il est à vous, connectez-vous avec le bon compte.'
          : friendlyError(e);
    } finally {
      this.loading = false;
      this.notify();
    }
  }

  /** Quitte le projet en ligne et revient au brouillon local. */
  leaveToLocal(): void {
    this.cancelSave();
    this.remote = { kind: 'local' };
    this.saveState = 'idle';
    this.error = null;
    this.failedId = null;
    if (this.currentId()) history.replaceState(null, '', location.pathname + location.search);
    this.replaceDoc(loadSavedDoc() ?? createDoc());
    this.notify();
  }

  /** Remplace le document affiché sans que l'enregistrement automatique y voie une modification. */
  private replaceDoc(doc: ReturnType<typeof createDoc>): void {
    this.muted = true;
    try {
      this.store.reset(doc);
    } finally {
      this.muted = false;
    }
    this.seenRevision = this.store.revision;
  }

  // ---------------------------------------------------------------- création / copie

  /** Enregistre le document courant dans mon compte et ouvre son lien. */
  async saveToAccount(): Promise<void> {
    if (!this.auth.user) return;
    const doc = this.store.state.doc;
    const p = await api<ProjectDetail>('POST', '/projects', { name: doc.name, data: doc });
    this.adopt(p);
  }

  /** Copie le schéma consulté (ou le mien) dans mon compte. */
  async duplicate(): Promise<void> {
    if (this.remote.kind === 'local' || !this.auth.user) return;
    const p = await api<ProjectDetail>('POST', `/projects/${this.remote.id}/duplicate`);
    await this.load(p.id);
    history.pushState(null, '', projectHash(p.id));
  }

  private adopt(p: ProjectDetail): void {
    this.cancelSave();
    this.remote = { kind: 'owned', id: p.id, version: p.version, shareMode: p.share_mode };
    this.saveState = 'saved';
    this.error = null;
    this.seenRevision = this.store.revision;
    history.pushState(null, '', projectHash(p.id));
    this.notify();
  }

  // ---------------------------------------------------------------- gestion

  async list(): Promise<ProjectSummary[]> {
    return (await api<{ projects: ProjectSummary[] }>('GET', '/projects')).projects;
  }

  async remove(id: string): Promise<void> {
    await api('DELETE', `/projects/${id}`);
    if (this.remote.kind === 'owned' && this.remote.id === id) this.leaveToLocal();
  }

  async setShare(mode: ShareMode): Promise<void> {
    const r = this.remote;
    if (r.kind !== 'owned') return;
    const res = await api<ProjectSummary>('PATCH', `/projects/${r.id}/share`, { share_mode: mode });
    r.shareMode = res.share_mode;
    this.notify();
  }

  // ---------------------------------------------------------------- enregistrement automatique

  private onStoreChange(): void {
    if (this.muted || this.remote.kind !== 'owned') return;
    if (this.store.revision === this.seenRevision) return;
    this.seenRevision = this.store.revision;
    this.scheduleSave(AUTOSAVE_DELAY);
  }

  private scheduleSave(delay: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), delay);
    if (this.saveState !== 'conflict') this.setSaveState('saving');
  }

  private cancelSave(): void {
    window.clearTimeout(this.timer);
    this.dirty = false;
  }

  private setSaveState(state: SaveState): void {
    if (this.saveState === state) return;
    this.saveState = state;
    this.notify();
  }

  private async flush(): Promise<void> {
    const r = this.remote;
    if (r.kind !== 'owned' || this.saveState === 'conflict') return;
    if (this.inFlight) {
      this.dirty = true;
      return;
    }
    this.inFlight = true;
    this.setSaveState('saving');
    try {
      const doc = this.store.state.doc;
      const res = await api<ProjectSummary>('PUT', `/projects/${r.id}`, { name: doc.name, data: doc, version: r.version });
      if (this.remote === r) {
        r.version = res.version;
        this.error = null;
        this.setSaveState('saved');
      }
    } catch (e) {
      if (this.remote !== r) return;
      if (e instanceof ApiError && e.status === 409) {
        this.error = 'Ce schéma a été modifié ailleurs. Rechargez la version en ligne pour continuer.';
        this.setSaveState('conflict');
      } else if (e instanceof ApiError && e.status === 401) {
        this.auth.forget();
        this.error = 'Session expirée : reconnectez-vous pour continuer à enregistrer.';
        this.setSaveState('error');
      } else {
        this.error = friendlyError(e);
        this.setSaveState('error');
        this.scheduleSave(RETRY_DELAY);
      }
    } finally {
      this.inFlight = false;
      if (this.dirty) {
        this.dirty = false;
        this.scheduleSave(AUTOSAVE_DELAY);
      }
    }
  }

  /** Après un conflit : abandonne les modifications locales et recharge la version en ligne. */
  async reloadFromServer(): Promise<void> {
    const r = this.remote;
    if (r.kind === 'local') return;
    this.saveState = 'idle';
    await this.load(r.id);
  }
}
