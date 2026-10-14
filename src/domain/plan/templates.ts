import type { Board } from '../board/types';
import type { Item, NewItem, Point, Room, RoomKind, Rotation, WireTypeId } from '../types';
import { roomAt } from './metrics';

const room = (x: number, y: number, w: number, h: number, label: string, kind: RoomKind): NewItem => ({
  type: 'room', x, y, w, h, label, kind, parts: [],
});
const wall = (...points: Point[]): NewItem => ({ type: 'wall', points });
const sym = (kind: string, x: number, y: number, rot: Rotation = 0, label = ''): NewItem => ({
  type: 'symbol', kind, x, y, rot, label, breaker: null, board: null, height: null,
});
const wire = (wtype: WireTypeId, ...points: Point[]): NewItem => ({ type: 'wire', points, wtype, breaker: null });

/**
 * Appartement d'exemple d'environ 76 m² (échelle 0,5 m par carreau), pour démarrer avec
 * quelque chose de concret : pièces typées, murs, ouvertures, appareillage et circuits.
 */
export function examplePlan(): { name: string; items: NewItem[] } {
  const items: NewItem[] = [
    // Pièces (au fond)
    room(0, 0, 240, 180, 'Séjour', 'sejour'),
    room(240, 0, 140, 180, 'Cuisine', 'cuisine'),
    room(0, 180, 160, 140, 'Chambre', 'chambre'),
    room(160, 180, 100, 140, 'Salle de bains', 'sdb'),
    room(260, 180, 120, 140, 'Entrée', 'entree'),

    // Murs : contour puis cloisons
    wall([0, 0], [380, 0], [380, 320], [0, 320], [0, 0]),
    wall([240, 0], [240, 180]),
    wall([0, 180], [380, 180]),
    wall([160, 180], [160, 320]),
    wall([260, 180], [260, 320]),

    // Ouvertures
    sym('porte', 340, 320),
    sym('fenetre', 120, 0),
    sym('fenetre', 310, 0),
    sym('fenetre', 0, 250, 90),
    sym('fenetre', 210, 320),
    sym('porte', 80, 180),
    sym('porte', 240, 90, 90),
    sym('porte', 260, 250, 90),
    sym('porte', 320, 180),

    // Séjour : 7 prises, 1 point lumineux, un détecteur de fumée
    sym('lampe', 120, 90),
    sym('inter', 230, 160),
    sym('prise', 20, 40), sym('prise', 20, 140), sym('prise', 40, 170), sym('prise', 200, 170),
    sym('prise', 220, 40), sym('prise', 220, 140), sym('prise', 120, 170),
    sym('rj45', 20, 90),
    sym('fumee', 160, 90),

    // Cuisine
    sym('lampe', 310, 90),
    sym('inter', 250, 160),
    sym('prise', 255, 70), sym('prise', 290, 170), sym('prise', 330, 170),
    sym('prise', 370, 60), sym('prise', 370, 120), sym('prise', 260, 140),
    sym('prise_s', 370, 160, 0, 'Plaque'),

    // Chambre
    sym('lampe', 80, 250),
    sym('inter', 150, 190),
    sym('prise', 20, 200), sym('prise', 140, 300), sym('prise', 20, 300),

    // Salle de bains
    sym('applique', 175, 245),
    sym('lampe', 210, 270),
    sym('inter', 250, 225),
    sym('prise', 170, 300), sym('prise', 250, 300),

    // Entrée et tableau
    sym('lampe', 320, 250),
    sym('inter', 270, 190),
    sym('prise', 370, 270),
    sym('tableau', 270, 310),

    // Circuits depuis le tableau
    wire('eclairage', [270, 310], [270, 250], [320, 250]),
    wire('eclairage', [270, 310], [250, 310], [250, 270], [210, 270]),
    wire('prises', [270, 310], [370, 310], [370, 270]),
    wire('special', [270, 310], [280, 310], [280, 200], [360, 200], [360, 160], [370, 160]),
  ];
  return { name: 'Appartement (exemple)', items };
}

/**
 * Raccorde l'appartement d'exemple au tableau d'exemple (modèle « logement ») : chaque câble et
 * chaque appareil au disjoncteur qui lui correspond, et le symbole du tableau au tableau lui-même.
 */
export function linkExample(items: Item[], board: Board): void {
  const byLabel = new Map(board.devices.filter((d) => d.label).map((d) => [d.label, d.id] as const));
  const pick = (label: string): number | null => byLabel.get(label) ?? null;
  const rooms = items.filter((i): i is Room => i.type === 'room');

  for (const it of items) {
    if (it.type === 'wire') {
      it.breaker = pick(it.wtype === 'eclairage' ? 'Éclairage' : it.wtype === 'special' ? 'Plaque de cuisson' : 'Prises chambres');
    } else if (it.type === 'symbol') {
      if (it.kind === 'tableau') it.board = board.id;
      else if (['lampe', 'applique', 'spot', 'inter', 'va', 'poussoir'].includes(it.kind)) it.breaker = pick('Éclairage');
      else if (it.kind === 'prise_s') it.breaker = pick('Plaque de cuisson');
      else if (it.kind === 'prise' || it.kind === 'rj45') {
        const kind = roomAt(rooms, it.x, it.y)?.kind;
        it.breaker = pick(kind === 'sejour' ? 'Prises séjour' : kind === 'cuisine' ? 'Prises cuisine' : 'Prises chambres');
      }
    }
  }
}
