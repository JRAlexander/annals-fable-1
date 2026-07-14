import { GRID, WORLD_SIZE } from '../worldgen/types';

/** RTS-layer tuning (M7a). */

/** Hostile armies within this many world units lock into a field battle. */
export const ENGAGE_RANGE = (WORLD_SIZE / (GRID - 1)) * 1.5;

/** A pursued army is re-routed to when it strays this many cells off the path end. */
export const PURSUIT_REPATH_CELLS = 2;

/** Per-unit combat (M8b). */
export const ATTACK_COOLDOWN = 3;
/** Melee strike distance in world units. */
export const MELEE_REACH = 9;
/** World units of firing distance per point of a unit's `range` stat. */
export const RANGE_UNIT = 18;
/** Fort shield: defenders take this fraction of damage while fortHp > 0. */
export const FORT_SHIELD = 0.5;
