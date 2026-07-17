import { FORT_POWER, FORT_POWER_RAM } from '../content/rts';
import type { UnitId } from '../content/schema';
import { WILD_REALM } from '../content/threats';
import { UNITS } from '../content/units';
import { resolveStat } from './modifiers';
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

/**
 * Coarse deterministic fighting power of a roster (M14): Σ n × hp × attack,
 * tech-modified through resolveStat so a forged army genuinely scores higher.
 * NOT counter-aware — good enough for camp math (bandits field only the
 * basics), never a battle predictor. `realm` may be WILD_REALM.
 */
export function power(state: GameState, realm: number, counts: UnitCounts): number {
  let total = 0;
  for (const [type, n] of Object.entries(counts) as [UnitId, number][]) {
    if ((n ?? 0) <= 0) continue;
    const def = UNITS[type];
    if (!def) continue;
    const tag = def.tags[0];
    const hp = resolveStat({ state, realm }, def.hp, { stat: 'unitHp', unitTag: tag });
    const atk = resolveStat({ state, realm }, def.attack, { stat: 'unitAttack', unitTag: tag });
    total += (n ?? 0) * hp * atk;
  }
  return total;
}

/** What it takes to crack a camp (M14): defender power + walls, cheap to rams. */
export function campThreat(state: GameState, campId: number, attackerHasRam: boolean): number {
  const camp = state.camps[campId];
  if (!camp || camp.cleared) return 0;
  return (
    power(state, WILD_REALM, camp.defenders) + camp.fortHp * (attackerHasRam ? FORT_POWER_RAM : FORT_POWER)
  );
}
