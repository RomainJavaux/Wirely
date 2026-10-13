import { describe, expect, it } from 'vitest';
import { ApiError, friendlyError } from '../src/cloud/api';
import { Store } from '../src/core/store';
import { createDoc } from '../src/domain/document';

describe('friendlyError', () => {
  it('traduit les erreurs de validation par champ', () => {
    const e = new ApiError(422, 'x', { password: ['The password field must be at least 8 characters.'] });
    expect(friendlyError(e)).toMatch(/8 caractères/);
    expect(friendlyError(new ApiError(422, 'x', { email: ['The email has already been taken.'] }))).toMatch(/e-mail/);
  });

  it('garde le message français de connexion incorrecte', () => {
    const e = new ApiError(422, 'x', { email: ['E-mail ou mot de passe incorrect.'] });
    expect(friendlyError(e)).toBe('E-mail ou mot de passe incorrect.');
  });

  it('distingue réseau, session expirée, introuvable et limitation', () => {
    expect(friendlyError(new ApiError(0, 'Serveur injoignable. Vérifiez votre connexion.'))).toMatch(/injoignable/);
    expect(friendlyError(new ApiError(401, 'x'))).toMatch(/expirée/);
    expect(friendlyError(new ApiError(404, 'x'))).toMatch(/introuvable/);
    expect(friendlyError(new ApiError(429, 'x'))).toMatch(/Trop de tentatives/);
    expect(friendlyError(new Error('boum'))).toMatch(/inattendue/);
  });
});

describe('Store.reset', () => {
  it('remplace le document et repart d’un historique vierge', () => {
    const store = new Store(createDoc('A'));
    store.state.doc.items.push({ id: 1, type: 'text', x: 0, y: 0, text: 't' });
    store.commit();
    expect(store.canUndo).toBe(true);

    store.reset(createDoc('B'));

    expect(store.state.doc.name).toBe('B');
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.state.selection).toBeNull();
  });

  it('incrémente la révision (pour que l’interface se rafraîchisse)', () => {
    const store = new Store(createDoc());
    const before = store.revision;
    store.reset(createDoc());
    expect(store.revision).toBe(before + 1);
  });
});
