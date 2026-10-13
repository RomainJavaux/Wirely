import { friendlyError } from '../../cloud/api';
import type { Auth } from '../../cloud/auth';
import { projectHash, type Cloud, type ProjectSummary } from '../../cloud/cloud';
import { esc } from '../../util/escape';
import { openDialog } from './dialog';

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** « Mes schémas » : liste, ouverture, suppression, déconnexion. */
export function openProjectsDialog(auth: Auth, cloud: Cloud): void {
  const user = auth.user;
  if (!user) return;

  const dlg = openDialog(
    `<div class="dlg-body">
      <h2>Mes schémas</h2>
      <p class="muted">Connecté en tant que <b>${esc(user.name)}</b> (${esc(user.email)})</p>
      <div class="plist" aria-live="polite"><p class="muted">Chargement…</p></div>
      <div class="row dlg-actions">
        <button type="button" class="danger logout">Se déconnecter</button>
        <span class="spacer"></span>
        <button type="button" class="close">Fermer</button>
      </div>
    </div>`,
    'projects',
  );
  const list = dlg.el.querySelector('.plist') as HTMLElement;

  const render = (projects: ProjectSummary[]) => {
    if (projects.length === 0) {
      list.innerHTML = `<p class="muted">Aucun schéma pour l'instant. Utilisez « ☁ Enregistrer en ligne » pour sauvegarder le schéma en cours.</p>`;
      return;
    }
    list.innerHTML = projects
      .map(
        (p) => `<div class="prow" data-id="${esc(p.id)}">
          <a class="pname" href="${projectHash(p.id)}">${esc(p.name)}</a>
          <span class="muted">${esc(fmtDate(p.updated_at))}${p.share_mode === 'view' ? ' · 🔗 partagé' : ''}</span>
          <button type="button" class="danger del" title="Supprimer">Supprimer</button>
        </div>`,
      )
      .join('');
  };

  cloud
    .list()
    .then(render)
    .catch((e) => (list.innerHTML = `<p class="form-error">${esc(friendlyError(e))}</p>`));

  list.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('.prow');
    if (!row) return;
    const id = row.dataset.id as string;
    if (target.closest('.pname')) {
      dlg.close(); // le lien #/p/<id> fait le reste
      return;
    }
    if (target.closest('.del')) {
      const name = row.querySelector('.pname')?.textContent ?? 'ce schéma';
      if (!confirm(`Supprimer définitivement « ${name} » ? Cette action est irréversible.`)) return;
      try {
        await cloud.remove(id);
        row.remove();
        if (!list.querySelector('.prow')) render([]);
      } catch (err) {
        alert(friendlyError(err));
      }
    }
  });

  dlg.el.querySelector('.close')?.addEventListener('click', () => dlg.close());
  dlg.el.querySelector('.logout')?.addEventListener('click', async () => {
    await auth.logout();
    if (cloud.remote.kind === 'owned') cloud.leaveToLocal();
    dlg.close();
  });
}
