import type { BuildingId, Cost, ResourceId } from './schema';

/**
 * Economy tunables — data only. Every consumer routes these through
 * sim/modifiers.resolveStat, so techs and culture bonuses modify them
 * without touching this file.
 *
 * Since M12 the economy is VILLAGERS: entities that walk to a workplace or
 * resource, gather, and carry the load home to a dropoff building. The
 * gather rate emerges from trip distance — place your lumber camp by the
 * forest and your wood income rises.
 */

export type VillagerJob = 'farm' | 'wood' | 'stone' | 'gold';

/** Fixed iteration order — deterministic reconciliation depends on it. */
export const VILLAGER_JOBS: readonly VillagerJob[] = ['farm', 'wood', 'stone', 'gold'];

export const JOB_RESOURCE: Record<VillagerJob, ResourceId> = {
  farm: 'food',
  wood: 'wood',
  stone: 'stone',
  gold: 'gold',
};

/** Training price of one villager, paid at the town center. */
export const VILLAGER_COST: Cost = { food: 40 };
/** Ticks to train one villager (1.5 days). */
export const VILLAGER_TRAIN_TICKS = 15;
/** World units a villager walks per tick. */
export const VILLAGER_SPEED = 16;
/** Base load per completed gather — gatherRate modifiers multiply this. */
export const CARRY_CAPACITY = 10;
/** Ticks spent working before a load is full. */
export const GATHER_TICKS: Record<VillagerJob, number> = {
  farm: 6,
  wood: 8,
  stone: 10,
  gold: 8,
};
/** Villagers each settlement begins with. */
export const STARTING_VILLAGERS: Record<'capital' | 'town' | 'village', number> = {
  capital: 12,
  town: 8,
  village: 5,
};
/** How far (in grid cells, Chebyshev) villagers look for forest/rock. */
export const RESOURCE_SEARCH_CELLS = 28;
/** Idle villagers drift home and stand within this radius of the town center. */
export const IDLE_HOME_RADIUS = 15;

/** Food eaten per person per day. */
export const FOOD_PER_POP_DAY = 0.02;

/** Daily population growth fraction (when fed and under the housing cap). */
export const BASE_GROWTH_PER_DAY = 0.006;

/** Fraction of a settlement that dies per day at total famine (scaled by shortfall). */
export const STARVATION_RATE = 0.02;

/** Population each settlement begins with (worldgen tiers, sim numbers). */
export const STARTING_POP: Record<'capital' | 'town' | 'village', number> = {
  capital: 200,
  town: 110,
  village: 60,
};

/**
 * Buildings every settlement is seeded with at init: a Town Center and a few
 * houses. Deliberately house-only among the buildables — a second founding-age
 * building type would pre-satisfy the age-advance requirement realm-wide.
 */
export const SEED_BUILDINGS: Record<'capital' | 'town' | 'village', Partial<Record<BuildingId, number>>> = {
  capital: { townCenter: 1, house: 5 },
  town: { townCenter: 1, house: 3 },
  village: { townCenter: 1, house: 1 },
};

export const HOUSING_BASE: Record<'capital' | 'town' | 'village', number> = {
  capital: 50,
  town: 30,
  village: 20,
};

/** Per-settlement contribution to the realm's storage cap, per resource. */
export const STORAGE_BASE: Record<'capital' | 'town' | 'village', number> = {
  capital: 100,
  town: 50,
  village: 25,
};

export const STARTING_STOCK: Record<ResourceId, number> = {
  food: 500,
  wood: 400,
  stone: 250,
  gold: 200,
};

/** Pop-count thresholds worth a chronicle entry. */
export const POP_MILESTONES: readonly number[] = [100, 250, 500, 1000, 2500, 5000];
