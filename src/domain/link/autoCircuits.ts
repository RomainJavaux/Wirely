import { getDeviceDef } from '../board/catalog';
import { analyze, appendToGroup, createDevice, effectiveSection, effectiveUsage, isCircuitRole, lastUsedRow } from '../board/layout';
import type { Board, Device, DiffType, UsageId } from '../board/types';
import { LIGHT_KINDS, SOCKET_KINDS, SWITCH_KINDS } from '../catalog';
import { roomAt, roomsOf } from '../plan/metrics';
import { getRoomKind } from '../plan/roomKinds';
import { COOKER, TYPE_A_APPLIANCE, WET_APPLIANCE, rulesOf, sectionFor, type RuleSet } from '../rules';
import type { Doc, Room, RoomKind, SymbolItem } from '../types';
import { allLinks, isElectrical } from './links';

/**
 * Circuits déduits des points : on regroupe les appareils par usage et par zone, en respectant les
 * limites du pays (nombre de points par circuit, calibre, différentiel). Le résultat est un
 * brouillon à relire, pas une étude.
 */

/** Nombre de points d'éclairage par circuit au-delà duquel on en ouvre un autre. */
export const MAX_LIGHTS = 8;
/** Nombre maximal de circuits derrière un différentiel 30 mA de 40 A (repère français). */
export const MAX_CIRCUITS_PER_RCD = 8;

export type RcdGroup = 'special' | 'eclairage' | 'prises';

export interface CircuitPlan {
  label: string;
  usage: UsageId;
  rating: number;
  /** Section du câble (mm²), selon le pays. */
  section: number;
  /** Famille, pour la répartition derrière les différentiels. */
  group: RcdGroup;
  /** Belgique : circuit à placer derrière le différentiel 30 mA (salle de bains, lave-linge…). */
  wet: boolean;
  /** France : différentiel de type A requis (plaque de cuisson, lave-linge). */
  typeA: boolean;
  itemIds: number[];
  /** Pièces desservies, par ordre d'importance. */
  rooms: string[];
}

/** Petit appareillage qui suit le circuit d'éclairage de sa pièce. */
const LIGHT_FAMILY = new Set([...LIGHT_KINDS, ...SWITCH_KINDS, 'sonnette', 'fumee']);

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
  roomOf: (s: SymbolItem) => Room | null;
  roomName: (s: SymbolItem) => string;
  roomKind: (s: SymbolItem) => RoomKind | null;
}

function context(doc: Pick<Doc, 'items'>): Ctx {
  const rooms = roomsOf(doc.items);
  const roomOf = (s: SymbolItem): Room | null => roomAt(rooms, s.x, s.y);
  return {
    rooms,
    roomOf,
    roomName: (s) => {
      const r = roomOf(s);
      return r ? r.label.trim() || getRoomKind(r.kind).name : NO_ROOM;
    },
    roomKind: (s) => roomOf(s)?.kind ?? null,
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
 * Regroupe les appareils alimentés en circuits, selon les règles du pays du chantier. Par défaut,
 * seuls les appareils qui ne sont pas encore raccordés sont pris en compte.
 */
export function planCircuits(doc: Pick<Doc, 'items' | 'project'>, opts: { onlyUnlinked?: boolean } = {}): CircuitPlan[] {
  const onlyUnlinked = opts.onlyUnlinked ?? true;
  const rules = rulesOf(doc);
  const be = rules.country === 'BE';
  const ctx = context(doc);
  const all = doc.items.filter(
    (i): i is SymbolItem => i.type === 'symbol' && isElectrical(i) && (!onlyUnlinked || i.breaker === null),
  );
  const plans: CircuitPlan[] = [];
  const plan = (p: Omit<CircuitPlan, 'section' | 'rooms' | 'itemIds'> & { symbols: SymbolItem[]; section?: number }): void => {
    const { symbols, section, ...rest } = p;
    plans.push({
      ...rest,
      section: section ?? sectionFor(rules, rest.rating),
      itemIds: symbols.map((s) => s.id),
      rooms: roomsServed(symbols, ctx),
    });
  };

  // --- Belgique : les locaux humides (salle de bains, douche) ont leurs circuits, derrière le 30 mA.
  let symbols = all;
  if (be) {
    const wetRooms = ctx.rooms.filter((r) => r.kind === 'sdb');
    for (const room of wetRooms) {
      const inRoom = symbols.filter((s) => ctx.roomOf(s)?.id === room.id && s.kind !== 'prise_s' && s.kind !== 'ce');
      if (inRoom.length === 0) continue;
      symbols = symbols.filter((s) => !inRoom.includes(s));
      const name = room.label.trim() || getRoomKind(room.kind).name;
      // Circuit mixte : chaque prise, point lumineux et appareil fixe compte, 8 au plus.
      const counted = inRoom.filter((s) => !SWITCH_KINDS.has(s.kind));
      const followers = inRoom.filter((s) => SWITCH_KINDS.has(s.kind));
      const parts = chunk(counted, 8);
      parts.forEach((part, i) =>
        plan({
          label: numbered(name, i, parts.length),
          usage: part.some((s) => SOCKET_KINDS.has(s.kind)) ? 'prises' : 'eclairage',
          rating: part.some((s) => SOCKET_KINDS.has(s.kind)) ? rules.ratings.sockets : rules.ratings.lighting,
          group: 'prises',
          wet: true,
          typeA: false,
          symbols: i === 0 ? [...part, ...followers] : part,
        }),
      );
    }
  }

  // --- Éclairage : points lumineux, commandes et petit appareillage ------------------------
  const lights = symbols.filter((s) => LIGHT_KINDS.has(s.kind));
  const zones = new Map<Zone, SymbolItem[]>();
  for (const l of lights) {
    const kind = ctx.roomKind(l);
    const zone: Zone = kind ? LIGHT_ZONE[kind] : 'jour';
    zones.set(zone, [...(zones.get(zone) ?? []), l]);
  }
  const lightCircuits: { label: string; symbols: SymbolItem[] }[] = [];
  const litRooms = new Set(lights.map((l) => ctx.roomName(l))).size;
  // Deux circuits d'éclairage au moins dès que le logement compte plus de deux locaux éclairés.
  const mustSplit = lights.length > MAX_LIGHTS || (litRooms > 2 && lights.length >= rules.minLightingCircuits);
  if (!mustSplit) {
    if (lights.length > 0) lightCircuits.push({ label: 'Éclairage', symbols: lights });
  } else {
    const names: Record<Zone, string> = { jour: 'Éclairage jour', nuit: 'Éclairage nuit', ext: 'Éclairage extérieur' };
    for (const zone of ['jour', 'nuit', 'ext'] as Zone[]) {
      const parts = chunk(zones.get(zone) ?? [], MAX_LIGHTS);
      parts.forEach((p, i) => lightCircuits.push({ label: numbered(names[zone], i, parts.length), symbols: p }));
    }
    // Une seule zone occupée : on la partage en deux, pièce par pièce.
    if (lightCircuits.length === 1) {
      const only = lightCircuits[0] as { label: string; symbols: SymbolItem[] };
      const byRoom = [...new Set(only.symbols.map((s) => ctx.roomName(s)))];
      const firstHalf = new Set(byRoom.slice(0, Math.ceil(byRoom.length / 2)));
      const a = only.symbols.filter((s) => firstHalf.has(ctx.roomName(s)));
      const b = only.symbols.filter((s) => !firstHalf.has(ctx.roomName(s)));
      if (a.length > 0 && b.length > 0) {
        lightCircuits.length = 0;
        lightCircuits.push({ label: 'Éclairage 1', symbols: a }, { label: 'Éclairage 2', symbols: b });
      }
    }
  }

  // Les commandes et le petit appareillage suivent l'éclairage de leur pièce (à défaut, le premier).
  for (const f of symbols.filter((s) => LIGHT_FAMILY.has(s.kind) && !LIGHT_KINDS.has(s.kind))) {
    const room = ctx.roomName(f);
    const target = lightCircuits.find((c) => c.symbols.some((l) => ctx.roomName(l) === room)) ?? lightCircuits[0];
    if (target) target.symbols.push(f);
    else lightCircuits.push({ label: 'Éclairage', symbols: [f] });
  }
  for (const c of lightCircuits) {
    plan({ label: c.label, usage: 'eclairage', rating: rules.ratings.lighting, group: 'eclairage', wet: false, typeA: false, symbols: c.symbols });
  }

  // --- VMC et volets roulants ---------------------------------------------------------------
  const vmc = symbols.filter((s) => s.kind === 'vmc');
  if (vmc.length > 0) {
    plan({ label: be ? 'Ventilation' : 'VMC', usage: 'autre', rating: be ? 16 : 2, group: 'eclairage', wet: false, typeA: false, symbols: vmc });
  }
  const shutters = chunk(symbols.filter((s) => s.kind === 'vr'), 8);
  shutters.forEach((list, i) =>
    plan({ label: numbered('Volets roulants', i, shutters.length), usage: 'autre', rating: 16, group: 'eclairage', wet: false, typeA: false, symbols: list }),
  );

  // --- Prises, par zone ----------------------------------------------------------------------
  const socketZones = new Map<SocketZone, SymbolItem[]>();
  for (const s of symbols.filter((x) => SOCKET_KINDS.has(x.kind))) {
    const kind = ctx.roomKind(s);
    const zone: SocketZone = kind ? SOCKET_ZONE[kind] : 'sejour';
    socketZones.set(zone, [...(socketZones.get(zone) ?? []), s]);
  }
  // En France, la cuisine est câblée en 2,5 mm² (12 prises) ; ailleurs en 1,5 mm² (8 prises).
  const maxFor = (zone: SocketZone): number => (be ? 8 : zone === 'cuisine' ? 12 : 8);
  const order: SocketZone[] = ['cuisine', 'sejour', 'chambres', 'annexes', 'ext'];
  // Une petite zone (≤ 3 prises) rejoint une autre zone quand le total reste dans la limite.
  for (const zone of order) {
    const list = socketZones.get(zone);
    if (!list || list.length === 0 || list.length > 3 || zone === 'cuisine' || zone === 'ext') continue;
    const host = order
      .filter((z) => z !== zone && z !== 'cuisine' && z !== 'ext')
      .map((z) => ({ z, n: socketZones.get(z)?.length ?? 0 }))
      .filter((h) => h.n > 0 && h.n + list.length <= 8)
      .sort((a, b) => b.n - a.n)[0];
    if (host) {
      socketZones.set(host.z, [...(socketZones.get(host.z) ?? []), ...list]);
      socketZones.delete(zone);
    }
  }
  for (const zone of order) {
    const parts = chunk(socketZones.get(zone) ?? [], maxFor(zone));
    parts.forEach((part, i) => {
      const served = roomsServed(part, ctx);
      const rating = be ? rules.ratings.sockets : zone === 'cuisine' ? 20 : rules.ratings.sockets;
      plan({
        label: numbered(`Prises ${namesLabel(served)}`, i, parts.length),
        usage: 'prises',
        rating,
        // Belgique : 2,5 mm² dès qu'il y a une prise.
        section: Math.max(sectionFor(rules, rating), rules.socketMinSection),
        group: 'prises',
        wet: false,
        typeA: false,
        symbols: part,
      });
    });
  }

  // --- Appareils fixes : un circuit par appareil -------------------------------------------
  for (const s of symbols.filter((x) => x.kind === 'prise_s')) {
    const label = s.label.trim() || `Prise spécialisée ${ctx.roomName(s)}`;
    const cooking = COOKER.test(label);
    plan({
      label,
      usage: 'special',
      rating: cooking ? rules.ratings.cooker : rules.ratings.appliance,
      section: cooking ? 6 : undefined,
      group: 'special',
      wet: be && WET_APPLIANCE.test(label),
      typeA: !be && TYPE_A_APPLIANCE.test(label),
      symbols: [s],
    });
  }

  // --- Chauffage et eau chaude ------------------------------------------------------------------
  const heaters = symbols.filter((s) => s.kind === 'radia' || s.kind === 'thermo');
  chunk(heaters, 4).forEach((list, i, parts) =>
    plan({ label: numbered('Chauffage', i, parts.length), usage: 'chauffage', rating: rules.ratings.heating, group: 'prises', wet: false, typeA: false, symbols: list }),
  );
  for (const s of symbols.filter((x) => x.kind === 'ce')) {
    plan({ label: 'Chauffe-eau', usage: 'eau', rating: rules.ratings.water, group: 'prises', wet: false, typeA: false, symbols: [s] });
  }

  return plans;
}

export interface GeneratedBoard {
  board: Board;
  /** Circuits créés, dans l'ordre du tableau, avec l'appareil du tableau correspondant. */
  circuits: { plan: CircuitPlan; device: Device }[];
}

const USAGE_NAMES: Readonly<Record<UsageId, string>> = {
  eclairage: 'éclairage',
  prises: 'prises',
  special: 'circuits spécialisés',
  chauffage: 'chauffage',
  eau: 'eau chaude',
  autre: 'ventilation et volets',
};

/** « éclairage et prises » : ce que protège un différentiel. */
function railName(plans: CircuitPlan[]): string {
  const names = [...new Set(plans.map((p) => USAGE_NAMES[p.usage]))];
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

interface Rail {
  sensitivity: number;
  rating: number;
  diffType: DiffType;
  note: string;
  plans: CircuitPlan[];
}

/**
 * Belgique : un différentiel général de 300 mA en tête, qui alimente tous les circuits, puis un
 * différentiel de 30 mA pour les locaux humides et les appareils qui l'exigent.
 */
function belgianRails(plans: CircuitPlan[]): Rail[] {
  const dry = plans.filter((p) => !p.wet);
  const wet = plans.filter((p) => p.wet);
  const rails: Rail[] = [{ sensitivity: 300, rating: 40, diffType: 'A', note: 'Différentiel général', plans: dry }];
  if (wet.length > 0) {
    rails.push({ sensitivity: 30, rating: 40, diffType: 'A', note: 'Différentiel 30 mA : salle de bains, lave-linge, lave-vaisselle', plans: wet });
  }
  return rails;
}

/**
 * France : les circuits spécialisés ensemble (type A), le reste en un ou deux rails (éclairage
 * séparé des prises dès qu'il y a de quoi remplir deux rails), 8 circuits au plus par différentiel.
 */
function frenchRails(plans: CircuitPlan[]): Rail[] {
  const rail = (typeA: boolean, list: CircuitPlan[]): Rail => {
    const lightOnly = list.every((p) => p.group === 'eclairage');
    return {
      sensitivity: 30,
      rating: lightOnly && list.length <= 5 ? 25 : 40,
      diffType: typeA ? 'A' : 'AC',
      note: `Différentiel ${railName(list)}`,
      plans: list,
    };
  };
  const special = plans.filter((p) => p.group === 'special');
  const rest = plans.filter((p) => p.group !== 'special');
  const rails: Rail[] = chunk(special, MAX_CIRCUITS_PER_RCD).map((part) => rail(true, part));
  if (rest.length === 0) return rails;

  const light = rest.filter((p) => p.group === 'eclairage');
  const other = rest.filter((p) => p.group !== 'eclairage');
  if (special.length > 0 && rest.length <= MAX_CIRCUITS_PER_RCD) {
    rails.push(rail(false, rest));
  } else if (light.length > 0 && other.length > 0 && rest.length >= 4) {
    for (const part of chunk(light, MAX_CIRCUITS_PER_RCD)) rails.push(rail(false, part));
    for (const part of chunk(other, MAX_CIRCUITS_PER_RCD)) rails.push(rail(false, part));
  } else {
    for (const part of chunk(rest, MAX_CIRCUITS_PER_RCD)) rails.push(rail(false, part));
  }
  return rails;
}

function breakerPatch(plan: CircuitPlan, rules: RuleSet): Partial<Device> {
  return {
    label: plan.label,
    dest: plan.rooms.slice(0, 3).join(', '),
    rating: plan.rating,
    usage: plan.usage,
    section: plan.section,
    variant: rules.breakerVariant,
  };
}

/** Construit un tableau qui porte les circuits proposés, avec les différentiels du pays. */
export function buildBoardFromPlan(plans: CircuitPlan[], name: string, nextId: () => number, rules: RuleSet): GeneratedBoard | null {
  if (plans.length === 0) return null;
  const rcdDef = getDeviceDef('idiff');
  const disjDef = getDeviceDef('disj');
  if (!rcdDef || !disjDef) return null;

  let board: Board = { id: nextId(), name, location: '', supply: 'mono', cols: rules.boardCols, rows: 1, devices: [] };
  const circuits: { plan: CircuitPlan; device: Device }[] = [];
  const rails = rules.country === 'BE' ? belgianRails(plans) : frenchRails(plans);

  for (const rail of rails) {
    // Chaque différentiel ouvre un rail.
    const row = board.devices.length === 0 ? 0 : lastUsedRow(board) + 1;
    const head = createDevice(rcdDef, nextId(), row, 0, {
      rating: rail.rating,
      diffType: rail.diffType,
      sensitivity: rail.sensitivity,
      note: rail.note,
    });
    board = { ...board, rows: Math.max(board.rows, row + 1), devices: [...board.devices, head] };
    for (const plan of rail.plans) {
      const device = createDevice(disjDef, nextId(), 0, 0, breakerPatch(plan, rules));
      board = appendToGroup(board, head.id, device);
      const placed = board.devices.find((d) => d.id === device.id) as Device;
      circuits.push({ plan, device: placed });
    }
  }
  return { board, circuits };
}

/**
 * Ajoute des circuits à un tableau existant, derrière un différentiel qui convient (30 mA pour les
 * circuits humides en Belgique, type A et 8 circuits au plus en France), sinon derrière un nouveau.
 * Retourne le tableau modifié et les circuits créés.
 */
export function appendCircuits(
  board: Board,
  plans: CircuitPlan[],
  nextId: () => number,
  rules: RuleSet,
): { board: Board; circuits: { plan: CircuitPlan; device: Device }[] } {
  const rcdDef = getDeviceDef('idiff');
  const disjDef = getDeviceDef('disj');
  const circuits: { plan: CircuitPlan; device: Device }[] = [];
  if (!rcdDef || !disjDef) return { board, circuits };
  let next = board;

  const isCircuit = (d: Device): boolean => {
    const def = getDeviceDef(d.kind);
    return def !== undefined && isCircuitRole(def);
  };

  for (const plan of plans) {
    const a = analyze(next);
    const heads = a.groups.filter((g) => g.head !== null);
    let head: Device | null = null;

    if (rules.country === 'BE') {
      const sens = (d: Device): number => d.sensitivity ?? 30;
      const pick = plan.wet ? heads.find((g) => sens(g.head as Device) <= 30) : (heads.find((g) => sens(g.head as Device) > 30) ?? heads[0]);
      head = pick?.head ?? null;
    } else {
      const fits = heads.filter((g) => g.members.filter(isCircuit).length < MAX_CIRCUITS_PER_RCD);
      const okType = (d: Device): boolean => !plan.typeA || d.diffType === 'A' || d.diffType === 'F' || d.diffType === 'HI';
      head = fits.find((g) => okType(g.head as Device))?.head ?? null;
    }

    if (!head) {
      const row = next.devices.length === 0 ? 0 : lastUsedRow(next) + 1;
      head = createDevice(rcdDef, nextId(), row, 0, {
        rating: 40,
        diffType: rules.country === 'BE' || plan.typeA ? 'A' : 'AC',
        sensitivity: rules.country === 'BE' && !plan.wet && heads.length === 0 ? 300 : 30,
        note: rules.country === 'BE' && plan.wet ? 'Différentiel 30 mA' : `Différentiel ${USAGE_NAMES[plan.usage]}`,
      });
      next = { ...next, rows: Math.max(next.rows, row + 1), devices: [...next.devices, head] };
    }

    const device = createDevice(disjDef, nextId(), 0, 0, breakerPatch(plan, rules));
    next = appendToGroup(next, head.id, device);
    circuits.push({ plan, device: next.devices.find((d) => d.id === device.id) as Device });
  }
  return { board: next, circuits };
}

// ---------------------------------------------------------------------------------------------
// Suggestion pour un appareil isolé
// ---------------------------------------------------------------------------------------------

/** Usage de circuit qui convient à un type de symbole (null : pas de circuit évident). */
export function usageOf(kind: string): UsageId | null {
  if (LIGHT_FAMILY.has(kind)) return 'eclairage';
  if (SOCKET_KINDS.has(kind)) return 'prises';
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
export function suggestCircuit(doc: Pick<Doc, 'items' | 'boards' | 'scale' | 'project'>, item: SymbolItem): Suggestion | null {
  const usage = usageOf(item.kind);
  if (usage === null || doc.boards.length === 0) return null;
  const rules = rulesOf(doc);
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
        // Reste-t-il de la place une fois cet appareil ajouté ?
        const load = {
          sockets: (l?.sockets ?? 0) + (SOCKET_KINDS.has(item.kind) ? 1 : 0),
          lights: (l?.lights ?? 0) + (LIGHT_KINDS.has(item.kind) ? 1 : 0),
          fixed: l?.fixed ?? 0,
        };
        const limit = rules.limit(load, effectiveSection(d) ?? 2.5);
        if (limit.max !== null && limit.used > limit.max) continue;
        score = 100 + Math.min(linked, 20);
        reason = `circuit qui dessert déjà ${room.toLowerCase()}`;
      }
      if (!best || score > best.score) best = { id: d.id, score, reason };
    }
  }
  return best ? { deviceId: best.id, reason: best.reason } : null;
}
