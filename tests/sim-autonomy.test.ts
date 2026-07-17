import { describe, expect, it } from 'vitest';
import { FOOD_PER_POP_DAY } from '../src/content/economy';
import { DEFEND_RADIUS, FLEE_RADIUS, RALLY_BATCH, STANCE_SIGHT } from '../src/content/rts';
import { totalUnits } from '../src/sim/combat';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { findPath, pathReaches } from '../src/sim/pathfind';
import type { Army } from '../src/sim/state';
import { advanceTick } from '../src/sim/tick';
import { unitsOf } from '../src/sim/unitStore';
import { cellPos, hidx, worldToCell } from '../src/worldgen/coords';
import { GRID } from '../src/worldgen/types';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
}
function runUntil(sim: SimRun, pred: () => boolean, maxTicks: number, what: string): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return all;
    all.push(...advanceTick(sim.state, [], sim.streams));
  }
  if (!pred()) throw new Error(`runUntil: '${what}' not reached within ${maxTicks} ticks`);
  return all;
}
function conjureArmy(sim: SimRun, units: Record<string, number>, settlement = 0): Army {
  const s = sim.state.settlements[settlement];
  for (const [u, n] of Object.entries(units)) s.garrison[u] = n;
  const events = issueNow(sim, { kind: 'formArmy', settlement: s.id, units });
  const formed = events.find((e) => e.kind === 'armyFormed');
  if (!formed || formed.kind !== 'armyFormed') throw new Error('army not formed');
  const army = sim.state.armies.find((a) => a.id === formed.army);
  if (!army) throw new Error('army vanished');
  return army;
}
function conjureWildArmy(sim: SimRun, units: Record<string, number>, x: number, z: number): Army {
  const { i, j } = worldToCell(x, z);
  const army: Army = {
    id: sim.state.nextArmyId++,
    ownerRealm: -1,
    home: 0,
    units,
    x,
    z,
    prevX: x,
    prevZ: z,
    path: [
      [i, j],
      [i, j],
    ],
    pathIdx: 1,
    cellProgress: 0,
    objective: null,
    phase: 'idle',
    stance: 'standGround',
    muster: 0,
    battleStartStrength: 0,
  };
  sim.state.armies.push(army);
  return army;
}
/** A land cell `radius` cells out from (x,z) that an army there can actually reach. */
function landNear(sim: SimRun, x: number, z: number, radius: number): { x: number; z: number } {
  const c = worldToCell(x, z);
  for (let r = radius; r < radius + 6; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = c.i + di;
        const j = c.j + dj;
        if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
        if (!Number.isFinite(sim.state.world.navCost[hidx(i, j)])) continue;
        if (!pathReaches(findPath(sim.state.world, c.i, c.j, i, j), i, j)) continue;
        return cellPos(i, j);
      }
    }
  }
  throw new Error('no reachable land near the site');
}

describe('unit autonomy (M13): stances', () => {
  it('an aggressive idle army hunts a hostile in sight; out of sight is ignored', () => {
    const sim = freshSim(1234);
    const me = conjureArmy(sim, { swordsman: 30, archer: 10 });
    issueNow(sim, { kind: 'setStance', army: me.id, stance: 'aggressive' });
    // far beyond sight: nothing happens
    const far = conjureWildArmy(sim, { militia: 4 }, me.x + STANCE_SIGHT * 3, me.z);
    run(sim, 3);
    expect(me.objective).toBeNull();
    // in sight: the hunt is on
    const near = conjureWildArmy(sim, { militia: 4 }, me.x + STANCE_SIGHT * 0.6, me.z);
    run(sim, 2);
    expect(me.objective).toEqual({ kind: 'attackArmy', army: near.id });
    expect(me.phase).toBe('marching');
    expect(far.id).not.toBe(near.id);
  });

  it('a stand-ground army ignores hostiles it could see', () => {
    const sim = freshSim(1234);
    const me = conjureArmy(sim, { swordsman: 30 });
    issueNow(sim, { kind: 'setStance', army: me.id, stance: 'standGround' });
    conjureWildArmy(sim, { militia: 4 }, me.x + STANCE_SIGHT * 0.6, me.z);
    run(sim, 10);
    expect(me.objective).toBeNull();
    expect(me.phase).toBe('idle');
  });

  it('a defensive army intercepts a raider bound for its realm, then walks back to its post', () => {
    const sim = freshSim(1234);
    const me = conjureArmy(sim, { swordsman: 40, spearman: 20, archer: 20 });
    expect(me.stance).toBe('defensive'); // formArmy default
    const postCell = worldToCell(me.x, me.z);
    const capId = sim.state.realms[0].capital;
    const spot = landNear(sim, me.x, me.z, 10);
    const band = conjureWildArmy(sim, { militia: 3 }, spot.x, spot.z);
    band.objective = { kind: 'attackSettlement', settlement: capId };
    run(sim, 2);
    expect(me.objective).toEqual({ kind: 'attackArmy', army: band.id });
    expect(me.post).toEqual({ i: postCell.i, j: postCell.j });
    // ride out, win, and stand down at the post
    runUntil(sim, () => !sim.state.armies.some((a) => a.id === band.id), 4000, 'raiders destroyed');
    runUntil(sim, () => me.post === undefined && me.phase === 'idle', 4000, 'back at the post');
    const at = worldToCell(me.x, me.z);
    expect(Math.abs(at.i - postCell.i)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.j - postCell.j)).toBeLessThanOrEqual(1);
  });

  it('a defensive army ignores raiders marching on other realms', () => {
    const sim = freshSim(1234);
    const me = conjureArmy(sim, { swordsman: 30 });
    const rivalTown = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!rivalTown) throw new Error('no rival settlement');
    const band = conjureWildArmy(sim, { militia: 3 }, me.x + DEFEND_RADIUS * 0.3, me.z);
    band.objective = { kind: 'attackSettlement', settlement: rivalTown.id };
    run(sim, 5);
    expect(me.objective).toBeNull();
    expect(me.phase).toBe('idle');
  });

  it('setStance validates ownership and clears the post on stand-ground', () => {
    const sim = freshSim(1234);
    const me = conjureArmy(sim, { militia: 5 });
    const wild = conjureWildArmy(sim, { militia: 3 }, me.x + STANCE_SIGHT * 3, me.z);
    let events = issueNow(sim, { kind: 'setStance', army: wild.id, stance: 'aggressive' });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    expect(wild.stance).toBe('standGround');
    me.post = { i: 3, j: 3 };
    events = issueNow(sim, { kind: 'setStance', army: me.id, stance: 'standGround' });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(false);
    expect(me.stance).toBe('standGround');
    expect('post' in me).toBe(false);
  });
});

describe('unit autonomy (M13): rally points', () => {
  it('rally-to-army sends finished recruits straight to the field army', () => {
    const sim = freshSim(1234);
    const me = conjureArmy(sim, { militia: 10 });
    const cap = sim.state.settlements[sim.state.realms[0].capital];
    cap.buildings.barracks = 1;
    sim.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
    let events = issueNow(sim, {
      kind: 'setRally',
      settlement: cap.id,
      rally: { kind: 'army', army: me.id },
    });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(false);
    events = issueNow(sim, { kind: 'trainUnits', settlement: cap.id, unit: 'militia', count: 3 });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(false);
    runUntil(sim, () => (me.units.militia ?? 0) === 13, 2000, 'recruits reached the army');
    expect(cap.garrison.militia ?? 0).toBe(0);
    expect(unitsOf(sim.state, me.id)).toHaveLength(13); // bodies fielded, not just counts
  });

  it('a dead rally target clears itself and recruits fall back to the garrison', () => {
    const sim = freshSim(1234);
    const me = conjureArmy(sim, { militia: 5 });
    const cap = sim.state.settlements[sim.state.realms[0].capital];
    cap.buildings.barracks = 1;
    sim.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
    issueNow(sim, { kind: 'setRally', settlement: cap.id, rally: { kind: 'army', army: me.id } });
    me.units = {}; // the host is annihilated
    issueNow(sim, { kind: 'trainUnits', settlement: cap.id, unit: 'militia', count: 1 });
    runUntil(sim, () => (cap.garrison.militia ?? 0) >= 1, 2000, 'recruit joined the garrison');
    expect('rally' in cap).toBe(false);
  });

  it('a rally flag musters a full garrison band and marches it out', () => {
    const sim = freshSim(1234);
    const cap = sim.state.settlements[sim.state.realms[0].capital];
    const site = sim.state.world.settlements[cap.id];
    const flag = worldToCell(landNear(sim, site.x, site.z, 6).x, landNear(sim, site.x, site.z, 6).z);
    const events = issueNow(sim, {
      kind: 'setRally',
      settlement: cap.id,
      rally: { kind: 'point', i: flag.i, j: flag.j },
    });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(false);
    cap.garrison = { militia: RALLY_BATCH };
    const formed = run(sim, 2).find((e) => e.kind === 'armyFormed');
    expect(formed).toBeDefined();
    expect(totalUnits(cap.garrison)).toBe(0);
    const band = sim.state.armies.find((a) => formed?.kind === 'armyFormed' && a.id === formed.army);
    expect(band?.objective).toEqual({ kind: 'moveTo', i: flag.i, j: flag.j });
    // one short of a band never marches
    cap.garrison = { militia: RALLY_BATCH - 1 };
    expect(run(sim, 3).some((e) => e.kind === 'armyFormed')).toBe(false);
  });

  it('setRally validates its targets and null clears', () => {
    const sim = freshSim(1234);
    const cap = sim.state.settlements[sim.state.realms[0].capital];
    // sea point
    let wi = -1;
    let wj = -1;
    outer: for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        if (!Number.isFinite(sim.state.world.navCost[hidx(i, j)])) {
          wi = i;
          wj = j;
          break outer;
        }
      }
    }
    let events = issueNow(sim, {
      kind: 'setRally',
      settlement: cap.id,
      rally: { kind: 'point', i: wi, j: wj },
    });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    // a foreign settlement
    const rivalTown = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!rivalTown) throw new Error('no rival settlement');
    events = issueNow(sim, { kind: 'setRally', settlement: rivalTown.id, rally: null });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    // a hostile army as target
    const wild = conjureWildArmy(sim, { militia: 3 }, 0, 0);
    events = issueNow(sim, {
      kind: 'setRally',
      settlement: cap.id,
      rally: { kind: 'army', army: wild.id },
    });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    // a good point sets; null clears
    const spot = worldToCell(
      landNear(sim, sim.state.world.settlements[cap.id].x, sim.state.world.settlements[cap.id].z, 4).x,
      landNear(sim, sim.state.world.settlements[cap.id].x, sim.state.world.settlements[cap.id].z, 4).z,
    );
    issueNow(sim, { kind: 'setRally', settlement: cap.id, rally: { kind: 'point', i: spot.i, j: spot.j } });
    expect(cap.rally).toEqual({ kind: 'point', i: spot.i, j: spot.j });
    issueNow(sim, { kind: 'setRally', settlement: cap.id, rally: null });
    expect('rally' in cap).toBe(false);
  });
});

describe('unit autonomy (M13): the governor', () => {
  it('a governed town reassigns its villagers by the AI book; an ungoverned one keeps its orders', () => {
    const sim = freshSim(1234);
    const cap = sim.state.settlements[sim.state.realms[0].capital];
    const seedTargets = { ...cap.jobTargets };
    issueNow(sim, { kind: 'setGovernor', settlement: cap.id, enabled: true });
    run(sim, 15); // past the first day boundary
    const n = sim.state.villagers.filter((v) => v.settlement === cap.id).length;
    const realmPop = sim.state.settlements.filter((s) => s.ownerRealm === 0).reduce((t, s) => t + s.pop, 0);
    const hungry = sim.state.realms[0].stock.food < realmPop * FOOD_PER_POP_DAY * 30;
    const farmShare = hungry ? 0.5 : 0.3;
    expect(cap.jobTargets.farm).toBe(Math.floor(n * farmShare));
    expect(cap.jobTargets).not.toEqual(seedTargets);

    // the twin without a governor stands untouched
    const twin = freshSim(1234);
    run(twin, 16);
    const twinCap = twin.state.settlements[twin.state.realms[0].capital];
    expect(twinCap.jobTargets).toEqual(seedTargets);
  });

  it('governed runs are deterministic: two identical scripts hash equal', () => {
    const once = () => {
      const sim = freshSim(777);
      const cap = sim.state.realms[0].capital;
      run(sim, 3);
      issueNow(sim, { kind: 'setGovernor', settlement: cap, enabled: true });
      run(sim, 600);
      return hashState(sim.state);
    };
    expect(once()).toBe(once());
  });
});

describe('unit autonomy (M13): villagers flee', () => {
  it('a hostile army near town sends the workers home; they return when it passes', () => {
    const sim = freshSim(1234);
    const cap = sim.state.settlements[sim.state.realms[0].capital];
    const site = sim.state.world.settlements[cap.id];
    // let the founding households take up their tools first
    runUntil(
      sim,
      () => sim.state.villagers.some((v) => v.settlement === cap.id && v.job !== 'idle'),
      50,
      'villagers assigned',
    );
    const band = conjureWildArmy(sim, { militia: 6 }, site.x + FLEE_RADIUS * 0.5, site.z);
    run(sim, 1);
    const workers = () => sim.state.villagers.filter((v) => v.settlement === cap.id && v.job !== 'idle');
    for (const v of workers()) {
      expect(v.phase).toBe('toDropoff');
      expect(v.tx).toBe(site.x);
      expect(v.tz).toBe(site.z);
    }
    // long enough for the walk home
    run(sim, 60);
    for (const v of workers()) {
      expect(Math.hypot(v.x - site.x, v.z - site.z)).toBeLessThanOrEqual(FLEE_RADIUS);
    }
    // the danger passes; the fields call again
    band.units = {};
    run(sim, 3);
    runUntil(
      sim,
      () => workers().some((v) => v.phase === 'toWork' && (v.tx !== site.x || v.tz !== site.z)),
      200,
      'work resumed',
    );
  });
});

describe('unit autonomy (M13): capture', () => {
  it('a captured town loses its rally and its governor', () => {
    const sim = freshSim(1234);
    issueNow(sim, { kind: 'declareWar', target: 1 });
    const enemy = sim.state.settlements.filter((s) => s.ownerRealm === 1).sort((a, b) => a.pop - b.pop)[0];
    if (!enemy) throw new Error('no rival settlement');
    // the old regime's standing orders, planted directly for the test
    enemy.rally = { kind: 'point', i: 1, j: 1 };
    enemy.governor = true;
    enemy.steward = true;
    const me = conjureArmy(sim, { swordsman: 60, spearman: 30, archer: 20 });
    issueNow(sim, {
      kind: 'orderArmy',
      army: me.id,
      objective: { kind: 'attackSettlement', settlement: enemy.id },
    });
    runUntil(sim, () => enemy.ownerRealm === 0, 30000, 'settlement captured');
    expect('rally' in enemy).toBe(false);
    expect(enemy.governor).toBe(false);
    expect(enemy.steward).toBe(false); // the M14 steward falls with the town too
  });
});
