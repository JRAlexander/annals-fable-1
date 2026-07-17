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

/** Full autopilot (M14). */

/** A melee enemy closer than this makes a ranged unit step back (kite). */
export const KITE_MIN = MELEE_REACH * 1.5;
/**
 * Kite speed multiplier. Must stay under MELEE_REACH×0.2 (=1.8 at speed 1):
 * chasers stop at reach×0.8, so a larger backstep would carry the kiter out
 * of reach before the blow lands — melee would never connect at all.
 */
export const KITE_STEP = 1.5;
/** Rout when below this fraction of battle-start strength (was inline 0.3). */
export const ROUT_FRACTION = 0.4;

/** Marshal garrison target: min(CAP, BASE + day/RAMP_DAYS). */
export const MARSHAL_GARRISON_BASE = 12;
export const MARSHAL_GARRISON_RAMP_DAYS = 24;
export const MARSHAL_GARRISON_CAP = 40;
export const MARSHAL_TRAIN_BATCH = 5;
/** The marshal never trains the realm into famine. */
export const MARSHAL_FOOD_FLOOR = 300;
/** Garrison size that becomes a field army. */
export const MARSHAL_ARMY_SIZE = 15;
/** Marshal-flagged armies per realm (also capped by town count). */
export const MARSHAL_MAX_ARMIES = 3;
/** Pull an army home below this fraction of its mustered strength. */
export const MARSHAL_RETREAT_FRACTION = 0.5;
/** Attack a camp only with this power advantage. */
export const MARSHAL_ATTACK_RATIO = 1.5;
/** Only clear camps within this many cells of an owned town. */
export const MARSHAL_CAMP_RANGE_CELLS = 40;
/** An army this close to its station is left in peace. */
export const MARSHAL_STATION_RADIUS_CELLS = 3;
/** Camp fort contribution to threat: fortHp × this… */
export const FORT_POWER = 3;
/** …unless the attacker brings rams. */
export const FORT_POWER_RAM = 0.5;
/** Exposure score terms: an inbound wild raider, and an at-war enemy seat. */
export const RAID_PRESSURE = 3000;
export const ENEMY_PRESSURE = 2000;
