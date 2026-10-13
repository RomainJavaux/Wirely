import { ApiError, api, tokenStore } from './api';

export interface User {
  id: number;
  name: string;
  email: string;
}

interface Session {
  user: User;
  token: string;
}

/** Compte utilisateur : connexion, inscription, déconnexion. Le jeton vit dans le navigateur. */
export class Auth {
  user: User | null = null;
  /** Faux tant que la vérification d'une session existante n'est pas terminée. */
  ready = false;

  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  /** Restaure la session depuis le jeton enregistré, s'il est encore valide. */
  async init(): Promise<void> {
    if (tokenStore.get()) {
      try {
        this.user = (await api<{ user: User }>('GET', '/me')).user;
      } catch (e) {
        // Jeton expiré ou révoqué : on l'oublie. Une panne réseau le garde pour plus tard.
        if (e instanceof ApiError && e.status === 401) tokenStore.clear();
      }
    }
    this.ready = true;
    this.notify();
  }

  async login(email: string, password: string): Promise<void> {
    this.accept(await api<Session>('POST', '/auth/login', { email, password }));
  }

  async register(name: string, email: string, password: string): Promise<void> {
    this.accept(await api<Session>('POST', '/auth/register', { name, email, password }));
  }

  async logout(): Promise<void> {
    try {
      await api('POST', '/auth/logout');
    } catch {
      /* le jeton est de toute façon oublié localement */
    }
    this.forget();
  }

  /** Oublie la session locale (déconnexion, jeton refusé par le serveur). */
  forget(): void {
    tokenStore.clear();
    this.user = null;
    this.notify();
  }

  private accept(session: Session): void {
    tokenStore.set(session.token);
    this.user = session.user;
    this.notify();
  }
}
