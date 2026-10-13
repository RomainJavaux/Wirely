import type { Store } from '../core/store';
import { parseDoc } from '../domain/document';
import type { Doc } from '../domain/types';

const KEY = 'wirely-v1';
/** Ancienne clé (avant le renommage en Wirely) : lue en secours pour ne rien perdre. */
const LEGACY_KEY = 'schema-electrique-v1';

export function loadSavedDoc(): Doc | null {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    return raw ? parseDoc(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Sauvegarde automatiquement à chaque étape d'historique validée. */
export function enableAutosave(store: Store): void {
  let last = store.revision;
  store.subscribe(() => {
    if (store.revision === last) return;
    last = store.revision;
    try {
      localStorage.setItem(KEY, JSON.stringify(store.state.doc));
    } catch {
      /* stockage plein ou indisponible : on ignore */
    }
  });
}
