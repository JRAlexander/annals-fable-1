import { RAID_PERIOD, RAID_SIZE_MULT, RAID_STAGGER, RAID_START_DAY, WILD_REALM } from '../../content/threats';
import type { SimEvent } from '../events';
import { findPath, pathReaches } from '../pathfind';
import type { Army, GameState, UnitCounts } from '../state';
import { dateOf, isDayEnd } from '../time';
import { spawnArmyUnits } from '../unitStore';

/**
 * The wilds strike back (M6): uncleared bandit camps send raiding bands on a
 * deterministic schedule, and the first Golden age wakes the dragon. Both are
 * ordinary armies with `ownerRealm = WILD_REALM` — the armies system marches
 * and fights them; the wild-specific behavior (loot, never capture, dragon
 * retargeting) lives in its fightSettlement branch. No rng drawn here.
 */
export function threatsSystem(state: GameState, out: SimEvent[]): void {
  if (!isDayEnd(state.tick)) return;
  const day = dateOf(state.tick).day;

  spawnRaids(state, out, day);
  wakeDragon(state, out);
}

function spawnWildArmy(
  state: GameState,
  units: UnitCounts,
  fromI: number,
  fromJ: number,
  x: number,
  z: number,
  target: number,
): Army | null {
  const site = state.world.settlements[target];
  const path = findPath(state.world, fromI, fromJ, site.i, site.j);
  if (!pathReaches(path, site.i, site.j)) return null; // unreachable — the wilds stay quiet
  const army: Army = {
    id: state.nextArmyId++,
    ownerRealm: WILD_REALM,
    home: target, // never used to disband — wild armies dissolve, not return
    units,
    x,
    z,
    prevX: x,
    prevZ: z,
    path,
    pathIdx: 0,
    cellProgress: 0,
    objective: { kind: 'attackSettlement', settlement: target },
    phase: 'marching',
    stance: 'standGround', // the wilds keep their own counsel — no autonomy layer
    battleStartStrength: 0,
  };
  state.armies.push(army);
  spawnArmyUnits(state, army, units); // raiders are soldiers too (M8a)
  return army;
}

function nearestSettlement(state: GameState, x: number, z: number): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of state.settlements) {
    const site = state.world.settlements[s.id];
    const d = Math.hypot(site.x - x, site.z - z);
    if (d < bestD) {
      bestD = d;
      best = s.id;
    }
  }
  return best;
}

function spawnRaids(state: GameState, out: SimEvent[], day: number): void {
  // raids scale with the world's most advanced realm — peace makes bandits bold
  const ages = state.realms.map((r) => r.age);
  const mult = Math.max(...ages.map((a) => RAID_SIZE_MULT[a] ?? 0.5));
  for (const camp of state.camps) {
    if (camp.cleared) continue;
    if (day < RAID_START_DAY + camp.id * RAID_STAGGER) continue;
    const last = state.lastRaidDay[camp.id] ?? -1;
    if (last >= 0 && day - last < RAID_PERIOD) continue;

    const site = state.world.camps[camp.id];
    const band: UnitCounts = {
      militia: Math.max(4, Math.round((camp.defenders.militia ?? 0) * mult)),
      spearman: Math.round((camp.defenders.spearman ?? 0) * mult),
      archer: Math.round((camp.defenders.archer ?? 0) * mult),
    };
    const target = nearestSettlement(state, site.x, site.z);
    const army = spawnWildArmy(state, band, site.i, site.j, site.x, site.z, target);
    state.lastRaidDay[camp.id] = day; // even a failed spawn waits out the period
    if (army) {
      out.push({
        kind: 'raidSpawned',
        camp: camp.id,
        settlement: target,
        strength: Object.values(band).reduce((t: number, n) => t + (n ?? 0), 0),
      });
    }
  }
}

/** Pick the dragon's next prey: the most populous settlement (bar the one just burnt). */
export function dragonTarget(state: GameState, exclude = -1): number {
  let best = 0;
  let bestPop = -1;
  for (const s of state.settlements) {
    if (s.id === exclude) continue;
    if (s.pop > bestPop) {
      bestPop = s.pop;
      best = s.id;
    }
  }
  return best;
}

function wakeDragon(state: GameState, out: SimEvent[]): void {
  if (state.dragonWoken) return;
  if (!state.realms.some((r) => r.age === 'golden')) return;
  state.dragonWoken = true;
  // it rises from the camp farthest from the capital — the deep wilds
  const cap = state.world.capital;
  let lair = state.world.camps[0];
  let bestD = -1;
  for (const c of state.world.camps) {
    const d = Math.hypot(c.x - cap.x, c.z - cap.z);
    if (d > bestD) {
      bestD = d;
      lair = c;
    }
  }
  if (!lair) return; // a world without camps knows no dragon
  const target = dragonTarget(state);
  const army = spawnWildArmy(state, { dragon: 1 }, lair.i, lair.j, lair.x, lair.z, target);
  if (army) out.push({ kind: 'dragonAwakened', settlement: target });
}
