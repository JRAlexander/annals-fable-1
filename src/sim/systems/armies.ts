import { ENGAGE_RANGE } from '../../content/rts';
import type { ResourceId, UnitId } from '../../content/schema';
import { DRAGON_HOARD, RAID_PLUNDER, RAID_POP_MULT, WILD_REALM } from '../../content/threats';
import { UNITS } from '../../content/units';
import { cellPos, hidx, worldToCell } from '../../worldgen/coords';
import { applyLosses, resolveRound, totalUnits } from '../combat';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import { findPath } from '../pathfind';
import type { Army, GameState } from '../state';
import type { SimStreams } from '../tick';
import { dateOf } from '../time';
import { reconcileUnits, steerUnits } from '../unitStore';
import { dragonTarget } from './threats';

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
function hostile(state: GameState, a: Army, b: Army): boolean {
  if (a.ownerRealm === b.ownerRealm) return false;
  if (a.ownerRealm === WILD_REALM || b.ownerRealm === WILD_REALM) return true;
  return state.realms[a.ownerRealm]?.atWarWith.includes(b.ownerRealm) ?? false;
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

/** After a field battle: pick the march back up, or hold the ground. */
function resumeAfterBattle(state: GameState, army: Army): void {
  army.engagedWith = undefined;
  const o = army.objective;
  if (!o || o.kind === 'moveTo') {
    // holding orders: finish the walk if any remains, else stand
    army.phase = army.pathIdx < army.path.length - 1 ? 'marching' : 'idle';
    return;
  }
  if (o.kind === 'returnHome') {
    army.phase = 'returning';
    const home = state.world.settlements[army.home];
    routePath(state, army, home.i, home.j);
    return;
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
}

/**
 * Marching, arrival transitions, and battles (one round per tick while
 * fighting). Uses the combat stream — its draws are part of the timeline.
 */
export function armiesSystem(state: GameState, out: SimEvent[], streams: SimStreams): void {
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
      case 'idle':
        survivors.push(army);
        break;

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
              army.objective = { kind: 'returnHome' };
              army.phase = 'returning';
              const home = state.world.settlements[army.home];
              routePath(state, army, home.i, home.j);
            } else {
              army.phase = 'fighting';
              army.battleStartStrength = totalUnits(army.units);
              out.push({ kind: 'battleStarted', army: army.id, camp: camp.id });
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
              army.phase = 'fighting';
              army.battleStartStrength = totalUnits(army.units);
              // the town raises a levy of militia from its people — but a
              // people bled by repeated alarms cannot muster twice in a season
              const day = dateOf(state.tick).day;
              if (day - (target.lastLevyDay ?? -999) >= 30) {
                target.lastLevyDay = day;
                const levy = Math.max(5, Math.floor(target.pop * 0.01));
                target.pop = Math.max(0, target.pop - levy);
                target.garrison.militia = (target.garrison.militia ?? 0) + levy;
                out.push({ kind: 'levyRaised', settlement: target.id, count: levy });
              }
              out.push({ kind: 'siegeStarted', army: army.id, settlement: target.id });
            }
          }
        }
        survivors.push(army);
        break;
      }

      case 'fighting': {
        if (army.engagedWith !== undefined) {
          fightField(state, army, out, streams, survivors);
          break;
        }
        if (army.objective?.kind === 'attackSettlement') {
          fightSettlement(state, army, out, streams, survivors);
          break;
        }
        const campId = army.objective?.kind === 'attackCamp' ? army.objective.camp : -1;
        const camp = state.camps[campId];
        if (!camp || camp.cleared) {
          army.phase = 'returning';
          army.objective = { kind: 'returnHome' };
          const home = state.world.settlements[army.home];
          routePath(state, army, home.i, home.j);
          survivors.push(army);
          break;
        }
        const round = resolveRound(
          army.units,
          camp.defenders,
          { state, realm: army.ownerRealm },
          { state, realm: -1 }, // bandits have no realm: no techs, no buildings
          streams.combat,
          camp.fortHp,
        );
        camp.fortHp = Math.max(0, camp.fortHp - round.fortDamage);
        applyLosses(army.units, round.attackerLosses);
        applyLosses(camp.defenders, round.defenderLosses);

        const myStrength = totalUnits(army.units);
        const start = army.battleStartStrength || myStrength;
        // dead defenders = cleared camp; the palisade only shields its garrison
        if (totalUnits(camp.defenders) <= 0) {
          camp.cleared = true;
          state.realms[army.ownerRealm].stock.gold += camp.loot;
          out.push({ kind: 'campCleared', army: army.id, camp: camp.id, loot: camp.loot });
          army.phase = 'returning';
          army.objective = { kind: 'returnHome' };
          const home = state.world.settlements[army.home];
          routePath(state, army, home.i, home.j);
          survivors.push(army);
        } else if (myStrength <= 0) {
          out.push({ kind: 'battleLost', army: army.id, camp: camp.id });
          // army annihilated — entity dissolves
        } else if (myStrength < start * 0.3) {
          out.push({ kind: 'armyRouted', army: army.id, camp: camp.id });
          army.phase = 'returning';
          army.objective = { kind: 'returnHome' };
          const home = state.world.settlements[army.home];
          routePath(state, army, home.i, home.j);
          survivors.push(army);
        } else {
          survivors.push(army);
        }
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

/** Siege of an enemy settlement: garrison (with its one-time levy) behind walls/keep. */
function fightSettlement(
  state: GameState,
  army: Army,
  out: SimEvent[],
  streams: SimStreams,
  survivors: Army[],
): void {
  const targetId = army.objective?.kind === 'attackSettlement' ? army.objective.settlement : -1;
  const target = state.settlements[targetId];
  const goHome = () => {
    army.phase = 'returning';
    army.objective = { kind: 'returnHome' };
    const home = state.world.settlements[army.home];
    routePath(state, army, home.i, home.j);
    survivors.push(army);
  };
  if (!target || target.ownerRealm === army.ownerRealm) {
    goHome();
    return;
  }
  const site = state.world.settlements[target.id];
  const isDragon = (army.units.dragon ?? 0) > 0; // read BEFORE losses erase the corpse
  const fortHp = site.walls * 200 + (target.buildings.keep ?? 0) * 1200 - (army.siegeDamage ?? 0);
  const round = resolveRound(
    army.units,
    target.garrison,
    { state, realm: army.ownerRealm },
    { state, realm: target.ownerRealm, settlement: target.id },
    streams.combat,
    Math.max(0, fortHp),
  );
  army.siegeDamage = (army.siegeDamage ?? 0) + round.fortDamage;
  applyLosses(army.units, round.attackerLosses);
  applyLosses(target.garrison, round.defenderLosses);

  const myStrength = totalUnits(army.units);
  const start = army.battleStartStrength || myStrength;
  const wild = army.ownerRealm === WILD_REALM;
  if (totalUnits(target.garrison) <= 0) {
    if (wild) {
      // the wilds do not hold ground: plunder the stores, thin the people, move on
      const owner = state.realms[target.ownerRealm];
      let plunder = 0;
      for (const res of Object.keys(owner.stock) as ResourceId[]) {
        const taken = Math.floor(owner.stock[res] * RAID_PLUNDER);
        owner.stock[res] -= taken;
        plunder += taken;
      }
      target.pop = Math.floor(target.pop * RAID_POP_MULT);
      out.push({ kind: 'settlementRaided', settlement: target.id, plunder });
      if (isDragon) {
        // the dragon is never sated — it seeks the next great town
        const next = dragonTarget(state, target.id);
        army.objective = { kind: 'attackSettlement', settlement: next };
        army.phase = 'marching';
        army.siegeDamage = 0;
        const site = state.world.settlements[next];
        routePath(state, army, site.i, site.j);
        survivors.push(army);
      }
      // raider bands dissolve back into the wilds
      return;
    }
    const from = target.ownerRealm;
    target.ownerRealm = army.ownerRealm;
    target.pop = Math.floor(target.pop * 0.9);
    target.garrison = {};
    target.trainQueue = [];
    out.push({ kind: 'settlementCaptured', settlement: target.id, by: army.ownerRealm, from });
    goHome();
  } else if (myStrength <= 0) {
    if (wild && isDragon) {
      // the dragon lies slain beneath the walls — its hoard to the defenders
      state.realms[target.ownerRealm].stock.gold += DRAGON_HOARD;
      out.push({ kind: 'dragonSlain', realm: target.ownerRealm, hoard: DRAGON_HOARD });
    } else {
      out.push({ kind: 'siegeRepelled', army: army.id, settlement: target.id });
    }
  } else if (myStrength < start * 0.3) {
    if (wild) return; // routed raiders melt away — no march home, no disband
    out.push({ kind: 'armyRouted', army: army.id, camp: -1 });
    goHome();
  } else {
    survivors.push(army);
  }
}

/**
 * A field battle (M7a): two armies in the open, no fortifications, mutual
 * rounds. Runs once per pair per tick, from the LOWER army id — the higher id
 * simply holds while engaged. Wild losers melt away; realm losers flee home.
 */
function fightField(
  state: GameState,
  army: Army,
  out: SimEvent[],
  streams: SimStreams,
  survivors: Army[],
): void {
  const foe = state.armies.find((x) => x.id === army.engagedWith);
  if (!foe || totalUnits(foe.units) <= 0) {
    // the enemy is gone — pick the march back up
    resumeAfterBattle(state, army);
    survivors.push(army);
    return;
  }
  if (army.id > foe.id) {
    // the lower id runs the round; we stand our ground this tick
    survivors.push(army);
    return;
  }

  const round = resolveRound(
    army.units,
    foe.units,
    { state, realm: army.ownerRealm },
    { state, realm: foe.ownerRealm },
    streams.combat,
    0, // the open field knows no walls
  );
  applyLosses(army.units, round.attackerLosses);
  applyLosses(foe.units, round.defenderLosses);

  const mine = totalUnits(army.units);
  const theirs = totalUnits(foe.units);
  const myStart = army.battleStartStrength || mine;
  const foeStart = foe.battleStartStrength || theirs;

  /** A realm army breaks and runs for home. */
  const flee = (loser: Army): void => {
    loser.engagedWith = undefined;
    out.push({ kind: 'armyRouted', army: loser.id, camp: -1 });
    loser.objective = { kind: 'returnHome' };
    loser.phase = 'returning';
    const home = state.world.settlements[loser.home];
    if (home) routePath(state, loser, home.i, home.j);
  };

  if (mine <= 0 && theirs <= 0) {
    // mutual annihilation — the chronicle will not believe it
    out.push({ kind: 'armyDestroyed', army: army.id, realm: army.ownerRealm });
    foe.engagedWith = undefined; // foe's own destroyed-check drops it later this tick
    return;
  }
  if (theirs <= 0) {
    out.push({ kind: 'fieldBattleWon', winner: army.id, loser: foe.id });
    resumeAfterBattle(state, army);
    survivors.push(army);
    return; // the foe is dropped by its own top-of-loop check
  }
  if (mine <= 0) {
    out.push({ kind: 'fieldBattleWon', winner: foe.id, loser: army.id });
    out.push({ kind: 'armyDestroyed', army: army.id, realm: army.ownerRealm });
    resumeAfterBattle(state, foe);
    return; // we are not pushed — the army is no more
  }
  // wild bands never rout — they fight to the end
  const iRout = army.ownerRealm !== WILD_REALM && mine < myStart * 0.3;
  const foeRouts = foe.ownerRealm !== WILD_REALM && theirs < foeStart * 0.3;
  if (iRout || foeRouts) {
    if (iRout) {
      flee(army);
      survivors.push(army);
    }
    if (foeRouts) flee(foe); // foe moves on its own later turn this tick
    if (!iRout) {
      out.push({ kind: 'fieldBattleWon', winner: army.id, loser: foe.id });
      resumeAfterBattle(state, army);
      survivors.push(army);
    } else if (!foeRouts) {
      out.push({ kind: 'fieldBattleWon', winner: foe.id, loser: army.id });
      resumeAfterBattle(state, foe);
    }
    return;
  }
  survivors.push(army);
}
