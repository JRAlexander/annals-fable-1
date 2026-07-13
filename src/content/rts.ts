import { GRID, WORLD_SIZE } from '../worldgen/types';

/** RTS-layer tuning (M7a). */

/** Hostile armies within this many world units lock into a field battle. */
export const ENGAGE_RANGE = (WORLD_SIZE / (GRID - 1)) * 1.5;

/** A pursued army is re-routed to when it strays this many cells off the path end. */
export const PURSUIT_REPATH_CELLS = 2;
