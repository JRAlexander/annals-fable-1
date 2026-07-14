import type { UnitCounts } from './state';

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
