import type { Cost } from './schema';

/** Espionage tuning (M16). Missions are instant agents, not units on the map. */

export const SPY_MISSIONS = ['scout', 'intel', 'sabotage', 'steal'] as const;
export type SpyMissionKind = (typeof SPY_MISSIONS)[number];

/**
 * Mission fees, paid up front and sunk whether the agent succeeds or hangs.
 * Sabotage is priced near a keep's worth of trouble; scout is a map's price.
 */
export const SPY_COST: Record<SpyMissionKind, Cost> = {
  scout: { gold: 75 },
  intel: { gold: 100 },
  sabotage: { gold: 250 },
  steal: { gold: 200 },
};

/** Days between dispatch and resolution — the agent travels, counter-play breathes. */
export const SPY_MISSION_DAYS = 3;

/** Days before ANOTHER mission may target the same realm (per realm pair). */
export const SPY_COOLDOWN_DAYS = 20;

/** Base odds of a mission landing… */
export const SPY_BASE_SUCCESS = 0.75;
/** …less this per Keep the target realm has standing (counter-espionage)… */
export const KEEP_PENALTY = 0.2;
/** …but even a fortress state leaks a little. */
export const SPY_MIN_SUCCESS = 0.15;

/**
 * Build ticks knocked off the target's most precious construction. Sixty
 * ticks is 5% of a Wonder — sabotage delays the clock, it never denies it.
 */
export const SABOTAGE_SETBACK = 60;

/** Fraction of the target's gold a successful theft carries home. */
export const STEAL_FRACTION = 0.15;
