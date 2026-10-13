import { friendlyError } from '../../cloud/api';
import type { Auth } from '../../cloud/auth';
import type { Cloud, SaveState } from '../../cloud/cloud';
import { esc } from '../../util/escape';
import { qs } from '../dom';
import { openAuthDialog } from './authDialog';
import { openProjectsDialog } from './projectsDialog';
import { openShareDialog } from './shareDialog';

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: '☁ Enregistrement…',
  saved: '☁ Enregistré',
  error: '⚠ Non enregistré',
  conflict: '⚠ Conflit',
};

/** Compte, enregistrement en ligne, partage, et bandeau d'état du schéma ouvert. */
export class CloudBar {
  private readonly bar = qs<HTMLElement>('#cloudBar');
  private readonly banner = qs<HTMLElement>('#banner');

  constructor(
    private readonly auth: Auth,
    private readonly cloud: Cloud,
  ) {
    auth.subscribe(() => this.render());
    cloud.subscribe(() => this.render());

    this.bar.addEventListener('click', (e) => {
      const action = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (action) void this.handle(action);
    });
    this.banner.addEventListener('click', (e) => {
      const action = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (action) void this.handle(action);
    });
    this.render();
  }

  private async handle(action: string): Promise<void> {
    const { auth, cloud } = this;
    switch (action) {
      case 'login':
        openAuthDialog(auth, () => void this.afterLogin());
        break;
      case 'account':
        openProjectsDialog(auth, cloud);
        break;
      case 'save':
        await this.requireAccount(() => this.run(() => cloud.saveToAccount()));
        break;
      case 'share':
        openShareDialog(cloud);
        break;
      case 'duplicate':
        await this.requireAccount(() => this.run(() => cloud.duplicate()));
        break;
      case 'reload':
        await cloud.reloadFromServer();
        break;
      case 'local':
        location.hash = '';
        if (cloud.remote.kind !== 'local') cloud.leaveToLocal();
        break;
    }
  }

  private requireAccount(then: () => void | Promise<void>): void | Promise<void> {
    if (this.auth.user) return then();
    openAuthDialog(this.auth, () => void then());
  }

  /** Après connexion : si l'URL visait un schéma qu'on ne pouvait pas voir, on le recharge. */
  private async afterLogin(): Promise<void> {
    const id = this.cloud.failedId;
    if (id) await this.cloud.load(id);
  }

  private async run(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (e) {
      alert(friendlyError(e));
    }
  }

  private render(): void {
    const { auth, cloud } = this;
    const r = cloud.remote;
    const parts: string[] = [];

    if (r.kind === 'owned') {
      parts.push(`<span class="chip ${cloud.saveState}" role="status">${SAVE_LABEL[cloud.saveState]}</span>`);
      parts.push(`<button data-act="share" title="Partager par lien">🔗 Partager</button>`);
    } else if (r.kind === 'viewing') {
      parts.push(`<span class="chip viewing">👁 Consultation</span>`);
    } else {
      parts.push(`<button data-act="save" title="Enregistrer dans votre compte et obtenir un lien">☁ Enregistrer en ligne</button>`);
    }

    if (!auth.ready) parts.push('');
    else if (auth.user) parts.push(`<button data-act="account" title="${esc(auth.user.email)}">👤 ${esc(auth.user.name)}</button>`);
    else parts.push(`<button data-act="login">Se connecter</button>`);

    this.bar.innerHTML = parts.join('');
    this.renderBanner();
  }

  private renderBanner(): void {
    const { cloud, auth } = this;
    const r = cloud.remote;
    let html = '';
    let kind = 'info';

    if (cloud.loading) {
      html = 'Chargement du schéma…';
    } else if (cloud.saveState === 'conflict') {
      kind = 'warn';
      html = `${esc(cloud.error ?? 'Conflit de version.')} <button data-act="reload">Recharger la version en ligne</button>`;
    } else if (cloud.failedId && cloud.error) {
      kind = 'warn';
      html = `${esc(cloud.error)} ${auth.user ? '' : '<button data-act="login">Se connecter</button>'} <button data-act="local">Revenir à mon brouillon</button>`;
    } else if (cloud.error && cloud.saveState === 'error') {
      kind = 'warn';
      html = `${esc(cloud.error)} Nouvelle tentative automatique…`;
    } else if (r.kind === 'viewing') {
      html =
        `Vous consultez un schéma de <b>${esc(r.ownerName)}</b>. Vos modifications ne sont <b>pas enregistrées</b>. ` +
        `<button data-act="duplicate" class="primary">Dupliquer dans mon compte</button> ` +
        `<button data-act="local">Mon brouillon</button>`;
    }

    this.banner.hidden = html === '';
    this.banner.className = `banner ${kind}`;
    this.banner.innerHTML = html;
  }
}
