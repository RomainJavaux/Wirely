import type { BoardView, Mode, Store } from '../core/store';
import { isElectrical } from '../domain/link/links';
import { allPoints } from '../domain/points';
import { runProjectChecks } from '../domain/rules/checks';
import { qs } from './dom';

const SESSION_KEY = 'wirely.nav';

/** Zone principale de chaque espace : une seule est visible à la fois. */
const MAINS: Readonly<Record<Mode, string>> = {
  home: '#homeMain',
  rooms: '#roomsMain',
  board: '#boardMain',
  plan: '#planMain',
  view3d: '#view3dMain',
  dossier: '#dossierMain',
};

/** Vues du tableau : liste des circuits, face avant (rails), schéma unifilaire. */
const BOARD_VIEWS: Readonly<Record<BoardView, string>> = {
  circuits: '#circuitsView',
  front: '#boardWork',
  uni: '#schemaView',
};

/**
 * Navigation entre les espaces du chantier (barre latérale sur ordinateur, barre du bas sur
 * téléphone) et entre les vues du tableau. Les pastilles disent où il reste quelque chose à faire.
 */
export class Nav {
  private readonly mains = (Object.keys(MAINS) as Mode[]).map((mode) => ({ mode, el: qs<HTMLElement>(MAINS[mode]) }));
  private readonly tabs = [...document.querySelectorAll<HTMLElement>('#nav [data-mode]')];
  private readonly boardViews = (Object.keys(BOARD_VIEWS) as BoardView[]).map((view) => ({ view, el: qs<HTMLElement>(BOARD_VIEWS[view]) }));
  private readonly boardTabs = [...document.querySelectorAll<HTMLElement>('#boardTabs [data-bview]')];
  private badgeKey = '';
  private remembered = '';

  constructor(private readonly store: Store) {
    this.tabs.forEach((b) => {
      b.addEventListener('click', () => {
        const mode = b.dataset.mode as Mode;
        store.change((s) => {
          s.mode = mode;
          s.armedKind = null;
        });
      });
    });
    this.boardTabs.forEach((b) => {
      b.addEventListener('click', () => store.change((s) => (s.boardView = b.dataset.bview as BoardView)));
    });
    this.restore();
    store.subscribe(() => this.sync());
    this.sync();
  }

  /** Retrouve l'espace ouvert avant un rechargement de la page. */
  private restore(): void {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { mode?: string; boardView?: string; roomId?: number | null } | null;
      if (!saved) return;
      const { state } = this.store;
      if (saved.mode && saved.mode in MAINS && saved.mode !== 'view3d') state.mode = saved.mode as Mode;
      if (saved.boardView && saved.boardView in BOARD_VIEWS) state.boardView = saved.boardView as BoardView;
      if (typeof saved.roomId === 'number' && this.store.getItem(saved.roomId)?.type === 'room') state.roomId = saved.roomId;
    } catch {
      // stockage indisponible ou valeur illisible : on reste sur l'accueil
    }
  }

  private remember(): void {
    const { mode, boardView, roomId } = this.store.state;
    const value = JSON.stringify({ mode, boardView, roomId });
    if (value === this.remembered) return;
    this.remembered = value;
    try {
      sessionStorage.setItem(SESSION_KEY, value);
    } catch {
      // sans importance
    }
  }

  private sync(): void {
    const { mode, boardView } = this.store.state;
    for (const m of this.mains) m.el.toggleAttribute('hidden', m.mode !== mode);
    // La vue 3D fait partie du plan.
    const shown = mode === 'view3d' ? 'plan' : mode;
    this.tabs.forEach((b) => b.classList.toggle('active', b.dataset.mode === shown));
    document.body.dataset.mode = mode;

    for (const v of this.boardViews) v.el.toggleAttribute('hidden', v.view !== boardView);
    this.boardTabs.forEach((b) => b.classList.toggle('active', b.dataset.bview === boardView));
    this.syncBadges();
    this.remember();
  }

  /** Pastilles : points sans circuit, positions à vérifier, remarques à lever. */
  private syncBadges(): void {
    const key = String(this.store.revision);
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const { doc } = this.store.state;
    const points = allPoints(doc);
    const unlinked = points.filter((p) => isElectrical(p) && p.breaker === null).length;
    const rough = points.filter((p) => p.rough === true).length;
    const issues = runProjectChecks(doc).filter((c) => c.severity !== 'info').length;
    const set = (id: string, n: number): void => {
      const el = document.querySelector<HTMLElement>(id);
      if (!el) return;
      el.hidden = n === 0;
      el.textContent = n > 99 ? '99+' : String(n);
    };
    set('#navRooms', 0);
    set('#navBoard', unlinked);
    set('#navPlan', rough);
    set('#navDossier', issues);
  }
}
