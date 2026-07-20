import { CULTURE_IDS } from '../content/cultures';
import {
  HOUSING_BASE,
  SEED_BUILDINGS,
  STARTING_POP,
  STARTING_STOCK,
  STARTING_VILLAGERS,
  VILLAGER_JOBS,
  type VillagerJob,
} from '../content/economy';
import type { SpyMissionKind } from '../content/espionage';
import type { AgeId, BuildingId, CultureId, ResourceId, TechId, UnitId } from '../content/schema';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
// (BanditCamp defenders reference unit ids as data — no UNITS import needed here)
import { MAX_HEIGHT, SEA_LEVEL } from '../worldgen/types';
import { buildingContrib } from './buildings';

export type RealmId = number;

/** The one thing a realm researches at a time: a tech, or the age advance itself. */
export type ResearchJob =
  | { kind: 'tech'; tech: TechId; progress: number }
  | { kind: 'age'; progress: number }; // target is always the next age

export interface Realm {
  id: RealmId; // player = 0; rival realms arrive in M5
  name: string;
  isPlayer: boolean;
  culture: string | null; // set at culture select (M5)
  /** Seat of power — losing it ends the game (player) or the realm's claim (rivals). */
  capital: number;
  /** Day the realm's Wonder stood complete, or null. Victory clock reference. */
  wonderDay: number | null;
  stock: Record<ResourceId, number>; // shared AoE-style stockpile
  storageCap: Record<ResourceId, number>; // derived cache, recomputed by the storage system
  age: AgeId;
  /** Completion order — deterministic push order matters for the hash. */
  researchedTechs: TechId[];
  research: ResearchJob | null;
  atWarWith: RealmId[];
  /**
   * Day each truce lifts, by rival realm id (M15). Written symmetrically
   * like atWarWith; stale (past-day) entries are inert and never pruned.
   */
  truceUntil: Record<RealmId, number>;
  /** Day the next spy mission against each realm is allowed (M16). Inert when stale. */
  spyCooldown: Record<RealmId, number>;
  /** The marshal runs this realm's military by the book (M14). Player realms only. */
  marshal: boolean;
}

/** How an idle army occupies itself (M13). */
export type ArmyStance = 'aggressive' | 'defensive' | 'standGround';
export const ARMY_STANCES: readonly ArmyStance[] = ['aggressive', 'defensive', 'standGround'];

/** Where a settlement sends its freshly trained soldiers (M13). */
export type RallyTarget = { kind: 'army'; army: number } | { kind: 'point'; i: number; j: number };

export interface SimSettlement {
  /** === WorldData.settlements[id].id — static site data (name/tier/position) lives there. */
  id: number;
  ownerRealm: RealmId;
  /** Float internally; UI floors it. Live value — SettlementSite.pop stays the initial. */
  pop: number;
  /** Derived cache (housing), recomputed daily via resolveStat. */
  popCap: number;
  /** Desired villager count per job (absolute); the villagers system reconciles. */
  jobTargets: Record<VillagerJob, number>;
  /** Villagers in training at the town center; only the head advances. */
  villagerQueue: { remaining: number; progress: number };
  /** FIFO construction queue; only the head advances. Costs are paid at queue time. */
  buildQueue: ConstructionJob[];
  /** Completed buildings by id. */
  buildings: Partial<Record<BuildingId, number>>;
  /** FIFO unit training queue; costs and pop are paid at queue time. */
  trainQueue: TrainingJob[];
  /** Trained units stationed here, awaiting army formation. */
  garrison: UnitCounts;
  /** Day the last militia levy was raised — a people musters once a season. */
  lastLevyDay?: number;
  /** Buildings standing at player-chosen spots (subset of `buildings` counts). */
  placed: PlacedBuilding[];
  /** Where fresh troops go (M13). Cleared with `delete` — undefined keys still hash. */
  rally?: RallyTarget;
  /** The governor runs this town's villager economy by the AI's book (M13). */
  governor: boolean;
  /** The steward queues this town's buildings (and the realm's research) (M14). */
  steward: boolean;
  /**
   * This town's caravan route (M17): carts run to `target` and back while it
   * stands. Cleared with `delete` (rally pattern) — on war, capture, or an
   * explicit null setTradeRoute. trips/lastGold feed the chronicle's
   * first-arrival line and the UI status without any event memory.
   */
  trade?: { target: number; trips: number; lastGold: number };
}

export interface ConstructionJob {
  building: BuildingId;
  /** Accumulated build ticks (buildSpeed-modified). */
  progress: number;
  /** Player-chosen spot (M7b free placement); absent = auto-placed ring. */
  at?: { x: number; z: number };
}

/** A completed building standing at a player-chosen spot (M7b). */
export interface PlacedBuilding {
  building: BuildingId;
  x: number;
  z: number;
}

export interface TrainingJob {
  unit: UnitId;
  /** Units still to produce in this job (one at a time off the head). */
  remaining: number;
  progress: number;
}

export type UnitCounts = Partial<Record<UnitId, number>>;

export type ArmyObjective =
  | { kind: 'attackCamp'; camp: number }
  | { kind: 'attackSettlement'; settlement: number } // typed for M5
  | { kind: 'moveTo'; i: number; j: number } // M7a: march to a field cell and hold
  | { kind: 'attackArmy'; army: number } // M7a: pursue a hostile army
  | { kind: 'returnHome' };

/**
 * Ruler-mode armies are typed-count bundles — the M7 RTS layer will add a
 * per-unit store that feeds from these counts without reshaping commands.
 */
export interface Army {
  id: number;
  ownerRealm: RealmId;
  /** Settlement it was formed at; survivors disband back into its garrison. */
  home: number;
  units: UnitCounts;
  x: number;
  z: number;
  /** Previous tick's position — the renderer interpolates between the two. */
  prevX: number;
  prevZ: number;
  path: [number, number][];
  pathIdx: number;
  /** Fractional progress through the current path cell. */
  cellProgress: number;
  objective: ArmyObjective | null;
  phase: 'idle' | 'marching' | 'fighting' | 'returning';
  /** Idle conduct (M13): hunt, intercept raids, or stand fast. */
  stance: ArmyStance;
  /** Headcount when the army was raised — the under-strength reference (M14). */
  muster: number;
  /** Raised and commanded by the marshal (M14); absent on player-led armies. */
  marshal?: true;
  /** Cell a defensive army left to intercept — it walks back after (M13). Clear with `delete`. */
  post?: { i: number; j: number };
  /** Strength when the current battle began — the rout threshold reference. */
  battleStartStrength: number;
  /** Accumulated damage to the besieged settlement's fortifications. */
  siegeDamage?: number;
  /** Army id this army is locked in a FIELD battle with (M7a), if any. */
  engagedWith?: number;
  /** Defender armies (M8b): mustered from a camp or a town garrison; survivors return there. */
  defending?: { camp?: number; settlement?: number };
}

/**
 * A soldier on the field (M8a): the physical mirror of an army's counts.
 * `group` is the army id; owner and stats derive from it and `type`.
 */
export interface FieldUnit {
  id: number;
  type: UnitId;
  group: number;
  x: number;
  z: number;
  /** Previous tick's position — the renderer interpolates. */
  prevX: number;
  prevZ: number;
  /** Formation slot within the group, assigned at spawn. */
  slot: number;
  /** Hit points (M8b) — set at muster from unitHp modifiers. */
  hp: number;
  /** Ticks until this soldier may strike again. */
  cd: number;
}

/**
 * A working villager (M12): the economy made flesh. Walks to a workplace or
 * resource cell, gathers a load, and carries it home to a dropoff building —
 * the trip distance IS the gather rate. Owner derives from the settlement.
 */
export interface Villager {
  id: number;
  /** Home settlement id — capture converts villagers with the town. */
  settlement: number;
  job: VillagerJob | 'idle';
  phase: 'toWork' | 'working' | 'toDropoff';
  x: number;
  z: number;
  /** Previous tick's position — the renderer interpolates. */
  prevX: number;
  prevZ: number;
  /** Current leg's destination (workplace or dropoff). */
  tx: number;
  tz: number;
  /** Amount of JOB_RESOURCE[job] carried. */
  carry: number;
  /** Dwell ticks remaining while working. */
  timer: number;
}

/**
 * A dispatched spy mission awaiting its resolve day (M16). Queued by the
 * spyMission command (fee already paid); resolved by the espionage system in
 * array order — the only consumer of the reserved `ai` rng stream.
 */
export interface SpyMission {
  realm: RealmId;
  target: RealmId;
  mission: SpyMissionKind;
  /** Scout only: the settlement whose surroundings the agent maps. */
  settlement?: number;
  resolveDay: number;
}

/**
 * A trade cart on the road (M17). Its owner is always DERIVED from
 * settlements[home].ownerRealm — capture despawns the cart, so it can never
 * dangle. `target` is a snapshot of the route at departure: whenever it
 * disagrees with the settlement's live route the cart turns for home (one
 * rule covers cleared, replaced, and war-broken routes). Payouts land in
 * halves — half at the target, half at home (`banked` remembers the first)
 * — so early storage caps don't swallow whole trips.
 */
export interface Caravan {
  id: number;
  home: number;
  target: number;
  phase: 'outbound' | 'returning';
  /** True only on a completed sell leg — recalled carts come home unpaid. */
  laden: boolean;
  /** Gold already deposited at the target this trip (the first half). */
  banked: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  /** findPath cells, walked like an army's; the return leg is the reverse. */
  path: [number, number][];
  pathIdx: number;
  cellProgress: number;
}

/** Live bandit camp state (site geography lives in WorldData.camps). */
export interface BanditCamp {
  id: number;
  defenders: UnitCounts;
  fortHp: number;
  loot: number;
  cleared: boolean;
}

export type GameOutcome = { kind: 'victory'; how: 'conquest' | 'wonder' } | { kind: 'defeat' };

export interface GameState {
  seed: number;
  /** Absolute tick; TICKS_PER_DAY ticks = 1 game day. */
  tick: number;
  realms: Realm[]; // index === id
  settlements: SimSettlement[]; // index === id
  armies: Army[];
  nextArmyId: number;
  /** The physical unit layer (M8a) — one entity per fielded soldier. */
  units: FieldUnit[];
  nextUnitId: number;
  /** The working population (M12) — one entity per villager. */
  villagers: Villager[];
  nextVillagerId: number;
  /** Spy missions in flight (M16), resolved in array order on their due day. */
  missions: SpyMission[];
  /** Trade carts on the road (M17), one per market/guildhall of a routed town. */
  caravans: Caravan[];
  nextCaravanId: number;
  camps: BanditCamp[]; // index === WorldData.camps id
  /** Latched by the victory system; the sim keeps ticking after — the world lives on. */
  outcome: GameOutcome | null;
  /** True once the one dragon of this world has been woken (whether it still lives). */
  dragonWoken: boolean;
  /** Day each camp last sent raiders, keyed by camp id. -1 = never. */
  lastRaidDay: number[];
  /** Static geography — regenerable from seed, EXCLUDED from the state hash. */
  world: WorldData;
}

const GOLDEN_ANGLE = 2.399963;

/** Starting job targets per tier — farm/gold wait latent until buildings stand. */
const SEED_JOB_TARGETS: Record<'capital' | 'town' | 'village', Record<VillagerJob, number>> = {
  capital: { farm: 5, wood: 4, stone: 2, gold: 1 },
  town: { farm: 3, wood: 3, stone: 1, gold: 1 },
  village: { farm: 2, wood: 2, stone: 1, gold: 0 },
};

/**
 * Where the seeded buildings stand: the town center at the site's heart,
 * everything else on a golden-angle ring, walking outward off any water.
 * Pure geometry — identical every init, no rng.
 */
function seedPlacements(
  world: WorldData,
  site: WorldData['settlements'][number],
  buildings: Partial<Record<BuildingId, number>>,
): PlacedBuilding[] {
  const placed: PlacedBuilding[] = [{ building: 'townCenter', x: site.x, z: site.z }];
  let k = 0;
  for (const [id, count] of Object.entries(buildings)) {
    if (id === 'townCenter') continue;
    for (let n = 0; n < (count ?? 0); n++) {
      const angle = site.id * 1.7 + k++ * GOLDEN_ANGLE;
      let x = site.x;
      let z = site.z;
      for (let attempt = 0; attempt < 8; attempt++) {
        x = site.x + Math.cos(angle) * (site.radius * 0.45 + attempt * 24);
        z = site.z + Math.sin(angle) * (site.radius * 0.45 + attempt * 24);
        if (terrainHeight(world.heightmap, x, z) > SEA_LEVEL * MAX_HEIGHT + 2) break;
      }
      placed.push({ building: id, x, z });
    }
  }
  return placed;
}

/**
 * Realm seats: the player holds the capital; the two rival seats are the
 * settlements that maximize (distance to capital + distance to each other).
 * Every settlement joins its nearest seat. Pure geometry — no rng.
 */
function partitionSettlements(world: WorldData): { owners: number[]; seats: number[] } {
  const cap = world.capital;
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const others = world.settlements.filter((s) => s.id !== cap.id);
  let bestA = others[0];
  let bestB = others[1] ?? others[0];
  let bestScore = -1;
  for (const a of others) {
    for (const b of others) {
      if (a.id >= b.id) continue;
      const score = dist(a, cap) + dist(b, cap) + dist(a, b);
      if (score > bestScore) {
        bestScore = score;
        bestA = a;
        bestB = b;
      }
    }
  }
  const seats = [cap, bestA, bestB];
  const owners = world.settlements.map((s) => {
    let owner = 0;
    let best = Number.POSITIVE_INFINITY;
    seats.forEach((seat, r) => {
      const d = dist(s, seat);
      if (d < best) {
        best = d;
        owner = r;
      }
    });
    return owner;
  });
  return { owners, seats: seats.map((s) => s.id) };
}

/**
 * Fully derived from WorldData — draws NO rng, so `initGameState(world)` is
 * reproducible from the seed alone. Three realms: the player plus two AI
 * rivals holding the remaining cultures in fixed order.
 */
export function initGameState(world: WorldData, playerCulture: CultureId = 'valen'): GameState {
  const { owners, seats } =
    world.settlements.length >= 3
      ? partitionSettlements(world)
      : {
          owners: world.settlements.map(() => 0),
          seats: [world.capital.id, world.capital.id, world.capital.id],
        };
  const rivalCultures = CULTURE_IDS.filter((c) => c !== playerCulture);
  const mkRealm = (id: number, isPlayer: boolean, culture: CultureId): Realm => ({
    id,
    name: `The Realm of ${world.settlements[seats[id]]?.name ?? world.capital.name}`,
    isPlayer,
    culture,
    capital: seats[id] ?? world.capital.id,
    wonderDay: null,
    stock: { ...STARTING_STOCK },
    storageCap: { food: 0, wood: 0, stone: 0, gold: 0 }, // filled by the storage system on tick 0
    age: 'founding',
    researchedTechs: [],
    research: null,
    atWarWith: [],
    truceUntil: {},
    spyCooldown: {},
    marshal: false,
  });
  const realms = [
    mkRealm(0, true, playerCulture),
    mkRealm(1, false, rivalCultures[0]),
    mkRealm(2, false, rivalCultures[1]),
  ];

  const settlements = world.settlements.map((site, idx): SimSettlement => {
    const buildings = { ...SEED_BUILDINGS[site.tier] };
    const s: SimSettlement = {
      id: site.id,
      ownerRealm: owners[idx] ?? 0,
      pop: STARTING_POP[site.tier],
      popCap: 0, // set below once the seeded buildings exist
      jobTargets: { ...SEED_JOB_TARGETS[site.tier] },
      villagerQueue: { remaining: 0, progress: 0 },
      buildQueue: [],
      buildings,
      trainQueue: [],
      garrison: {},
      placed: seedPlacements(world, site, buildings),
      governor: false,
      steward: false,
    };
    s.popCap = HOUSING_BASE[site.tier] + buildingContrib(s).housing;
    return s;
  });

  // the founding households: villagers ring the town center, idle until the
  // first tick's reconciler puts them to work — pure geometry, no rng
  const villagers: Villager[] = [];
  let nextVillagerId = 0;
  for (const site of world.settlements) {
    const n = STARTING_VILLAGERS[site.tier];
    for (let k = 0; k < n; k++) {
      const angle = site.id * 1.3 + k * GOLDEN_ANGLE;
      let x = site.x;
      let z = site.z;
      for (let attempt = 0; attempt < 8; attempt++) {
        x = site.x + Math.cos(angle) * (site.radius * 0.3 + attempt * 20);
        z = site.z + Math.sin(angle) * (site.radius * 0.3 + attempt * 20);
        if (terrainHeight(world.heightmap, x, z) > SEA_LEVEL * MAX_HEIGHT + 2) break;
      }
      villagers.push({
        id: nextVillagerId++,
        settlement: site.id,
        job: 'idle',
        phase: 'toWork',
        x,
        z,
        prevX: x,
        prevZ: z,
        tx: x,
        tz: z,
        carry: 0,
        timer: 0,
      });
    }
  }

  // camps: defenders scale with distance from the capital (rng-free, from geography)
  const cap = world.capital;
  const camps: BanditCamp[] = world.camps.map((c) => {
    const dist = Math.hypot(c.i - cap.i, c.j - cap.j);
    const strength = Math.round(4 + dist * 0.25);
    return {
      id: c.id,
      defenders: {
        militia: strength,
        spearman: Math.floor(strength / 3),
        archer: Math.floor(strength / 4),
      },
      fortHp: 150 + Math.round(dist * 4),
      loot: 150 + Math.round(dist * 8),
      cleared: false,
    };
  });

  return {
    seed: world.seed,
    tick: 0,
    realms,
    settlements,
    armies: [],
    nextArmyId: 0,
    units: [],
    nextUnitId: 0,
    villagers,
    nextVillagerId,
    missions: [],
    caravans: [],
    nextCaravanId: 0,
    camps,
    outcome: null,
    dragonWoken: false,
    lastRaidDay: camps.map(() => -1),
    world,
  };
}
