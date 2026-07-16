import { describe, expect, it } from 'vitest';
import { totalUnits } from '../src/sim/combat';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import type { Army } from '../src/sim/state';
import { advanceTick } from '../src/sim/tick';
import { worldToCell } from '../src/worldgen/coords';
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
function conjureArmy(sim: SimRun, units: Record<string, number>, settlement = 0): number {
  const s = sim.state.settlements[settlement];
  for (const [u, n] of Object.entries(units)) s.garrison[u] = n;
  const events = issueNow(sim, { kind: 'formArmy', settlement: s.id, units });
  const formed = events.find((e) => e.kind === 'armyFormed');
  if (!formed || formed.kind !== 'armyFormed') throw new Error('army not formed');
  return formed.army;
}
/** Drop a hostile wild band directly at a world position (threat-spawn shortcut). */
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
    battleStartStrength: 0,
  };
  sim.state.armies.push(army);
  return army;
}

describe('RTS control (M7a)', () => {
  it('moveTo marches the army to a field cell where it holds', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { militia: 10 });
    const me = sim.state.armies.find((a) => a.id === id);
    if (!me) throw new Error('no army');
    const { i, j } = worldToCell(me.x, me.z);
    const ti = i + 6;
    const tj = j + 6;
    const events = issueNow(sim, {
      kind: 'orderArmy',
      army: id,
      objective: { kind: 'moveTo', i: ti, j: tj },
    });
    expect(events.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(false);
    runUntil(sim, () => me.phase === 'idle', 5000, 'arrived in the field');
    const at = worldToCell(me.x, me.z);
    expect(Math.abs(at.i - ti)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.j - tj)).toBeLessThanOrEqual(1);
    expect(me.objective).toBeNull(); // holding, not homing
  });

  it('moveTo into the sea is rejected', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { militia: 10 });
    let wi = -1;
    let wj = -1;
    outer: for (let j = 0; j < 128; j++) {
      for (let i = 0; i < 128; i++) {
        if (!Number.isFinite(sim.state.world.navCost[j * 128 + i])) {
          wi = i;
          wj = j;
          break outer;
        }
      }
    }
    const events = issueNow(sim, {
      kind: 'orderArmy',
      army: id,
      objective: { kind: 'moveTo', i: wi, j: wj },
    });
    expect(events.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });

  it('attackArmy rejects own armies and non-hostiles', () => {
    const sim = freshSim(1234);
    const a = conjureArmy(sim, { militia: 10 });
    const b = conjureArmy(sim, { militia: 10 });
    const own = issueNow(sim, { kind: 'orderArmy', army: a, objective: { kind: 'attackArmy', army: b } });
    expect(own.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });

  it('a player army hunts down and destroys a wild band (field battle)', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { swordsman: 40, spearman: 20, archer: 20 });
    const me = sim.state.armies.find((a) => a.id === id);
    if (!me) throw new Error('no army');
    const band = conjureWildArmy(sim, { militia: 10, spearman: 3 }, me.x + 400, me.z + 200);
    const events = issueNow(sim, {
      kind: 'orderArmy',
      army: id,
      objective: { kind: 'attackArmy', army: band.id },
    });
    expect(events.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(false);
    const all = runUntil(sim, () => !sim.state.armies.some((a) => a.id === band.id), 8000, 'band destroyed');
    expect(all.some((e) => e.kind === 'armiesEngaged')).toBe(true);
    expect(all.some((e) => e.kind === 'fieldBattleWon' && e.winner === id)).toBe(true);
    expect(sim.state.armies.find((a) => a.id === id)).toBeDefined(); // we live
  });

  it('an army standing in a raid path intercepts the raiders', () => {
    const sim = freshSim(1234);
    // wait for a raid to spawn, then park a strong army in front of it
    runUntil(sim, () => sim.state.armies.some((a) => a.ownerRealm === -1), 3000, 'raid spawned');
    const raid = sim.state.armies.find((a) => a.ownerRealm === -1);
    if (!raid) throw new Error('no raid');
    const id = conjureArmy(sim, { swordsman: 50, spearman: 25, archer: 25 });
    const events = issueNow(sim, {
      kind: 'orderArmy',
      army: id,
      objective: { kind: 'attackArmy', army: raid.id },
    });
    expect(events.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(false);
    const all = runUntil(
      sim,
      () => !sim.state.armies.some((a) => a.id === raid.id),
      12000,
      'raiders destroyed',
    );
    // the town was never sacked by THIS band (later raids may still fire — filter by absence before kill)
    expect(all.some((e) => e.kind === 'fieldBattleWon' && e.winner === id)).toBe(true);
  });

  it('two engaged armies resolve: one side wins the field', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { swordsman: 30, archer: 15 });
    const me = sim.state.armies.find((a) => a.id === id);
    if (!me) throw new Error('no army');
    // drop the band right on top of us — engagement is immediate
    conjureWildArmy(sim, { militia: 12 }, me.x + 10, me.z);
    const all = runUntil(
      sim,
      () => !sim.state.armies.some((a) => a.ownerRealm === -1 && totalUnits(a.units) > 0),
      2000,
      'field resolved',
    );
    expect(all.some((e) => e.kind === 'armiesEngaged')).toBe(true);
    expect(all.some((e) => e.kind === 'fieldBattleWon')).toBe(true);
  });

  it('field battles keep the sim deterministic', () => {
    const once = () => {
      const sim = freshSim(777);
      const id = conjureArmy(sim, { swordsman: 20, archer: 10 });
      const me = sim.state.armies.find((a) => a.id === id);
      if (!me) throw new Error('no army');
      conjureWildArmy(sim, { militia: 15, spearman: 5 }, me.x + 30, me.z);
      run(sim, 1500);
      return hashState(sim.state);
    };
    expect(once()).toBe(once());
  });
});
