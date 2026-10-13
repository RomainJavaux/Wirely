import { friendlyError } from '../../cloud/api';
import { shareUrl, type Cloud } from '../../cloud/cloud';
import { esc } from '../../util/escape';
import { openDialog } from './dialog';

/** Partage par lien : active/désactive la consultation publique et copie l'URL. */
export function openShareDialog(cloud: Cloud): void {
  const r = cloud.remote;
  if (r.kind !== 'owned') return;
  const url = shareUrl(r.id);

  const dlg = openDialog(
    `<div class="dlg-body">
      <h2>Partager ce schéma</h2>
      <label class="check"><input type="checkbox" class="toggle"> Toute personne disposant du lien peut le <b>consulter</b></label>
      <div class="share-link">
        <input type="text" readonly value="${esc(url)}" aria-label="Lien de partage">
        <button type="button" class="primary copy">Copier</button>
      </div>
      <p class="muted share-note"></p>
      <p class="form-error" role="alert" hidden></p>
      <div class="row dlg-actions"><span class="spacer"></span><button type="button" class="close">Fermer</button></div>
    </div>`,
    'share',
  );

  const toggle = dlg.el.querySelector<HTMLInputElement>('.toggle') as HTMLInputElement;
  const input = dlg.el.querySelector<HTMLInputElement>('.share-link input') as HTMLInputElement;
  const copy = dlg.el.querySelector<HTMLButtonElement>('.copy') as HTMLButtonElement;
  const note = dlg.el.querySelector<HTMLElement>('.share-note') as HTMLElement;
  const errorEl = dlg.el.querySelector<HTMLElement>('.form-error') as HTMLElement;

  const sync = () => {
    const shared = cloud.remote.kind === 'owned' && cloud.remote.shareMode === 'view';
    toggle.checked = shared;
    copy.disabled = !shared;
    input.disabled = !shared;
    note.textContent = shared
      ? 'Les visiteurs voient le schéma en lecture seule et peuvent en faire une copie dans leur compte. Vous seul pouvez le modifier.'
      : 'Le schéma est privé : le lien ne fonctionne que pour vous.';
  };
  sync();

  toggle.addEventListener('change', async () => {
    errorEl.hidden = true;
    toggle.disabled = true;
    try {
      await cloud.setShare(toggle.checked ? 'view' : 'private');
    } catch (e) {
      errorEl.textContent = friendlyError(e);
      errorEl.hidden = false;
    } finally {
      toggle.disabled = false;
      sync();
    }
  });

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      copy.textContent = 'Copié ✓';
    } catch {
      input.select();
      copy.textContent = 'Sélectionné : Ctrl+C';
    }
    setTimeout(() => (copy.textContent = 'Copier'), 2000);
  });
  input.addEventListener('focus', () => input.select());
  dlg.el.querySelector('.close')?.addEventListener('click', () => dlg.close());
}
