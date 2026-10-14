import { getDeviceDef } from '../board/catalog';
import { analyze, canPlace, createDevice, deviceWidth, devicesInRow, effectiveUsage, isCircuitRole } from '../board/layout';
import type { Board, Device, UsageId } from '../board/types';
import { roomAt, roomsOf } from '../plan/metrics';
import { getRoomKind } from '../plan/roomKinds';
import type { Doc, Room, RoomKind, SymbolItem } from '../types';
import { allLinks, isElectrical, MAX_SOCKETS_BY_SECTION } from './links';

/**
 * Circuits déduits du plan : on regroupe les appareils par usage et par zone, en respectant les
 * limites usuelles (nombre de points par circuit, calibre, différentiel). Repères indicatifs
 * inspirés de la NF C 15-100 : le résultat est un brouillon à relire, pas une étude.
 */

/** Nombre maximal de points d'éclairage et de prises par circuit. */
export const MAX_LIGHTS = 8;
export const MAX_SOCKETS = 8;
/** Nombre maximal de circuits derrière un différentiel 30 mA de 40 A. */
export const MAX_CIRCUITS_PER_RCD = 8;

export type RcdGroup = 'special' | 'eclairage' | 'prises';

export interface CircuitPlan {
  label: string;
  usage: UsageId;
  rating: number;
  /** Différentiel auquel ce circuit est rattaché. */
  group: RcdGroup;
  itemIds: number[];
  /** Pièces desservies, par ordre d'importance. */
  rooms: string[];
}

const LIGHTS = new Set(['lampe', 'applique', 'spot']);
const SWITCHES = new Set(['inter', 'va', 'poussoir']);
/** Petit appareillage qui suit le circuit d'éclairage de sa pièce. */
const LIGHT_FAMILY = new Set([...LIGHTS, ...SWITCHES, 'sonnette', 'fumee']);

type Zone = 'jour' | 'nuit' | 'ext';
const LIGHT_ZONE: Readonly<Record<RoomKind, Zone>> = {
  sejour: 'jour', cuisine: 'jour', entree: 'jour', couloir: 'jour', garage: 'jour', cave: 'jour', autre: 'jour',
  chambre: 'nuit', bureau: 'nuit', sdb: 'nuit', wc: 'nuit',
  exterieur: 'ext',
};

type SocketZone = 'cuisine' | 'sejour' | 'chambres' | 'annexes' | 'ext';
const SOCKET_ZONE: Readonly<Record<RoomKind, SocketZone>> = {
  cuisine: 'cuisine',
  sejour: 'sejour', entree: 'sejour', couloir: 'sejour', autre: 'sejour',
  chambre: 'chambres', bureau: 'chambres',
  sdb: 'annexes', wc: 'annexes', garage: 'annexes', cave: 'annexes',
  exterieur: 'ext',
};

const NO_ROOM = 'Hors pièce';

interface Ctx {
  rooms: Room[];
  roomName: (s: SymbolItem) => string;
  roomKind: (s: SymbolItem) => RoomKind | null;
}

function context(doc: Pick<Doc, 'items'>): Ctx {
  const rooms = roomsOf(doc.items);
  const at = (s: SymbolItem): Room | null => roomAt(rooms, s.x, s.y);
  return {
    rooms,
    roomName: (s) => {
      const r = at(s);
      return r ? r.label.trim() || getRoomKind(r.kind).name : NO_ROOM;
    },
    roomKind: (s) => at(s)?.kind ?? null,
  };
}

/** Pièces desservies par un ensemble d'appareils, de la plus représentée à la moins représentée. */
function roomsServed(symbols: SymbolItem[], ctx: Ctx): string[] {
  const counts = new Map<string, number>();
  for (const s of symbols) {
    const name = ctx.roomName(s);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

const chunk = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** « Salle de bains / WC » ou « Séjour et 2 autres ». */
function namesLabel(names: string[]): string {
  if (names.length <= 2) return names.join(' / ');
  return `${names[0]} et ${names.length - 1} autres`;
}

const numbered = (base: string, i: number, total: number): string => (total > 1 ? `${base} ${i + 1}` : base);

/**
 * Regroupe les appareils alimentés en circuits. Par défaut, seuls les appareils qui ne sont pas
 * encore raccordés sont pris en compte.
 */
export function planCircuits(doc: Pick<Doc, 'items'>, opts: { onlyUnlinked?: boolean } = {}): CircuitPlan[] {
  const onlyUnlinked = opts.onlyUnlinked ?? true;
  const ctx = context(doc);
  const symbols = doc.items.filter(
    (i): i is SymbolItem => i.type === 'symbol' && isElectrical(i) && (!onlyUnlinked || i.breaker === null),
  );
  const plans: CircuitPlan[] = [];

  // --- Éclairage : points lumineux, commandes et petit appareillage ------------------------
  const lights = symbols.filter((s) => LIGHTS.has(s.kind));
  const lightZones = new Map<Zone, SymbolItem[]>();
  for (const l of lights) {
    const kind = ctx.roomKind(l);
    const zone: Zone = kind ? LIGHT_ZONE[kind] : 'jour';
    lightZones.set(zone, [...(lightZones.get(zone) ?? []), l]);
  }
  const lightCircuits: { label: string; symbols: SymbolItem[] }[] = [];
  if (lights.length <= MAX_LIGHTS) {
    if (lights.length > 0) lightCircuits.push({ label: 'Éclairage', symbols: lights });
  } else {
    const names: Record<Zone, string> = { jour: 'Éclairage jour', nuit: 'Éclairage nuit', ext: 'Éclairage extérieur' };
    for (const zone of ['jour', 'nuit', 'ext'] as Zone[]) {
      const list = lightZones.get(zone) ?? [];
      const parts = chunk(list, MAX_LIGHTS);
      parts.forEach((p, i) => lightCircuits.push({ label: numbered(names[zone], i, parts.length), symbols: p }));
    }
  }

  // Les commandes et le petit appareillage suivent l'éclairage de leur pièce (à défaut, le plus proche).
  const followers = symbols.filter((s) => LIGHT_FAMILY.has(s.kind) && !LIGHTS.has(s.kind));
  for (const f of followers) {
    const room = ctx.roomName(f);
    const target =
      lightCircuits.find((c) => c.symbols.some((l) => ctx.roomName(l) === room)) ?? lightCircuits[0];
    if (target) target.symbols.push(f);
    else lightCircuits.push({ label: 'Éclairage', symbols: [f] });
  }
  for (const c of lightCircuits) {
    plans.push({
      label: c.label,
      usage: 'eclairage',
      rating: 10,
      group: 'eclairage',
      itemIds: c.symbols.map((s) => s.id),
      rooms: roomsServed(c.symbols, ctx),
    });
  }

  // --- VMC et volets roulants ---------------------------------------------------------------
  const vmc = symbols.filter((s) => s.kind === 'vmc');
  if (vmc.length > 0) {
    plans.push({ label: 'VMC', usage: 'autre', rating: 2, group: 'eclairage', itemIds: vmc.map((s) => s.id), rooms: roomsServed(vmc, ctx) });
  }
  const shutters = chunk(symbols.filter((s) => s.kind === 'vr'), MAX_LIGHTS);
  shutters.forEach((list, i) =>
    plans.push({
      label: numbered('Volets roulants', i, shutters.length),
      usage: 'autre',
      rating: 16,
      group: 'eclairage',
      itemIds: list.map((s) => s.id),
      rooms: roomsServed(list, ctx),
    }),
  );

  // --- Prises 16 A, par zone -------------------------------------------------------------------
  const socketZones = new Map<SocketZone, SymbolItem[]>();
  for (const s of symbols.filter((x) => x.kind === 'prise')) {
    const kind = ctx.roomKind(s);
    const zone: SocketZone = kind ? SOCKET_ZONE[kind] : 'sejour';
    socketZones.set(zone, [...(socketZones.get(zone) ?? []), s]);
  }
  // Une petite zone (≤ 3 prises) rejoint une autre zone quand le total reste raisonnable.
  const order: SocketZone[] = ['cuisine', 'sejour', 'chambres', 'annexes', 'ext'];
  for (const zone of order) {
    const list = socketZones.get(zone);
    if (!list || list.length === 0 || list.length > 3 || zone === 'cuisine' || zone === 'ext') continue;
    const host = order
      .filter((z) => z !== zone && z !== 'cuisine' && z !== 'ext')
      .map((z) => ({ z, n: socketZones.get(z)?.length ?? 0 }))
      .filter((h) => h.n > 0 && h.n + list.length <= MAX_SOCKETS)
      .sort((a, b) => b.n - a.n)[0];
    if (host) {
      socketZones.set(host.z, [...(socketZones.get(host.z) ?? []), ...list]);
      socketZones.delete(zone);
    }
  }
  for (const zone of order) {
    const list = socketZones.get(zone) ?? [];
    const parts = chunk(list, MAX_SOCKETS);
    parts.forEach((part, i) => {
      const served = roomsServed(part, ctx);
      plans.push({
        label: numbered(`Prises ${namesLabel(served)}`, i, parts.length),
        usage: 'prises',
        // 16 A / 1,5 mm² jusqu'à 5 prises, 20 A / 2,5 mm² au-delà.
        rating: part.length <= (MAX_SOCKETS_BY_SECTION[1.5] ?? 5) ? 16 : 20,
        group: 'prises',
        itemIds: part.map((s) => s.id),
        rooms: served,
      });
    });
  }

  // --- Prises spécialisées : un circuit par appareil -----------------------------------------
  for (const s of symbols.filter((x) => x.kind === 'prise_s')) {
    const label = s.label.trim() || `Prise spécialisée ${ctx.roomName(s)}`;
    const cooking = /plaque|cuisson|four/i.test(label) && /plaque|cuisson/i.test(label);
    plans.push({
      label,
      usage: 'special',
      rating: cooking ? 32 : 20,
      group: 'special',
      itemIds: [s.id],
      rooms: roomsServed([s], ctx),
    });
  }

  // --- Chauffage et eau chaude ------------------------------------------------------------------
  const heaters = symbols.filter((s) => s.kind === 'radia' || s.kind === 'thermo');
  chunk(heaters, 4).forEach((list, i, all) =>
    plans.push({
      label: numbered('Chauffage', i, all.length),
      usage: 'chauffage',
      rating: list.length <= 2 ? 16 : 20,
      group: 'prises',
      itemIds: list.map((s) => s.id),
      rooms: roomsServed(list, ctx),
    }),
  );
  for (const s of symbols.filter((x) => x.kind === 'ce')) {
    plans.push({ label: 'Chauffe-eau', usage: 'eau', rating: 20, group: 'prises', itemIds: [s.id], rooms: roomsServed([s], ctx) });
  }

  return plans;
}

export interface GeneratedBoard {
  board: Board;
  /** Circuits créés, dans l'ordre du tableau, avec l'appareil du tableau correspondant. */
  circuits: { plan: CircuitPlan; device: Device }[];
}

const RCD_NAMES: Readonly<Record<RcdGroup, string>> = {
  special: 'circuits spécialisés',
  eclairage: 'éclairage',
  prises: 'prises',
};

/** Construit un tableau (un différentiel 30 mA par rail) qui porte les circuits proposés. */
export function buildBoardFromPlan(plans: CircuitPlan[], name: string, nextId: () => number): GeneratedBoard | null {
  if (plans.length === 0) return null;
  const board: Board = { id: nextId(), name, location: '', supply: 'mono', cols: 13, rows: 1, devices: [] };
  const circuits: { plan: CircuitPlan; device: Device }[] = [];

  const rcdDef = getDeviceDef('idiff');
  const disjDef = getDeviceDef('disj');
  if (!rcdDef || !disjDef) return null;

  // Un différentiel par groupe, rempli par tranches de MAX_CIRCUITS_PER_RCD circuits.
  const rails: { group: RcdGroup; plans: CircuitPlan[] }[] = [];
  for (const group of ['special', 'eclairage', 'prises'] as RcdGroup[]) {
    const mine = plans.filter((p) => p.group === group);
    for (const part of chunk(mine, MAX_CIRCUITS_PER_RCD)) rails.push({ group, plans: part });
  }

  board.rows = Math.max(1, rails.length);
  rails.forEach((rail, row) => {
    const typeA = rail.group === 'special';
    // Un différentiel de 25 A suffit pour un petit rail d'éclairage.
    const rating = rail.group === 'eclairage' && rail.plans.length <= 5 ? 25 : 40;
    board.devices.push(
      createDevice(rcdDef, nextId(), row, 0, {
        rating,
        diffType: typeA ? 'A' : 'AC',
        sensitivity: 30,
        note: `Différentiel ${RCD_NAMES[rail.group]}`,
      }),
    );
    let col = 2;
    for (const plan of rail.plans) {
      const device = createDevice(disjDef, nextId(), row, col, {
        label: plan.label,
        dest: plan.rooms.slice(0, 3).join(', '),
        rating: plan.rating,
        usage: plan.usage,
      });
      board.devices.push(device);
      circuits.push({ plan, device });
      col += 1;
    }
  });

  // Largeur : 13 modules suffisent pour un différentiel et ses 8 circuits ; on s'élargit sinon.
  const widest = Math.max(...rails.map((r) => 2 + r.plans.length));
  board.cols = widest <= 13 ? 13 : widest <= 18 ? 18 : 24;
  return { board, circuits };
}

/**
 * Ajoute des circuits à un tableau existant : sur un rail dont le différentiel convient (type A pour
 * les circuits spécialisés) et qui a de la place, sinon sur un nouveau rail avec son différentiel.
 */
export function appendCircuits(board: Board, plans: CircuitPlan[], nextId: () => number): { plan: CircuitPlan; device: Device }[] {
  const rcdDef = getDeviceDef('idiff');
  const disjDef = getDeviceDef('disj');
  const out: { plan: CircuitPlan; device: Device }[] = [];
  if (!rcdDef || !disjDef) return out;

  for (const plan of plans) {
    const a = analyze(board);
    let target: { row: number; col: number } | null = null;

    for (let row = 0; row < board.rows && !target; row++) {
      const head = [...devicesInRow(board, row)].reverse().find((d) => getDeviceDef(d.kind)?.role === 'rcd');
      if (!head) continue;
      if (plan.group === 'special' && head.diffType !== 'A' && head.diffType !== 'F' && head.diffType !== 'HI') continue;
      const group = a.groups.find((g) => g.head?.id === head.id);
      const circuits = group?.members.filter((m) => {
        const def = getDeviceDef(m.kind);
        return def !== undefined && isCircuitRole(def);
      }).length ?? 0;
      if (circuits >= MAX_CIRCUITS_PER_RCD) continue;
      const end = devicesInRow(board, row).reduce((m, d) => Math.max(m, d.col + deviceWidth(d)), 0);
      if (canPlace(board, row, end, 1)) target = { row, col: end };
    }

    if (!target) {
      const row = board.rows;
      board.rows += 1;
      board.devices.push(
        createDevice(rcdDef, nextId(), row, 0, {
          rating: 40,
          diffType: plan.group === 'special' ? 'A' : 'AC',
          sensitivity: 30,
          note: `Différentiel ${RCD_NAMES[plan.group]}`,
        }),
      );
      target = { row, col: 2 };
    }

    const device = createDevice(disjDef, nextId(), target.row, target.col, {
      label: plan.label,
      dest: plan.rooms.slice(0, 3).join(', '),
      rating: plan.rating,
      usage: plan.usage,
    });
    board.devices.push(device);
    out.push({ plan, device });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Suggestion pour un appareil isolé
// ---------------------------------------------------------------------------------------------

/** Usage de circuit qui convient à un type de symbole (null : pas de circuit évident). */
export function usageOf(kind: string): UsageId | null {
  if (LIGHT_FAMILY.has(kind)) return 'eclairage';
  if (kind === 'prise') return 'prises';
  if (kind === 'prise_s') return 'special';
  if (kind === 'radia' || kind === 'thermo') return 'chauffage';
  if (kind === 'ce') return 'eau';
  if (kind === 'vmc' || kind === 'vr') return 'autre';
  return null;
}

export interface Suggestion {
  deviceId: number;
  /** Texte court : « circuit qui dessert déjà la cuisine ». */
  reason: string;
}

const normalize = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Appareils qui ont leur propre circuit : on ne les ajoute pas à un circuit déjà utilisé. */
const DEDICATED = new Set(['prise_s', 'ce']);

/**
 * Circuit existant qui convient à un appareil : même usage, qui dessert déjà la même pièce et qui
 * a encore de la place (pour un appareil à circuit dédié : un circuit libre qui porte son nom).
 * null s'il n'y en a pas : il faut alors un nouveau circuit.
 */
export function suggestCircuit(doc: Pick<Doc, 'items' | 'boards' | 'scale'>, item: SymbolItem): Suggestion | null {
  const usage = usageOf(item.kind);
  if (usage === null || doc.boards.length === 0) return null;
  const room = context(doc).roomName(item);
  const links = allLinks(doc);
  const wanted = normalize(item.label.trim());

  let best: { id: number; score: number; reason: string } | null = null;
  for (const board of doc.boards) {
    for (const d of board.devices) {
      const def = getDeviceDef(d.kind);
      if (!def || !isCircuitRole(def) || effectiveUsage(d) !== usage) continue;
      const l = links.get(d.id);
      const linked = l?.symbols.length ?? 0;
      let score: number;
      let reason: string;

      if (DEDICATED.has(item.kind)) {
        if (linked > 0 || wanted === '' || !normalize(d.label).includes(wanted)) continue;
        score = 200;
        reason = 'circuit libre qui porte ce nom';
      } else {
        const sameRoom = (l?.rooms.find((r) => r.label === room)?.count ?? 0) > 0;
        if (!sameRoom) continue;
        if (item.kind === 'prise') {
          const section = d.section ?? ((d.rating ?? 16) > 16 ? 2.5 : 1.5);
          if ((l?.sockets ?? 0) >= (MAX_SOCKETS_BY_SECTION[section] ?? MAX_SOCKETS)) continue;
        }
        if (LIGHTS.has(item.kind) && (l?.lights ?? 0) >= MAX_LIGHTS) continue;
        score = 100 + Math.min(linked, 20);
        reason = `circuit qui dessert déjà ${room.toLowerCase()}`;
      }
      if (!best || score > best.score) best = { id: d.id, score, reason };
    }
  }
  return best ? { deviceId: best.id, reason: best.reason } : null;
}
