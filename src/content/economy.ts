import type { ResourceId } from './schema';

/**
 * M1 economy tunables — data only. Rates are per worker per TICK unless noted.
 * Every consumer routes these through sim/modifiers.resolveStat, so techs and
 * culture bonuses (M3/M5) modify them without touching this file.
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
export const BASE_GROWTH_PER_DAY = 0.002;

/** Fraction of a settlement that dies per day at total famine (scaled by shortfall). */
export const STARVATION_RATE = 0.02;

export const HOUSING_BASE: Record<'capital' | 'town' | 'village', number> = {
  capital: 3200,
  town: 1500,
  village: 500,
};

/** Per-settlement contribution to the realm's storage cap, per resource. */
export const STORAGE_BASE: Record<'capital' | 'town' | 'village', number> = {
  capital: 2000,
  town: 800,
  village: 200,
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
 * Deliberately scarce relative to workforce — a capital's workers should
 * outgrow what the land offers, so that constructed farms/camps/quarries
 * (which ADD slots) are meaningful decisions rather than decoration.
 */
export const SLOTS_PER_CELL = {
  farmland: 4,
  meadow: 1,
  deciduous: 4,
  pine: 2,
  rock: 3,
} as const;

/** Trade slots: settlement base by tier, plus harbor and per-road bonuses. */
export const TRADE_BASE: Record<'capital' | 'town' | 'village', number> = {
  capital: 300,
  town: 120,
  village: 30,
};
export const TRADE_HARBOR_BONUS = 150;
export const TRADE_PER_ROAD = 60;
