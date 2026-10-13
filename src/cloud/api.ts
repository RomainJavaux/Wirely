/** Client HTTP de l'API Laravel (même origine : /api). */

const TOKEN_KEY = 'wirely-token';

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* navigation privée : la session durera le temps de la page */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignoré */
    }
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Erreurs de validation par champ (422). */
    readonly errors: Record<string, string[]> = {},
    /** Corps JSON complet de la réponse (ex. version courante lors d'un 409). */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Serveur injoignable. Vérifiez votre connexion.');
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* réponse sans corps JSON */
  }
  if (!res.ok) {
    const errors = (json.errors ?? {}) as Record<string, string[]>;
    throw new ApiError(res.status, typeof json.message === 'string' ? json.message : `Erreur ${res.status}`, errors, json);
  }
  return json as T;
}

const FIELD_MESSAGES: Record<string, string> = {
  name: 'Le nom est requis (80 caractères maximum).',
  email: 'Adresse e-mail invalide ou déjà utilisée.',
  password: 'Mot de passe trop court (8 caractères minimum).',
};

/** Message lisible en français pour afficher une erreur d'API. */
export function friendlyError(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Une erreur inattendue est survenue.';
  if (e.isNetwork) return e.message;
  if (e.status === 429) return 'Trop de tentatives. Patientez une minute avant de réessayer.';
  if (e.status === 401) return 'Session expirée : reconnectez-vous.';
  if (e.status === 404) return 'Schéma introuvable, ou privé.';
  if (e.status === 503) return e.message;
  if (e.status === 422) {
    const field = Object.keys(e.errors)[0] ?? '';
    // Les messages de connexion sont déjà en français côté serveur.
    if (field === 'email' && /incorrect/i.test(e.errors.email?.[0] ?? '')) return e.errors.email?.[0] as string;
    return FIELD_MESSAGES[field] ?? e.errors[field]?.[0] ?? 'Données invalides.';
  }
  return e.message;
}
