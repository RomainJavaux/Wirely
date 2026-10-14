import { connectUnlinked, equipAll, generateBoard } from '../core/planActions';
import type { Store } from '../core/store';
import { runChecks } from '../domain/board/checks';
import { isElectrical, unlinkedItems } from '../domain/link/links';
import { runPlanChecks } from '../domain/plan/checks';
import { fmtArea, planSummary } from '../domain/plan/metrics';
import { planNeeds } from '../domain/plan/needs';
import { getRoomKind } from '../domain/plan/roomKinds';
import { esc } from '../util/escape';

/**
 * Panneau « Projet » : ce que le plan contient, ce qu'il reste à faire, et l'action qui fait
 * avancer d'un clic. Il s'affiche quand rien n'est sélectionné.
 */

type StepState = 'done' | 'todo' | 'warn' | 'off';

interface Step {
  title: string;
  state: StepState;
  text: string;
  action?: { id: string; label: string };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;

function steps(store: Store): Step[] {
  const { doc } = store.state;
  const summary = planSummary(doc);
  const needs = planNeeds(doc);
  const incomplete = needs.filter((n) => !n.complete);
  const missing = needs.reduce((t, n) => t + n.missing, 0);
  const electrical = doc.items.filter((i) => i.type === 'symbol' && isElectrical(i)).length;
  const unlinked = unlinkedItems(doc).symbols.length;
  const boardChecks = doc.boards.flatMap((b) => runChecks(b));
  const errors = boardChecks.filter((c) => c.severity === 'error').length;
  const warns = boardChecks.filter((c) => c.severity === 'warn').length;

  const list: Step[] = [];

  list.push(
    summary.rooms > 0
      ? { title: 'Pièces', state: 'done', text: `${plural(summary.rooms, 'pièce')} · ${fmtArea(summary.area)}`, action: { id: 'addRoom', label: '＋ Pièce' } }
      : { title: 'Pièces', state: 'todo', text: 'Décrivez vos pièces : type et dimensions.', action: { id: 'addRoom', label: '＋ Ajouter une pièce' } },
  );

  if (summary.rooms === 0) {
    list.push({ title: 'Équipement', state: 'off', text: 'Prises, lumières et commandes de chaque pièce.' });
  } else if (incomplete.length === 0) {
    list.push({ title: 'Équipement', state: 'done', text: 'Chaque pièce a l’équipement conseillé.' });
  } else {
    list.push({
      title: 'Équipement',
      state: 'todo',
      text: `${plural(incomplete.length, 'pièce')} à compléter · ${plural(missing, 'point')} conseillé${missing > 1 ? 's' : ''}`,
      action: { id: 'equip', label: 'Équiper les pièces' },
    });
  }

  if (electrical === 0) {
    list.push({ title: 'Circuits', state: 'off', text: 'Posez des appareils : les circuits s’en déduisent.' });
  } else if (doc.boards.length === 0) {
    list.push({
      title: 'Circuits',
      state: 'todo',
      text: `${plural(electrical, 'appareil')} à raccorder. Le tableau se génère depuis le plan.`,
      action: { id: 'generate', label: 'Générer le tableau' },
    });
  } else if (unlinked > 0) {
    list.push({
      title: 'Circuits',
      state: 'todo',
      text: `${plural(unlinked, 'appareil')} sans circuit`,
      action: { id: 'connect', label: 'Raccorder automatiquement' },
    });
  } else {
    list.push({ title: 'Circuits', state: 'done', text: `Les ${electrical} appareils sont raccordés.` });
  }

  if (doc.boards.length === 0) {
    list.push({ title: 'Tableau', state: 'off', text: 'Configuré à partir des circuits.' });
  } else {
    const issues = errors + warns;
    list.push({
      title: 'Tableau',
      state: errors > 0 ? 'warn' : issues > 0 ? 'warn' : 'done',
      text: `${plural(doc.boards.length, 'tableau', 'tableaux')}${issues > 0 ? ` · ${plural(issues, 'point')} d’attention` : ' · rien à signaler'}`,
      action: { id: 'board', label: 'Ouvrir le tableau' },
    });
  }

  list.push(
    summary.rooms > 0
      ? { title: 'Dossier', state: 'todo', text: 'Plan coté, murs, circuits et matériel : aperçu et export.', action: { id: 'dossier', label: 'Aperçu et export' } }
      : { title: 'Dossier', state: 'off', text: 'Plan coté, murs, circuits et matériel.' },
  );
  return list;
}

const ICON: Record<StepState, string> = { done: '✓', todo: '•', warn: '!', off: '–' };

export function projectHtml(store: Store): string {
  const { doc } = store.state;
  const list = steps(store);
  // La prochaine étape à faire est mise en avant ; « Dossier » ne l'est qu'une fois le reste fait.
  const next = list.findIndex((s) => s.state === 'todo' || s.state === 'warn');

  const stepsHtml = list
    .map((s, i) => {
      const primary = i === next && s.action ? ' primary' : '';
      const action = s.action ? `<button type="button" class="step-btn${primary}" data-step="${s.action.id}">${esc(s.action.label)}</button>` : '';
      return `<li class="step ${s.state}"><span class="step-dot">${ICON[s.state]}</span>
        <div class="step-body"><b>${esc(s.title)}</b><small>${esc(s.text)}</small>${action}</div></li>`;
    })
    .join('');

  const needs = planNeeds(doc);
  const rooms = needs.length
    ? `<h3>Pièces</h3><ul class="roomlist">${needs
        .map((n) => {
          const kind = getRoomKind(n.room.kind);
          const badge =
            n.required === 0
              ? '<span class="rl-badge muted">type ?</span>'
              : n.complete
                ? '<span class="rl-badge ok">✓</span>'
                : `<span class="rl-badge bad">manque ${n.missing}</span>`;
          return `<li data-room="${n.room.id}"><i style="background:${kind.color}"></i><span class="rl-name">${esc(n.name)}</span><small>${fmtArea(n.areaM2)}</small>${badge}</li>`;
        })
        .join('')}</ul>`
    : '';

  const checks = runPlanChecks(doc);
  const checkList =
    needs.length === 0 || checks.length === 0
      ? ''
      : `<h3>Points d’attention <small>(indicatifs)</small></h3><ul class="checks">${checks
          .map((c) => `<li class="chk ${c.severity}" data-item="${c.itemId ?? ''}">${c.severity === 'warn' ? '⚠️' : 'ℹ️'} <span>${esc(c.message)}</span></li>`)
          .join('')}</ul>
        <p class="muted">Repères inspirés de la NF C 15-100 : ils ne remplacent ni la norme ni un professionnel.</p>`;

  return `<h3>Projet</h3><ol class="steps">${stepsHtml}</ol>${rooms}${checkList}`;
}

export function bindProject(root: HTMLElement, store: Store): void {
  root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
    b.onclick = () => {
      switch (b.dataset.step) {
        case 'addRoom':
          document.dispatchEvent(new CustomEvent('wirely:add-room'));
          break;
        case 'equip':
          equipAll(store);
          break;
        case 'generate':
          generateBoard(store);
          break;
        case 'connect':
          connectUnlinked(store);
          break;
        case 'board':
          store.change((s) => (s.mode = 'board'));
          break;
        case 'dossier':
          store.change((s) => (s.mode = 'dossier'));
          break;
      }
    };
  });
  root.querySelectorAll<HTMLElement>('[data-room]').forEach((li) => {
    li.onclick = () => store.change((s) => (s.selection = Number(li.dataset.room)));
  });
  root.querySelectorAll<HTMLElement>('.chk[data-item]').forEach((li) => {
    li.onclick = () => {
      const id = Number(li.dataset.item);
      if (li.dataset.item !== '' && Number.isFinite(id)) store.change((s) => (s.selection = id));
    };
  });
}
