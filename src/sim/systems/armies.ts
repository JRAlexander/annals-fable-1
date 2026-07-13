import type { UnitId } from '../../content/schema';
import { UNITS } from '../../content/units';
import { cellPos, hidx } from '../../worldgen/coords';
import { applyLosses, resolveRound, totalUnits } from '../combat';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import { findPath } from '../pathfind';
import type { Army, GameState } from '../state';
import type { SimStreams } from '../tick';

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

/**
 * Marching, arrival transitions, and battles (one round per tick while
 * fighting). Uses the combat stream — its draws are part of the timeline.
 */
export function armiesSystem(state: GameState, out: SimEvent[], streams: SimStreams): void {
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
              // the town raises a one-time levy of militia from its people
              const levy = Math.max(5, Math.floor(target.pop * 0.01));
              target.pop = Math.max(0, target.pop - levy);
              target.garrison.militia = (target.garrison.militia ?? 0) + levy;
              out.push({ kind: 'levyRaised', settlement: target.id, count: levy });
              out.push({ kind: 'siegeStarted', army: army.id, settlement: target.id });
            }
          }
        }
        survivors.push(army);
        break;
      }

      case 'fighting': {
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
  if (totalUnits(target.garrison) <= 0) {
    const from = target.ownerRealm;
    target.ownerRealm = army.ownerRealm;
    target.pop = Math.floor(target.pop * 0.9);
    target.garrison = {};
    target.trainQueue = [];
    out.push({ kind: 'settlementCaptured', settlement: target.id, by: army.ownerRealm, from });
    goHome();
  } else if (myStrength <= 0) {
    out.push({ kind: 'siegeRepelled', army: army.id, settlement: target.id });
  } else if (myStrength < start * 0.3) {
    out.push({ kind: 'armyRouted', army: army.id, camp: -1 });
    goHome();
  } else {
    survivors.push(army);
  }
}
