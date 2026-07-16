import { WILD_REALM } from '../content/threats';
import type { Army, GameState, UnitCounts } from './state';

/**
 * Count helpers for typed unit rosters. The statistical battle model that
 * lived here (M4–M8a) was replaced by the per-unit engine in
 * systems/unitCombat.ts — battles are now fought soldier by soldier.
 */
export function totalUnits(units: UnitCounts): number {
  let t = 0;
  for (const n of Object.values(units)) t += n ?? 0;
  return t;
}

/**
 * Hostility from a realm's point of view (M13) — the autonomy scan and the
 * villagers' flee test share it. Lives here so armies.ts and villagers.ts can
 * both import it without a cycle.
 */
export function hostileToRealm(state: GameState, realm: number, other: Army): boolean {
  if (other.ownerRealm === realm) return false;
  if (other.ownerRealm === WILD_REALM) return true;
  return state.realms[realm]?.atWarWith.includes(other.ownerRealm) ?? false;
}
