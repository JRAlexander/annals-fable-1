import {
  HOUSING_BASE,
  SLOTS_PER_CELL,
  STARTING_STOCK,
  TRADE_BASE,
  TRADE_HARBOR_BONUS,
  TRADE_PER_ROAD,
  WORK_JOBS,
  WORK_RATIO,
  type WorkJob,
} from '../content/economy';
import type { AgeId, BuildingId, ResourceId, TechId, UnitId } from '../content/schema';
import { clamp } from '../core/math';
import { hidx } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
// (BanditCamp defenders reference unit ids as data — no UNITS import needed here)
import { Biome, GRID, WORLD_SIZE } from '../worldgen/types';

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
  stock: Record<ResourceId, number>; // shared AoE-style stockpile
  storageCap: Record<ResourceId, number>; // derived cache, recomputed by the storage system
  age: AgeId;
  /** Completion order — deterministic push order matters for the hash. */
  researchedTechs: TechId[];
  research: ResearchJob | null;
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
}

export interface ConstructionJob {
  building: BuildingId;
  /** Accumulated build ticks (buildSpeed-modified). */
  progress: number;
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
}

/** Live bandit camp state (site geography lives in WorldData.camps). */
export interface BanditCamp {
  id: number;
  defenders: UnitCounts;
  fortHp: number;
  loot: number;
  cleared: boolean;
}

export interface GameState {
  seed: number;
  /** Absolute tick; TICKS_PER_DAY ticks = 1 game day. */
  tick: number;
  realms: Realm[]; // index === id
  settlements: SimSettlement[]; // index === id
  armies: Army[];
  nextArmyId: number;
  camps: BanditCamp[]; // index === WorldData.camps id
  /** Static geography — regenerable from seed, EXCLUDED from the state hash. */
  world: WorldData;
}

/** Worker slots a settlement's surroundings provide, from a biome scan. */
function scanSiteCapacity(world: WorldData, siteIdx: number): Record<WorkJob, number> {
  const s = world.settlements[siteIdx];
  const cellW = WORLD_SIZE / (GRID - 1);
  const r = Math.min(10, Math.ceil(s.radius / cellW) + 3);
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
  const roads = world.roads.filter((rd) => rd.a === s.id || rd.b === s.id).length;
  cap.trade = TRADE_BASE[s.tier] + (s.isHarbor ? TRADE_HARBOR_BONUS : 0) + roads * TRADE_PER_ROAD;
  return cap;
}

/**
 * Fully derived from WorldData — draws NO rng, so `initGameState(world)` is
 * reproducible from the seed alone.
 */
export function initGameState(world: WorldData): GameState {
  const realm: Realm = {
    id: 0,
    name: `The Realm of ${world.capital.name}`,
    isPlayer: true,
    culture: null,
    stock: { ...STARTING_STOCK },
    storageCap: { food: 0, wood: 0, stone: 0, gold: 0 }, // filled by the storage system on tick 0
    age: 'founding',
    researchedTechs: [],
    research: null,
  };

  const settlements = world.settlements.map((site, idx): SimSettlement => {
    const siteCapacity = scanSiteCapacity(world, idx);
    // default allocation proportional to what the land offers — the M1 auto-assign
    const total = WORK_JOBS.reduce((t, job) => t + siteCapacity[job], 0) || 1;
    const alloc = { farm: 0, forest: 0, quarry: 0, trade: 0 };
    for (const job of WORK_JOBS) alloc[job] = siteCapacity[job] / total;
    return {
      id: site.id,
      ownerRealm: 0,
      pop: site.pop,
      popCap: HOUSING_BASE[site.tier],
      workRatio: WORK_RATIO,
      alloc,
      siteCapacity,
      buildQueue: [],
      buildings: {},
      trainQueue: [],
      garrison: {},
    };
  });

  // camps: defenders scale with distance from the capital (rng-free, from geography)
  const cap = world.capital;
  const camps: BanditCamp[] = world.camps.map((c) => {
    const dist = Math.hypot(c.i - cap.i, c.j - cap.j);
    const strength = Math.round(6 + dist * 0.35);
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

  return { seed: world.seed, tick: 0, realms: [realm], settlements, armies: [], nextArmyId: 0, camps, world };
}
