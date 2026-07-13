import type { UnitId } from '../content/schema';
import { UNITS } from '../content/units';
import type { Rng } from '../core/rng';
import { type ModifierContext, resolveStat } from './modifiers';
import type { UnitCounts } from './state';

export function totalUnits(units: UnitCounts): number {
  let t = 0;
  for (const n of Object.values(units)) t += n ?? 0;
  return t;
}

/** Stable iteration order for deterministic casualty rounding. */
function entries(units: UnitCounts): [UnitId, number][] {
  return (Object.keys(UNITS) as UnitId[])
    .filter((id) => (units[id] ?? 0) > 0)
    .map((id) => [id, units[id] as number]);
}

export interface RoundResult {
  attackerLosses: UnitCounts;
  defenderLosses: UnitCounts;
  fortDamage: number;
}

/**
 * One deterministic battle round, AoE-style per-hit mitigation:
 * each attacker contributes max(1, attack×counter − armor) damage against
 * every defender type, spread by that type's share of the defending force.
 * Ranged units volley FIRST (both sides, from pre-round counts); melee
 * retaliates with whoever survives. Siege units ignore troops and burn
 * fortifications, whose presence halves the defenders' casualties.
 */
export function resolveRound(
  attacker: UnitCounts,
  defender: UnitCounts,
  attackerCtx: ModifierContext,
  defenderCtx: ModifierContext,
  rng: Rng,
  fortHp = 0,
): RoundResult {
  const luckA = 0.9 + rng() * 0.2;
  const luckB = 0.9 + rng() * 0.2;

  const volley = (
    side: UnitCounts,
    ctx: ModifierContext,
    enemy: UnitCounts,
    enemyCtx: ModifierContext,
    ranged: boolean,
    luck: number,
    siegeBusy: boolean,
    fortShield: boolean,
  ): UnitCounts => {
    const enemyTotal = totalUnits(enemy);
    const losses: UnitCounts = {};
    if (enemyTotal <= 0) return losses;
    for (const [eid, en] of entries(enemy)) {
      const eDef = UNITS[eid];
      const share = en / enemyTotal;
      const armorBase = ranged ? eDef.armor.pierce : eDef.armor.melee;
      const armor = resolveStat(enemyCtx, armorBase, { stat: 'unitArmor', unitTag: eDef.tags[0] });
      let dmg = 0;
      for (const [aid, an] of entries(side)) {
        const aDef = UNITS[aid];
        if ((aDef.tags[0] === 'ranged') !== ranged) continue;
        if (siegeBusy && aDef.siegeMult) continue; // rams are busy on the walls
        let atk = resolveStat(ctx, aDef.attack, { stat: 'unitAttack', unitTag: aDef.tags[0] });
        const bonus = aDef.attackBonuses?.find((b) => b.tag === eDef.tags[0]);
        if (bonus) atk *= bonus.mult;
        dmg += an * Math.max(1, atk - armor);
      }
      const shield = fortShield ? 0.5 : 1;
      const raw = (dmg * share * luck * shield) / eDef.hp;
      // stochastic rounding via the combat stream: fractions eventually kill,
      // so small contingents can't hide behind floor() forever
      const whole = Math.floor(raw);
      const frac = raw - whole;
      const extra = frac > 0 && rng() < frac ? 1 : 0;
      losses[eid] = Math.min(en, whole + extra);
    }
    return losses;
  };

  // siege damage to fortifications
  let fortDamage = 0;
  if (fortHp > 0) {
    for (const [id, n] of entries(attacker)) {
      const def = UNITS[id];
      if (!def.siegeMult) continue;
      const atk = resolveStat(attackerCtx, def.attack, { stat: 'unitAttack', unitTag: def.tags[0] });
      fortDamage += n * atk * def.siegeMult;
    }
    fortDamage *= luckA;
  }
  const fortUp = fortHp - fortDamage > 0;

  // ranged volleys resolve simultaneously from pre-round counts
  const rangedOnDef = volley(attacker, attackerCtx, defender, defenderCtx, true, luckA, fortHp > 0, fortUp);
  const rangedOnAtt = volley(defender, defenderCtx, attacker, attackerCtx, true, luckB, false, false);

  // melee strikes with the survivors of the exchange of arrows
  const attAfter: UnitCounts = { ...attacker };
  const defAfter: UnitCounts = { ...defender };
  applyLosses(attAfter, rangedOnAtt);
  applyLosses(defAfter, rangedOnDef);
  const meleeOnDef = volley(attAfter, attackerCtx, defAfter, defenderCtx, false, luckA, fortHp > 0, fortUp);
  const meleeOnAtt = volley(defAfter, defenderCtx, attAfter, attackerCtx, false, luckB, false, false);

  const merge = (a: UnitCounts, b: UnitCounts): UnitCounts => {
    const out: UnitCounts = { ...a };
    for (const [id, n] of Object.entries(b)) out[id] = (out[id] ?? 0) + (n ?? 0);
    return out;
  };
  return {
    defenderLosses: merge(rangedOnDef, meleeOnDef),
    attackerLosses: merge(rangedOnAtt, meleeOnAtt),
    fortDamage,
  };
}

export function applyLosses(units: UnitCounts, losses: UnitCounts): void {
  for (const [id, n] of Object.entries(losses)) {
    const cur = units[id] ?? 0;
    const next = cur - (n ?? 0);
    if (next <= 0) delete units[id];
    else units[id] = next;
  }
}
