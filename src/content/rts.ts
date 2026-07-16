import { GRID, WORLD_SIZE } from '../worldgen/types';

/** RTS-layer tuning (M7a). */

/** Hostile armies within this many world units lock into a field battle. */
export const ENGAGE_RANGE = (WORLD_SIZE / (GRID - 1)) * 1.5;

/** A pursued army is re-routed to when it strays this many cells off the path end. */
export const PURSUIT_REPATH_CELLS = 2;

/** Unit autonomy (M13). */

/**
 * How far an idle aggressive army looks for hostiles. Mirrors the app-side
 * ARMY_SIGHT_CELLS (visibility.ts) — the headless wall forbids importing it,
 * so keep the two in sync by hand.
 */
export const STANCE_SIGHT_CELLS = 6;
export const STANCE_SIGHT = (WORLD_SIZE / (GRID - 1)) * STANCE_SIGHT_CELLS;

/** How far an idle defensive army will march to intercept a raid on its realm. */
export const DEFEND_RADIUS = (WORLD_SIZE / (GRID - 1)) * 30;

/** Garrison size that triggers an auto-formed band when a rally flag is set. */
export const RALLY_BATCH = 10;

/** Villagers flee home while a hostile army stands within this range of town. */
export const FLEE_RADIUS = (WORLD_SIZE / (GRID - 1)) * 12;

/** Per-unit combat (M8b). */
export const ATTACK_COOLDOWN = 3;
/** Melee strike distance in world units. */
export const MELEE_REACH = 9;
/** World units of firing distance per point of a unit's `range` stat. */
export const RANGE_UNIT = 18;
/** Fort shield: defenders take this fraction of damage while fortHp > 0. */
export const FORT_SHIELD = 0.5;
