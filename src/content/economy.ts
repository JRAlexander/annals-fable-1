import type { BuildingId, ResourceId } from './schema';

/**
 * Economy tunables — data only. Rates are per worker per TICK unless noted.
 * Every consumer routes these through sim/modifiers.resolveStat, so techs and
 * culture bonuses modify them without touching this file.
 *
 * Since M9 the free tier bases are deliberately TINY: housing, storage, and
 * worker slots come from constructed buildings (see content/buildings.ts).
 */

export type WorkJob = 'farm' | 'forest' | 'quarry' | 'trade';

/** Fixed iteration order — deterministic rounding/spill depends on it. */
export const WORK_JOBS: readonly WorkJob[] = ['farm', 'forest', 'quarry', 'trade'];

export const JOB_RESOURCE: Record<WorkJob, ResourceId> = {
  farm: 'food',
  forest: 'wood',
  quarry: 'stone',
  trade: 'gold',
};

export const BASE_GATHER_PER_TICK: Record<WorkJob, number> = {
  farm: 0.02,
  forest: 0.012,
  quarry: 0.008,
  trade: 0.01,
};

/** Fraction of a settlement's population that works. */
export const WORK_RATIO = 0.6;

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

/**
 * siteCapacity: worker slots contributed by one nearby cell of each biome.
 * Deliberately scarce relative to workforce — the land offers a living, not
 * a livelihood; constructed farms/camps/quarries (which ADD slots) are where
 * the economy actually comes from.
 */
export const SLOTS_PER_CELL = {
  farmland: 1,
  meadow: 0,
  deciduous: 1,
  pine: 1,
  rock: 1,
} as const;

/** Floor on terrain-derived slots — no settlement starts unable to feed itself at all. */
export const MIN_SITE_SLOTS: Record<'farm' | 'forest' | 'quarry', number> = {
  farm: 8,
  forest: 4,
  quarry: 2,
};

/** Trade slots: settlement base by tier, plus harbor and per-road bonuses. */
export const TRADE_BASE: Record<'capital' | 'town' | 'village', number> = {
  capital: 12,
  town: 6,
  village: 2,
};
export const TRADE_HARBOR_BONUS = 10;
export const TRADE_PER_ROAD = 4;
