import { ageIndex } from '../../content/ages';
import { BUILDINGS } from '../../content/buildings';
import {
  ENEMY_PRESSURE,
  MARSHAL_ARMY_SIZE,
  MARSHAL_ATTACK_RATIO,
  MARSHAL_CAMP_RANGE_CELLS,
  MARSHAL_FOOD_FLOOR,
  MARSHAL_GARRISON_BASE,
  MARSHAL_GARRISON_CAP,
  MARSHAL_GARRISON_RAMP_DAYS,
  MARSHAL_MAX_ARMIES,
  MARSHAL_RETREAT_FRACTION,
  MARSHAL_STATION_RADIUS_CELLS,
  MARSHAL_TRAIN_BATCH,
  RAID_PRESSURE,
} from '../../content/rts';
import type { ResourceId, UnitId } from '../../content/schema';
import { WILD_REALM } from '../../content/threats';
import { UNITS } from '../../content/units';
import { worldToCell } from '../../worldgen/coords';
import { campThreat, power, totalUnits } from '../combat';
import type { Command, IssuedCommand } from '../commands';
import type { GameState, Realm, SimSettlement } from '../state';
import { dateOf, isDayEnd } from '../time';

/**
 * The marshal (M14): a realm-level military autopilot for the player. Every
 * day it trains garrisons toward a target, raises marshal-flagged armies,
 * pulls the badly bled ones home to re-muster, clears bandit camps it can
 * beat, and stations the rest at the realm's most exposed towns — where the
 * M13 defensive stance takes over intercepting raiders.
 *
 * Governor-pattern: unrecorded commands generated inside the tick, pure
 * function of state, high seq base so player orders always apply first.
 * Hard limits, by design: the marshal NEVER declares war and NEVER attacks
 * another realm's settlements — conquest stays in the player's hands. It
 * commands only armies carrying the marshal flag, and only idle ones.
 */
export const MARSHAL_SEQ_BASE = 3_000_000_000;

const MELEE_PICKS: UnitId[] = ['swordsman', 'spearman', 'militia'];
const RANGED_PICKS: UnitId[] = ['archer', 'skirmisher'];

/** The best trainable unit at `s`, or null. Pre-checks every command gate. */
function pickUnit(state: GameState, realm: Realm, s: SimSettlement, now: number): UnitId | null {
  const order = now % 3 === 2 ? [...RANGED_PICKS, ...MELEE_PICKS] : [...MELEE_PICKS, ...RANGED_PICKS];
  for (const id of order) {
    const def = UNITS[id];
    if (!def) continue;
    if (ageIndex(def.requiresAge) > ageIndex(realm.age)) continue;
    if ((def.requiresTechs ?? []).some((t) => !realm.researchedTechs.includes(t))) continue;
    if (def.culture && def.culture !== realm.culture) continue;
    const trainer = Object.entries(BUILDINGS).some(
      ([bid, b]) =>
        (s.buildings[bid] ?? 0) > 0 &&
        b.functions.some((f) => f.kind === 'training' && f.units.includes(def.id)),
    );
    if (!trainer) continue;
    if (s.pop - def.popCost * MARSHAL_TRAIN_BATCH < 30) continue;
    const affordable = (Object.entries(def.cost) as [ResourceId, number][]).every(
      ([res, amt]) => realm.stock[res] >= amt * MARSHAL_TRAIN_BATCH,
    );
    if (!affordable) continue;
    return id;
  }
  return null;
}

/**
 * How much trouble a town is in: nearby uncleared camps (by threat over
 * distance), at-war enemy seats, and raiders already on the road to it.
 * Exported for tests and the M14b UI.
 */
export function exposure(state: GameState, realmId: number, town: SimSettlement): number {
  const site = state.world.settlements[town.id];
  let score = 0;
  for (const camp of state.camps) {
    if (camp.cleared) continue;
    const c = state.world.camps[camp.id];
    score += campThreat(state, camp.id, false) / Math.max(4, Math.hypot(c.i - site.i, c.j - site.j));
  }
  const realm = state.realms[realmId];
  for (const enemyId of realm?.atWarWith ?? []) {
    const enemy = state.realms[enemyId];
    if (!enemy) continue;
    if (state.settlements[enemy.capital]?.ownerRealm !== enemyId) continue; // a fallen seat presses no one
    const seat = state.world.settlements[enemy.capital];
    score += ENEMY_PRESSURE / Math.max(4, Math.hypot(seat.i - site.i, seat.j - site.j));
  }
  for (const a of state.armies) {
    if (a.ownerRealm !== WILD_REALM) continue;
    if (a.objective?.kind === 'attackSettlement' && a.objective.settlement === town.id) {
      score += RAID_PRESSURE;
    }
  }
  return score;
}

export function marshalSystem(state: GameState): IssuedCommand[] {
  if (!isDayEnd(state.tick)) return [];
  const out: IssuedCommand[] = [];
  const day = dateOf(state.tick).day;

  for (const realm of state.realms) {
    if (!realm.isPlayer || !realm.marshal) continue;
    let n = 0;
    const issue = (cmd: Command) =>
      out.push({ tick: state.tick, realm: realm.id, seq: MARSHAL_SEQ_BASE + n++, cmd });
    const towns = state.settlements.filter((s) => s.ownerRealm === realm.id);
    if (towns.length === 0) continue;

    // (a) train the garrisons toward a slowly rising target; a rally flag
    // means the player has other plans for this town's soldiers — hands off
    const target = Math.min(
      MARSHAL_GARRISON_CAP,
      MARSHAL_GARRISON_BASE + Math.floor(day / MARSHAL_GARRISON_RAMP_DAYS),
    );
    for (const s of towns) {
      if (s.rally) continue;
      if ((s.buildings.barracks ?? 0) <= 0) continue;
      if (realm.stock.food <= MARSHAL_FOOD_FLOOR) break; // never train into famine
      const now = totalUnits(s.garrison) + s.trainQueue.reduce((t, q) => t + q.remaining, 0);
      if (now >= target) continue;
      const unit = pickUnit(state, realm, s, now);
      if (unit) issue({ kind: 'trainUnits', settlement: s.id, unit, count: MARSHAL_TRAIN_BATCH });
    }

    // (b) a full garrison takes the field under the marshal's banner
    const marshalArmies = state.armies.filter(
      (a) => a.ownerRealm === realm.id && a.marshal && totalUnits(a.units) > 0,
    );
    const armyCap = Math.min(MARSHAL_MAX_ARMIES, towns.length);
    let forming = 0;
    for (const s of towns) {
      if (s.rally) continue;
      if (marshalArmies.length + forming >= armyCap) break;
      if (totalUnits(s.garrison) >= MARSHAL_ARMY_SIZE) {
        issue({ kind: 'formArmy', settlement: s.id, units: { ...s.garrison }, marshal: true });
        forming++;
      }
    }

    // (c) the badly bled go home to re-muster — BEFORE any new tasking
    const spoken = new Set<number>(); // armies ordered this pass
    for (const a of marshalArmies) {
      if (a.phase === 'fighting' || a.defending) continue;
      if (a.objective?.kind === 'returnHome') continue;
      if (totalUnits(a.units) < MARSHAL_RETREAT_FRACTION * a.muster) {
        issue({ kind: 'orderArmy', army: a.id, objective: { kind: 'returnHome' } });
        spoken.add(a.id);
      }
    }

    // (d) idle armies clear camps they can beat, nearest first
    const claimed = new Set<number>();
    for (const a of marshalArmies) {
      if (a.objective?.kind === 'attackCamp') claimed.add(a.objective.camp);
    }
    for (const a of marshalArmies) {
      if (spoken.has(a.id) || a.phase !== 'idle' || a.objective) continue;
      let best: number | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const camp of state.camps) {
        if (camp.cleared || claimed.has(camp.id)) continue;
        const c = state.world.camps[camp.id];
        const nearTown = towns.some((t) => {
          const ts = state.world.settlements[t.id];
          return Math.hypot(ts.i - c.i, ts.j - c.j) <= MARSHAL_CAMP_RANGE_CELLS;
        });
        if (!nearTown) continue;
        const d = (c.x - a.x) ** 2 + (c.z - a.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = camp.id;
        }
      }
      if (best === null) continue;
      const hasRam = (a.units.ram ?? 0) > 0;
      if (power(state, realm.id, a.units) >= MARSHAL_ATTACK_RATIO * campThreat(state, best, hasRam)) {
        issue({ kind: 'orderArmy', army: a.id, objective: { kind: 'attackCamp', camp: best } });
        claimed.add(best);
        spoken.add(a.id);
      }
    }

    // (e) whoever remains stands guard where the danger is greatest
    const ranked = towns
      .map((t) => ({ t, e: exposure(state, realm.id, t) }))
      .sort((x, y) => y.e - x.e || x.t.id - y.t.id);
    const free = marshalArmies.filter((a) => !spoken.has(a.id) && a.phase === 'idle' && !a.objective);
    let k = 0;
    for (const { t } of ranked) {
      if (k >= free.length) break;
      const a = free[k++];
      const site = state.world.settlements[t.id];
      const at = worldToCell(a.x, a.z);
      const away = Math.max(Math.abs(at.i - site.i), Math.abs(at.j - site.j));
      if (away <= MARSHAL_STATION_RADIUS_CELLS) continue; // already on station
      issue({ kind: 'orderArmy', army: a.id, objective: { kind: 'moveTo', i: site.i, j: site.j } });
    }
  }
  return out;
}
