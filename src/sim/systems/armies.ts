import { DEFEND_RADIUS, ENGAGE_RANGE, ROUT_FRACTION, STANCE_SIGHT } from '../../content/rts';
import type { ResourceId, UnitId } from '../../content/schema';
import {
  CAPTURE_VILLAGER_LOSS,
  DRAGON_HOARD,
  RAID_PLUNDER,
  RAID_POP_MULT,
  RAID_VILLAGER_LOSS,
  WILD_REALM,
} from '../../content/threats';
import { UNITS } from '../../content/units';
import { cellPos, hidx, worldToCell } from '../../worldgen/coords';
import { settlementFortHp } from '../buildings';
import { totalUnits } from '../combat';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import { findPath } from '../pathfind';
import type { Army, GameState, SimSettlement } from '../state';
import { dateOf } from '../time';
import { musterDefenders, reconcileUnits, steerUnits } from '../unitStore';
import { dragonTarget } from './threats';
import { type FortState, fightUnits } from './unitCombat';
import { killVillagers } from './villagers';

/** Base march rate in path-cells per tick, scaled by unit speed and terrain. */
const MARCH_RATE = 0.35;

function slowestSpeed(state: GameState, army: Army): number {
  let slowest = Number.POSITIVE_INFINITY;
  for (const id of Object.keys(army.units) as UnitId[]) {
    if ((army.units[id] ?? 0) <= 0) continue;
    const def = UNITS[id];
    if (!def) continue;
    const v = resolveStat({ state, realm: army.ownerRealm }, def.speed, {
      stat: 'unitSpeed',
      unitTag: def.tags[0],
    });
    slowest = Math.min(slowest, v);
  }
  return Number.isFinite(slowest) ? slowest : 1;
}

export function routePath(state: GameState, army: Army, toI: number, toJ: number): void {
  const from = state.world.settlements[army.home];
  // route from the army's current cell (nearest to x/z) — home for fresh armies
  const cur = army.path[army.pathIdx] ?? [from.i, from.j];
  army.path = findPath(state.world, cur[0], cur[1], toI, toJ);
  army.pathIdx = 0;
  army.cellProgress = 0;
}

/** Hostile = different banners AND (a wild side, or an open war between realms). */
export function hostile(state: GameState, a: Army, b: Army): boolean {
  if (a.ownerRealm === b.ownerRealm) return false;
  if (a.ownerRealm === WILD_REALM || b.ownerRealm === WILD_REALM) return true;
  return state.realms[a.ownerRealm]?.atWarWith.includes(b.ownerRealm) ?? false;
}

/**
 * Unit autonomy (M13): an idle army with no standing orders looks for work by
 * its stance. Aggressive hunts any hostile in sight; defensive marches out to
 * meet raiders bound for its realm's towns, remembering the post it left so
 * it can walk back after. Deterministic: array order, strict distance compare
 * (first-lowest-id wins ties), no rng.
 */
function autonomyScan(state: GameState, army: Army): void {
  if (army.ownerRealm === WILD_REALM || army.defending) return;
  if (army.objective) return; // standing orders are not the scan's to override

  let quarry: Army | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  if (army.stance === 'aggressive') {
    const reach = STANCE_SIGHT * STANCE_SIGHT;
    for (const other of state.armies) {
      if (other.id === army.id || totalUnits(other.units) <= 0) continue;
      if (!hostile(state, army, other)) continue;
      const d = (other.x - army.x) ** 2 + (other.z - army.z) ** 2;
      if (d <= reach && d < bestD) {
        bestD = d;
        quarry = other;
      }
    }
  } else if (army.stance === 'defensive') {
    const reach = DEFEND_RADIUS * DEFEND_RADIUS;
    for (const other of state.armies) {
      if (totalUnits(other.units) <= 0) continue;
      if (other.ownerRealm !== WILD_REALM || other.objective?.kind !== 'attackSettlement') continue;
      if (state.settlements[other.objective.settlement]?.ownerRealm !== army.ownerRealm) continue;
      const d = (other.x - army.x) ** 2 + (other.z - army.z) ** 2;
      if (d <= reach && d < bestD) {
        bestD = d;
        quarry = other;
      }
    }
  }

  if (quarry) {
    // a defender remembers where it stood; the hunt is a round trip
    if (army.stance === 'defensive' && !army.post) {
      const { i, j } = worldToCell(army.x, army.z);
      army.post = { i, j };
    }
    army.objective = { kind: 'attackArmy', army: quarry.id };
    army.phase = 'marching';
    const { i, j } = worldToCell(quarry.x, quarry.z);
    routePath(state, army, i, j);
    return;
  }

  // nothing to fight: walk back to the post, and stand down on arrival
  if (army.post) {
    const { i, j } = worldToCell(army.x, army.z);
    if (i === army.post.i && j === army.post.j) {
      delete army.post;
    } else {
      army.objective = { kind: 'moveTo', i: army.post.i, j: army.post.j };
      army.phase = 'marching';
      routePath(state, army, army.post.i, army.post.j);
    }
  }
}

/**
 * Lock hostile army pairs within ENGAGE_RANGE into field battles (M7a).
 * Deterministic pairing: ascending id, first free hostile neighbor wins.
 */
function detectEngagements(state: GameState, out: SimEvent[]): void {
  for (const a of state.armies) {
    if (a.engagedWith !== undefined) continue;
    for (const b of state.armies) {
      if (b.id <= a.id || b.engagedWith !== undefined) continue;
      if (!hostile(state, a, b)) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) > ENGAGE_RANGE) continue;
      a.engagedWith = b.id;
      b.engagedWith = a.id;
      a.phase = 'fighting';
      b.phase = 'fighting';
      a.battleStartStrength = totalUnits(a.units);
      b.battleStartStrength = totalUnits(b.units);
      out.push({ kind: 'armiesEngaged', a: a.id, b: b.id });
      break;
    }
  }
}

/**
 * After a battle: defenders go back behind their walls (the army dissolves —
 * returns false), field armies pick their march back up (returns true).
 */
function resumeAfterBattle(state: GameState, army: Army): boolean {
  army.engagedWith = undefined;
  if (army.defending) {
    if (army.defending.camp !== undefined) {
      const camp = state.camps[army.defending.camp];
      if (camp && !camp.cleared) {
        for (const [t, n] of Object.entries(army.units)) {
          camp.defenders[t] = (camp.defenders[t] ?? 0) + (n ?? 0);
        }
      }
    } else if (army.defending.settlement !== undefined) {
      const s = state.settlements[army.defending.settlement];
      if (s) {
        for (const [t, n] of Object.entries(army.units)) {
          s.garrison[t] = (s.garrison[t] ?? 0) + (n ?? 0);
        }
      }
    }
    return false; // the defender army dissolves; its soldiers are home
  }
  const o = army.objective;
  if (!o || o.kind === 'moveTo') {
    // holding orders: finish the walk if any remains, else stand
    army.phase = army.pathIdx < army.path.length - 1 ? 'marching' : 'idle';
    return true;
  }
  if (o.kind === 'returnHome') {
    army.phase = 'returning';
    const home = state.world.settlements[army.home];
    routePath(state, army, home.i, home.j);
    return true;
  }
  // re-route to the standing objective; arrival transitions re-fire there
  army.phase = 'marching';
  if (o.kind === 'attackCamp') {
    const site = state.world.camps[o.camp];
    if (site) routePath(state, army, site.i, site.j);
  } else if (o.kind === 'attackSettlement') {
    const site = state.world.settlements[o.settlement];
    if (site) routePath(state, army, site.i, site.j);
  } else if (o.kind === 'attackArmy') {
    const target = state.armies.find((x) => x.id === o.army);
    if (target) {
      const { i, j } = worldToCell(target.x, target.z);
      routePath(state, army, i, j);
    } else {
      army.objective = null;
      army.phase = 'idle';
    }
  }
  return true;
}

/** Send an army home after its work is done. */
function goHomeward(state: GameState, army: Army): void {
  army.objective = { kind: 'returnHome' };
  army.phase = 'returning';
  const home = state.world.settlements[army.home];
  if (home) routePath(state, army, home.i, home.j);
}

/** The camp falls: cleared, looted, the victor turns for home. */
function campFalls(state: GameState, army: Army, campId: number, out: SimEvent[]): void {
  const camp = state.camps[campId];
  if (!camp || camp.cleared) return;
  camp.cleared = true;
  camp.defenders = {};
  if (state.realms[army.ownerRealm]) state.realms[army.ownerRealm].stock.gold += camp.loot;
  out.push({ kind: 'campCleared', army: army.id, camp: camp.id, loot: camp.loot });
  goHomeward(state, army);
}

/**
 * The town falls to `army`. Wild attackers plunder and move on (returns true
 * when the band dissolves); realm attackers capture. Mirrors the M6 rules.
 */
function settlementFalls(state: GameState, army: Army, target: SimSettlement, out: SimEvent[]): boolean {
  if (army.ownerRealm === WILD_REALM) {
    const owner = state.realms[target.ownerRealm];
    let plunder = 0;
    for (const res of Object.keys(owner.stock) as ResourceId[]) {
      const taken = Math.floor(owner.stock[res] * RAID_PLUNDER);
      owner.stock[res] -= taken;
      plunder += taken;
    }
    target.pop = Math.floor(target.pop * RAID_POP_MULT);
    killVillagers(state, target.id, RAID_VILLAGER_LOSS); // the fields are not spared
    out.push({ kind: 'settlementRaided', settlement: target.id, plunder });
    if ((army.units.dragon ?? 0) > 0) {
      const next = dragonTarget(state, target.id);
      army.engagedWith = undefined;
      army.objective = { kind: 'attackSettlement', settlement: next };
      army.phase = 'marching';
      army.siegeDamage = 0;
      const site = state.world.settlements[next];
      routePath(state, army, site.i, site.j);
      return false; // the dragon is never sated
    }
    return true; // raider bands dissolve back into the wilds
  }
  const from = target.ownerRealm;
  target.ownerRealm = army.ownerRealm;
  target.pop = Math.floor(target.pop * 0.9);
  // most villagers survive a change of banner — their loads now feed the captor
  killVillagers(state, target.id, CAPTURE_VILLAGER_LOSS);
  target.garrison = {};
  target.trainQueue = [];
  // the captor's writ replaces the old orders (M13/M14)
  delete target.rally;
  target.governor = false;
  target.steward = false;
  out.push({ kind: 'settlementCaptured', settlement: target.id, by: army.ownerRealm, from });
  army.engagedWith = undefined;
  goHomeward(state, army);
  return false;
}

/**
 * Marching, arrival transitions, and battles (one round per tick while
 * fighting). Uses the combat stream — its draws are part of the timeline.
 */
export function armiesSystem(state: GameState, out: SimEvent[]): void {
  detectEngagements(state, out);
  const survivors: Army[] = [];
  for (const army of state.armies) {
    army.prevX = army.x;
    army.prevZ = army.z;

    if (totalUnits(army.units) <= 0) {
      out.push({ kind: 'armyDestroyed', army: army.id, realm: army.ownerRealm });
      continue;
    }

    switch (army.phase) {
      case 'idle': {
        // stale siege objectives (target fell to someone else) route home
        const o = army.objective;
        if (o?.kind === 'attackCamp' && (state.camps[o.camp]?.cleared ?? true)) goHomeward(state, army);
        else if (o?.kind === 'attackSettlement') {
          const t = state.settlements[o.settlement];
          if (!t || t.ownerRealm === army.ownerRealm) goHomeward(state, army);
        }
        if (army.phase === 'idle') autonomyScan(state, army); // stance work (M13)
        survivors.push(army);
        break;
      }

      case 'marching':
      case 'returning': {
        // pursuit: keep the path pinned to a moving quarry
        if (army.objective?.kind === 'attackArmy') {
          const quarry = state.armies.find((x) => x.id === (army.objective as { army: number }).army);
          if (!quarry || totalUnits(quarry.units) <= 0) {
            army.objective = null;
            army.phase = 'idle';
            survivors.push(army);
            break;
          }
          const { i: qi, j: qj } = worldToCell(quarry.x, quarry.z);
          // within one cell of the path end, ENGAGE_RANGE (1.5 cells) must trigger
          const end = army.path[army.path.length - 1];
          if (Math.max(Math.abs(end[0] - qi), Math.abs(end[1] - qj)) > 1) {
            routePath(state, army, qi, qj);
          }
        }
        const speed = slowestSpeed(state, army);
        const [ci, cj] = army.path[Math.min(army.pathIdx, army.path.length - 1)];
        const nav = Math.max(0.5, state.world.navCost[hidx(ci, cj)] || 1);
        army.cellProgress += (MARCH_RATE * speed) / nav;
        while (army.cellProgress >= 1 && army.pathIdx < army.path.length - 1) {
          army.cellProgress -= 1;
          army.pathIdx += 1;
        }
        const [i, j] = army.path[army.pathIdx];
        const [ni, nj] = army.path[Math.min(army.pathIdx + 1, army.path.length - 1)];
        const p0 = cellPos(i, j);
        const p1 = cellPos(ni, nj);
        const t = Math.min(army.cellProgress, 1);
        army.x = p0.x + (p1.x - p0.x) * t;
        army.z = p0.z + (p1.z - p0.z) * t;

        const arrived = army.pathIdx >= army.path.length - 1;
        if (arrived) {
          if (army.objective?.kind === 'moveTo') {
            // holding position in the field — the ground is taken
            army.phase = 'idle';
            army.objective = null;
            survivors.push(army);
            break;
          }
          if (army.objective?.kind === 'attackArmy') {
            // in range the engagement pass locks us in; otherwise keep hunting
            survivors.push(army);
            break;
          }
          if (army.phase === 'returning' || !army.objective || army.objective.kind === 'returnHome') {
            // disband into the home garrison
            const s = state.settlements[army.home];
            for (const [id, n] of Object.entries(army.units)) {
              s.garrison[id] = (s.garrison[id] ?? 0) + (n ?? 0);
            }
            out.push({ kind: 'armyReturned', army: army.id, settlement: army.home });
            continue; // army entity dissolves
          }
          if (army.objective.kind === 'attackCamp') {
            const camp = state.camps[army.objective.camp];
            if (!camp || camp.cleared) {
              goHomeward(state, army);
            } else {
              out.push({ kind: 'battleStarted', army: army.id, camp: camp.id });
              const defended = state.armies.some((x) => x.defending?.camp === camp.id);
              if (!defended && totalUnits(camp.defenders) > 0) {
                // the bandits pour out of the palisade to meet us (M8b)
                const site = state.world.camps[camp.id];
                musterDefenders(state, WILD_REALM, camp.defenders, site.x, site.z, { camp: camp.id });
                camp.defenders = {};
                army.phase = 'idle'; // the engagement pass locks the pair next tick
              } else if (!defended) {
                campFalls(state, army, camp.id, out); // nobody home
              } else {
                army.phase = 'idle'; // wait our turn against the defenders
              }
            }
          } else if (army.objective.kind === 'attackSettlement') {
            const target = state.settlements[army.objective.settlement];
            if (!target || target.ownerRealm === army.ownerRealm) {
              // captured by someone else mid-march (or already ours) — go home
              army.objective = { kind: 'returnHome' };
              army.phase = 'returning';
              const home = state.world.settlements[army.home];
              routePath(state, army, home.i, home.j);
            } else {
              // the town raises a levy of militia from its people — but a
              // people bled by repeated alarms cannot muster twice in a season
              const day = dateOf(state.tick).day;
              if (day - (target.lastLevyDay ?? -999) >= 30) {
                target.lastLevyDay = day;
                const levy = Math.max(5, Math.floor(target.pop * 0.05));
                target.pop = Math.max(0, target.pop - levy);
                target.garrison.militia = (target.garrison.militia ?? 0) + levy;
                out.push({ kind: 'levyRaised', settlement: target.id, count: levy });
              }
              out.push({ kind: 'siegeStarted', army: army.id, settlement: target.id });
              const defended = state.armies.some((x) => x.defending?.settlement === target.id);
              if (!defended && totalUnits(target.garrison) > 0) {
                // the garrison mans the walls as a real fighting force (M8b)
                const site = state.world.settlements[target.id];
                musterDefenders(state, target.ownerRealm, target.garrison, site.x, site.z, {
                  settlement: target.id,
                });
                target.garrison = {};
                army.phase = 'idle';
              } else if (!defended) {
                // an undefended town falls at once
                if (settlementFalls(state, army, target, out)) {
                  break; // the wild band melts away — the army is no more
                }
              } else {
                army.phase = 'idle';
              }
            }
          }
        }
        survivors.push(army);
        break;
      }

      case 'fighting': {
        if (army.engagedWith !== undefined) {
          fightField(state, army, out, survivors);
          break;
        }
        // battle over (or never begun): defenders go home, field armies resume
        if (resumeAfterBattle(state, army)) survivors.push(army);
        break;
      }
      default:
        survivors.push(army);
    }
  }
  state.armies = survivors;

  // the physical layer follows (M8a): orphaned soldiers vanish with their
  // army, casualties thin the ranks, and everyone steps toward their slot
  const alive = new Set(survivors.map((a) => a.id));
  if (state.units.some((u) => !alive.has(u.group))) {
    state.units = state.units.filter((u) => alive.has(u.group));
  }
  for (const a of state.armies) reconcileUnits(state, a);
  steerUnits(state);
}

/**
 * One tick of an engaged battle (M8b): the per-unit engine resolves blows;
 * this wrapper handles forts, outcomes, routs, and where the survivors go.
 * Runs once per pair per tick, from the LOWER army id.
 */
function fightField(state: GameState, army: Army, out: SimEvent[], survivors: Army[]): void {
  const foe = state.armies.find((x) => x.id === army.engagedWith);
  if (!foe || totalUnits(foe.units) <= 0) {
    if (resumeAfterBattle(state, army)) survivors.push(army);
    return;
  }
  if (army.id > foe.id) {
    survivors.push(army); // the lower id runs the round; we hold this tick
    return;
  }

  // roles: at most one side is a mustered defender; forts shield that side
  const defender = army.defending ? army : foe.defending ? foe : null;
  const attacker = defender === army ? foe : army;
  let fort: FortState | undefined;
  let fortCamp = -1;
  let fortSiege = false;
  if (defender?.defending?.camp !== undefined) {
    fortCamp = defender.defending.camp;
    const camp = state.camps[fortCamp];
    if (camp) fort = { side: defender.id, hp: Math.max(0, camp.fortHp) };
  } else if (defender?.defending?.settlement !== undefined) {
    const town = state.settlements[defender.defending.settlement];
    if (town) {
      // town center + palisades + walls + keep — all constructed (M9)
      const hp = settlementFortHp(town) - (attacker.siegeDamage ?? 0);
      fort = { side: defender.id, hp: Math.max(0, hp) };
      fortSiege = true;
    }
  }

  const attackerWasDragon = (attacker.units.dragon ?? 0) > 0;
  const result = fightUnits(state, army, foe, fort);
  if (result.fortDamage > 0) {
    if (fortCamp >= 0) {
      const camp = state.camps[fortCamp];
      if (camp) camp.fortHp = Math.max(0, camp.fortHp - result.fortDamage);
    } else if (fortSiege) {
      attacker.siegeDamage = (attacker.siegeDamage ?? 0) + result.fortDamage;
    }
  }

  const mine = result.aStrength;
  const theirs = result.bStrength;

  /** Victory bookkeeping, role-aware. Returns true if the WINNER dissolves. */
  const wins = (winner: Army, loser: Army): boolean => {
    winner.engagedWith = undefined;
    loser.engagedWith = undefined;
    if (loser.defending?.camp !== undefined) {
      campFalls(state, winner, loser.defending.camp, out);
      return false;
    }
    if (loser.defending?.settlement !== undefined) {
      const town = state.settlements[loser.defending.settlement];
      if (town && town.ownerRealm !== winner.ownerRealm) return settlementFalls(state, winner, town, out);
      goHomeward(state, winner);
      return false;
    }
    // the loser was in the open field
    if (loser === attacker && winner.defending?.settlement !== undefined) {
      if (attackerWasDragon) {
        state.realms[winner.ownerRealm].stock.gold += DRAGON_HOARD;
        out.push({ kind: 'dragonSlain', realm: winner.ownerRealm, hoard: DRAGON_HOARD });
      } else {
        out.push({ kind: 'siegeRepelled', army: loser.id, settlement: winner.defending.settlement });
      }
      return false;
    }
    if (loser === attacker && winner.defending?.camp !== undefined) {
      out.push({ kind: 'battleLost', army: loser.id, camp: winner.defending.camp });
      return false;
    }
    out.push({ kind: 'fieldBattleWon', winner: winner.id, loser: loser.id });
    return false;
  };

  if (mine <= 0 && theirs <= 0) {
    out.push({ kind: 'armyDestroyed', army: army.id, realm: army.ownerRealm });
    foe.engagedWith = undefined; // its own destroyed-check drops it later this tick
    return;
  }
  if (theirs <= 0) {
    const dissolves = wins(army, foe);
    if (!dissolves) {
      if (army.defending) {
        if (resumeAfterBattle(state, army)) survivors.push(army);
      } else {
        if (army.phase === 'fighting') {
          if (resumeAfterBattle(state, army)) survivors.push(army);
        } else {
          survivors.push(army); // wins() already routed us (home / next prey)
        }
      }
    }
    return; // the dead foe is dropped by its own top-of-loop check
  }
  if (mine <= 0) {
    const dissolves = wins(foe, army);
    if (dissolves) foe.units = {}; // wild band melts after plunder — reconciled away
    out.push({ kind: 'armyDestroyed', army: army.id, realm: army.ownerRealm });
    return; // we are not pushed — the army is no more
  }
  // routs: never the wilds, never a garrison fighting for its home
  const myStart = army.battleStartStrength || mine;
  const foeStart = foe.battleStartStrength || theirs;
  const flee = (loser: Army): void => {
    loser.engagedWith = undefined;
    out.push({ kind: 'armyRouted', army: loser.id, camp: -1 });
    loser.objective = { kind: 'returnHome' };
    loser.phase = 'returning';
    const home = state.world.settlements[loser.home];
    if (home) routePath(state, loser, home.i, home.j);
  };
  const iRout = army.ownerRealm !== WILD_REALM && !army.defending && mine < myStart * ROUT_FRACTION;
  const foeRouts = foe.ownerRealm !== WILD_REALM && !foe.defending && theirs < foeStart * ROUT_FRACTION;
  if (iRout || foeRouts) {
    if (iRout) {
      flee(army);
      survivors.push(army);
    }
    if (foeRouts) flee(foe); // foe moves on its own later turn this tick
    if (!iRout) {
      out.push({ kind: 'fieldBattleWon', winner: army.id, loser: foe.id });
      if (resumeAfterBattle(state, army)) survivors.push(army);
    } else if (!foeRouts) {
      out.push({ kind: 'fieldBattleWon', winner: foe.id, loser: army.id });
      foe.engagedWith = undefined; // resumes on its own turn
    }
    return;
  }
  survivors.push(army);
}
