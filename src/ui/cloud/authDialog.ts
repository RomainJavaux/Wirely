import { friendlyError } from '../../cloud/api';
import type { Auth } from '../../cloud/auth';
import { openDialog } from './dialog';

type Mode = 'login' | 'register';

/** Connexion / inscription. `onDone` est appelé une fois connecté. */
export function openAuthDialog(auth: Auth, onDone: () => void, mode: Mode = 'login'): void {
  const dlg = openDialog(
    `<form class="dlg-body" novalidate>
      <div class="seg dlg-tabs">
        <button type="button" data-mode="login">Connexion</button>
        <button type="button" data-mode="register">Créer un compte</button>
      </div>
      <label class="f reg-only">Nom<input type="text" name="name" autocomplete="name" maxlength="80"></label>
      <label class="f">Adresse e-mail<input type="email" name="email" autocomplete="email" required></label>
      <label class="f">Mot de passe<input type="password" name="password" autocomplete="current-password" minlength="8" required></label>
      <p class="muted reg-only">8 caractères minimum.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="row dlg-actions">
        <button type="button" class="cancel">Annuler</button>
        <button type="submit" class="primary submit"></button>
      </div>
    </form>`,
    'auth',
  );

  const form = dlg.el.querySelector('form') as HTMLFormElement;
  const errorEl = form.querySelector<HTMLElement>('.form-error') as HTMLElement;
  const submit = form.querySelector<HTMLButtonElement>('.submit') as HTMLButtonElement;
  const password = form.elements.namedItem('password') as HTMLInputElement;
  let current: Mode = mode;

  const apply = (m: Mode) => {
    current = m;
    form.querySelectorAll<HTMLElement>('.reg-only').forEach((el) => el.toggleAttribute('hidden', m !== 'register'));
    form.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    submit.textContent = m === 'login' ? 'Se connecter' : 'Créer mon compte';
    password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    errorEl.hidden = true;
  };
  apply(mode);

  form.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => apply(b.dataset.mode as Mode)),
  );
  form.querySelector('.cancel')?.addEventListener('click', () => dlg.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim();
    submit.disabled = true;
    errorEl.hidden = true;
    try {
      if (current === 'login') await auth.login(v('email'), (form.elements.namedItem('password') as HTMLInputElement).value);
      else await auth.register(v('name'), v('email'), (form.elements.namedItem('password') as HTMLInputElement).value);
      dlg.close();
      onDone();
    } catch (err) {
      errorEl.textContent = friendlyError(err);
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  form.querySelector<HTMLInputElement>(current === 'register' ? '[name=name]' : '[name=email]')?.focus();
}
