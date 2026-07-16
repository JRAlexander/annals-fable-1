import { CULTURE_IDS } from '../content/cultures';
import {
  HOUSING_BASE,
  MIN_SITE_SLOTS,
  SEED_BUILDINGS,
  SLOTS_PER_CELL,
  STARTING_POP,
  STARTING_STOCK,
  TRADE_BASE,
  TRADE_HARBOR_BONUS,
  TRADE_PER_ROAD,
  WORK_JOBS,
  WORK_RATIO,
  type WorkJob,
} from '../content/economy';
import type { AgeId, BuildingId, CultureId, ResourceId, TechId, UnitId } from '../content/schema';
import { clamp } from '../core/math';
import { hidx, terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
// (BanditCamp defenders reference unit ids as data — no UNITS import needed here)
import { Biome, GRID, MAX_HEIGHT, SEA_LEVEL, WORLD_SIZE } from '../worldgen/types';
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
}

export interface SimSettlement {
  /** === WorldData.settlements[id].id — static site data (name/tier/position) lives there. */
  id: number;
  ownerRealm: RealmId;
  /** Float internally; UI floors it. Live value — SettlementSite.pop stays the initial. */
  pop: number;
  /** Derived cache (housing), recomputed daily via resolveStat. */
  popCap: number;
  /** Fraction of pop that works. M2 may expose this to the player. */
  workRatio: number;
  /** Allocation weights, normalized at use. The build menu's sliders write these via command. */
  alloc: Record<WorkJob, number>;
  /** Max workers per job from surrounding terrain; buildings add on top (sim/buildings.ts). */
  siteCapacity: Record<WorkJob, number>;
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

/** Worker slots a settlement's surroundings provide, from a biome scan. */
function scanSiteCapacity(world: WorldData, siteIdx: number): Record<WorkJob, number> {
  const s = world.settlements[siteIdx];
  const cellW = WORLD_SIZE / (GRID - 1);
  const r = Math.min(4, Math.ceil(s.radius / cellW) + 1);
  const cap: Record<WorkJob, number> = { farm: 0, forest: 0, quarry: 0, trade: 0 };
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const i = clamp(s.i + di, 0, GRID - 1);
      const j = clamp(s.j + dj, 0, GRID - 1);
      switch (world.biome[hidx(i, j)]) {
        case Biome.Farmland:
          cap.farm += SLOTS_PER_CELL.farmland;
          break;
        case Biome.Meadow:
          cap.farm += SLOTS_PER_CELL.meadow;
          break;
        case Biome.Deciduous:
          cap.forest += SLOTS_PER_CELL.deciduous;
          break;
        case Biome.Pine:
          cap.forest += SLOTS_PER_CELL.pine;
          break;
        case Biome.Rock:
          cap.quarry += SLOTS_PER_CELL.rock;
          break;
        default:
          break;
      }
    }
  }
  // the land offers a living, not a livelihood — buildings carry the economy (M9)
  cap.farm = Math.max(cap.farm, MIN_SITE_SLOTS.farm);
  cap.forest = Math.max(cap.forest, MIN_SITE_SLOTS.forest);
  cap.quarry = Math.max(cap.quarry, MIN_SITE_SLOTS.quarry);
  const roads = world.roads.filter((rd) => rd.a === s.id || rd.b === s.id).length;
  cap.trade = TRADE_BASE[s.tier] + (s.isHarbor ? TRADE_HARBOR_BONUS : 0) + roads * TRADE_PER_ROAD;
  return cap;
}

const GOLDEN_ANGLE = 2.399963;

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
  });
  const realms = [
    mkRealm(0, true, playerCulture),
    mkRealm(1, false, rivalCultures[0]),
    mkRealm(2, false, rivalCultures[1]),
  ];

  const settlements = world.settlements.map((site, idx): SimSettlement => {
    const siteCapacity = scanSiteCapacity(world, idx);
    // default allocation proportional to what the land offers — the M1 auto-assign
    const total = WORK_JOBS.reduce((t, job) => t + siteCapacity[job], 0) || 1;
    const alloc = { farm: 0, forest: 0, quarry: 0, trade: 0 };
    for (const job of WORK_JOBS) alloc[job] = siteCapacity[job] / total;
    const buildings = { ...SEED_BUILDINGS[site.tier] };
    const s: SimSettlement = {
      id: site.id,
      ownerRealm: owners[idx] ?? 0,
      pop: STARTING_POP[site.tier],
      popCap: 0, // set below once the seeded buildings exist
      workRatio: WORK_RATIO,
      alloc,
      siteCapacity,
      buildQueue: [],
      buildings,
      trainQueue: [],
      garrison: {},
      placed: seedPlacements(world, site, buildings),
    };
    s.popCap = HOUSING_BASE[site.tier] + buildingContrib(s).housing;
    return s;
  });

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
    camps,
    outcome: null,
    dragonWoken: false,
    lastRaidDay: camps.map(() => -1),
    world,
  };
}
