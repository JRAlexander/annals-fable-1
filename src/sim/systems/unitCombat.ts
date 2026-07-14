import { ATTACK_COOLDOWN, FORT_SHIELD, MELEE_REACH, RANGE_UNIT } from '../../content/rts';
import { UNITS } from '../../content/units';
import { resolveStat } from '../modifiers';
import type { Army, FieldUnit, GameState } from '../state';

/**
 * The per-unit battle engine (M8b). One tick of an engaged army pair:
 * every soldier picks the nearest living enemy, closes if out of reach,
 * and strikes on cooldown with the SAME per-hit formula the statistical
 * model used — max(1, attack×counter − armor) — so the counter matrix
 * carries over intact. Entirely rng-free and iterated in unit-id order:
 * deterministic to the last spear.
 *
 * Fortifications: while `fort.hp > 0`, the fort's side takes half damage
 * and enemy siege units burn the fort instead of flesh.
 */

export interface FortState {
  /** Which army the fort shields. */
  side: number;
  hp: number;
}

export interface BattleResult {
  aStrength: number;
  bStrength: number;
  fortDamage: number;
}

interface TypeStats {
  atk: number;
  armorMelee: number;
  armorPierce: number;
  speed: number;
}

/** Modifier resolution is realm-wide scans — do it once per type per tick. */
function statsFor(state: GameState, army: Army, units: { type: string }[]): Map<string, TypeStats> {
  const stats = new Map<string, TypeStats>();
  for (const u of units) {
    if (stats.has(u.type)) continue;
    const def = UNITS[u.type];
    if (!def) continue;
    const tag = def.tags[0];
    stats.set(u.type, {
      atk: resolveStat({ state, realm: army.ownerRealm }, def.attack, { stat: 'unitAttack', unitTag: tag }),
      armorMelee: resolveStat({ state, realm: army.ownerRealm }, def.armor.melee, {
        stat: 'unitArmor',
        unitTag: tag,
      }),
      armorPierce: resolveStat({ state, realm: army.ownerRealm }, def.armor.pierce, {
        stat: 'unitArmor',
        unitTag: tag,
      }),
      speed: resolveStat({ state, realm: army.ownerRealm }, def.speed, { stat: 'unitSpeed', unitTag: tag }),
    });
  }
  return stats;
}

export function fightUnits(state: GameState, a: Army, b: Army, fort?: FortState): BattleResult {
  const mine = state.units.filter((u) => u.group === a.id);
  const theirs = state.units.filter((u) => u.group === b.id);
  const aStats = statsFor(state, a, mine);
  const bStats = statsFor(state, b, theirs);
  let fortDamage = 0;

  const act = (
    unit: FieldUnit,
    own: Army,
    ownStats: Map<string, TypeStats>,
    enemySide: FieldUnit[],
    enemyArmy: Army,
    enemyStats: Map<string, TypeStats>,
  ): void => {
    if (unit.hp <= 0) return;
    if (unit.cd > 0) unit.cd--;
    const def = UNITS[unit.type];
    if (!def) return;

    // nearest living enemy, ties to the lower id (stable id-sorted arrays);
    // squared distances — 180k hypots a tick would eat the budget alone
    let target: FieldUnit | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const e of enemySide) {
      if (e.hp <= 0) continue;
      const dx = e.x - unit.x;
      const dz = e.z - unit.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        target = e;
      }
    }

    const fortToBurn = fort && fort.side === enemyArmy.id && fort.hp - fortDamage > 0;
    const reach = def.range > 0 ? def.range * RANGE_UNIT : MELEE_REACH;

    // siege engines spend their blows on the walls while walls stand
    const myStats = ownStats.get(unit.type);
    if (!myStats) return;
    if (fortToBurn && def.siegeMult) {
      if (unit.cd === 0) {
        fortDamage += myStats.atk * def.siegeMult;
        unit.cd = ATTACK_COOLDOWN;
      }
      return; // rams neither chase nor retreat
    }

    if (!target) return;
    if (bestD2 > reach * reach) {
      // close the distance
      const bestD = Math.sqrt(bestD2);
      const step = Math.min(bestD - reach * 0.8, myStats.speed * 6);
      unit.x += ((target.x - unit.x) / bestD) * step;
      unit.z += ((target.z - unit.z) / bestD) * step;
      return;
    }
    if (unit.cd > 0) return;

    const tDef = UNITS[target.type];
    const tStats = enemyStats.get(target.type);
    let atk = myStats.atk;
    const bonus = def.attackBonuses?.find((x) => x.tag === tDef?.tags[0]);
    if (bonus) atk *= bonus.mult;
    const armor = def.range > 0 ? (tStats?.armorPierce ?? 0) : (tStats?.armorMelee ?? 0);
    let dmg = Math.max(1, atk - armor);
    if (fortToBurn) dmg *= FORT_SHIELD; // the walls take half the blow
    target.hp -= dmg;
    unit.cd = ATTACK_COOLDOWN;
  };

  // one pass in global id order — deterministic, slight elder-blade advantage
  let ai = 0;
  let bi = 0;
  while (ai < mine.length || bi < theirs.length) {
    const ua = mine[ai];
    const ub = theirs[bi];
    if (ua && (!ub || ua.id < ub.id)) {
      act(ua, a, aStats, theirs, b, bStats);
      ai++;
    } else if (ub) {
      act(ub, b, bStats, mine, a, aStats);
      bi++;
    }
  }

  // bury the dead: entities out, counts down — in battle the entities lead
  const dead = new Set<number>();
  for (const u of mine) {
    if (u.hp <= 0) {
      dead.add(u.id);
      const left = (a.units[u.type] ?? 0) - 1;
      if (left <= 0) delete a.units[u.type];
      else a.units[u.type] = left;
    }
  }
  for (const u of theirs) {
    if (u.hp <= 0) {
      dead.add(u.id);
      const left = (b.units[u.type] ?? 0) - 1;
      if (left <= 0) delete b.units[u.type];
      else b.units[u.type] = left;
    }
  }
  if (dead.size > 0) state.units = state.units.filter((u) => !dead.has(u.id));

  return {
    aStrength: mine.reduce((t, u) => t + (u.hp > 0 ? 1 : 0), 0),
    bStrength: theirs.reduce((t, u) => t + (u.hp > 0 ? 1 : 0), 0),
    fortDamage,
  };
}
