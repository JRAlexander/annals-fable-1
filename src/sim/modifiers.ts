import type { BuildingId, ResourceId, Stat, UnitTag } from '../content/schema';
import type { GameState, RealmId } from './state';

/**
 * The effects engine. Every rate/cap lookup in the sim routes through
 * resolveStat, so when techs and culture bonuses land (M3/M5) their Modifier
 * records apply here — one file — as: (base + Σ adds) × Π muls, filtered by
 * the query's scope (resource/unitTag/buildingId).
 *
 * M1: no modifier sources exist yet, so this returns the base unchanged.
 */
export interface ModifierContext {
  state: GameState;
  realm: RealmId;
  settlement?: number;
}

export interface StatQuery {
  stat: Stat;
  resource?: ResourceId;
  unitTag?: UnitTag;
  buildingId?: BuildingId;
}

export function resolveStat(_ctx: ModifierContext, base: number, _q: StatQuery): number {
  return base;
}
