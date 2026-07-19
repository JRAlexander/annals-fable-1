import type { ResourceId } from './schema';

/** Diplomacy tuning (M15). */

/**
 * Days a truce holds after peace is sworn. Longer than RAID_PERIOD, so the
 * wilds punctuate every peace; long enough for a beaten realm to rebuild a
 * garrison before the next war can legally begin.
 */
export const TRUCE_DAYS = 120;

/** Losing = your war power has fallen under this fraction of the enemy's. */
export const LOSING_RATIO = 0.5;

/**
 * The share of a treasury that changes hands in AI peace offers, and the
 * most a losing realm will concede when tribute is demanded of it.
 */
export const TRIBUTE_FRACTION = 0.25;

/**
 * Gold-value price of peace per 1.0 of power advantage: a dominant realm
 * wants roughly a campaign's plunder (one camp's loot) to sheath the sword.
 */
export const PEACE_BASE = 300;

/**
 * The pact against a runaway leader needs a season and a half of grievance
 * before it forms — seeds that deal the player a settlement majority open in
 * peace, not instant world war (M16 tuning).
 */
export const COALITION_GRACE_DAYS = 90;

/** Gold-equivalents for valuing mixed tribute — mirrors build-cost scarcity. */
export const RESOURCE_VALUE: Record<ResourceId, number> = {
  gold: 1,
  stone: 0.5,
  wood: 0.25,
  food: 0.25,
};
