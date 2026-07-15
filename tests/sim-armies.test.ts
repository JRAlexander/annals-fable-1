import { describe, expect, it } from 'vitest';
import { UNITS } from '../src/content/units';
import { totalUnits } from '../src/sim/combat';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { advanceTick } from '../src/sim/tick';
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
function fund(sim: SimRun): void {
  sim.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
  sim.state.realms[0].storageCap = { food: 99999, wood: 99999, stone: 99999, gold: 99999 };
}

describe('training', () => {
  it('pays cost and population at queue time; completions join the garrison', () => {
    const sim = freshSim(1234);
    fund(sim);
    issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'barracks' });
    runUntil(sim, () => (sim.state.settlements[0].buildings.barracks ?? 0) > 0, 2000, 'barracks');

    fund(sim);
    const pop0 = sim.state.settlements[0].pop;
    const food0 = sim.state.realms[0].stock.food;
    const events = issueNow(sim, { kind: 'trainUnits', settlement: 0, unit: 'militia', count: 5 });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(false);
    expect(sim.state.settlements[0].pop).toBeLessThanOrEqual(pop0 - 5);
    expect(sim.state.realms[0].stock.food).toBeLessThan(food0);

    runUntil(
      sim,
      () => (sim.state.settlements[0].garrison.militia ?? 0) >= 5,
      5 * UNITS.militia.trainTime + 20,
      'trained',
    );
    expect(sim.state.settlements[0].trainQueue).toHaveLength(0);
  });

  it('rejects without a training building, age gate, or enough folk', () => {
    const sim = freshSim(1234);
    fund(sim);
    // spearmen need a barracks — the seeded town center only levies militia
    let events = issueNow(sim, { kind: 'trainUnits', settlement: 0, unit: 'spearman', count: 1 });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true); // no barracks

    issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'barracks' });
    runUntil(sim, () => (sim.state.settlements[0].buildings.barracks ?? 0) > 0, 2000, 'barracks');
    fund(sim);
    events = issueNow(sim, { kind: 'trainUnits', settlement: 0, unit: 'knight', count: 1 });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true); // age gate (and no stable)

    events = issueNow(sim, { kind: 'trainUnits', settlement: 0, unit: 'militia', count: 99999 });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true); // pop floor
  });
});

describe('armies', () => {
  /** Build the training buildings, train a solid mixed force, form an army. */
  function raiseArmy(sim: SimRun, units: Record<string, number>): number {
    fund(sim);
    if (units.archer || units.skirmisher) sim.state.realms[0].age = 'flowering'; // range gate
    issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'barracks' });
    if (units.archer || units.skirmisher) {
      fund(sim);
      issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'archeryRange' });
      runUntil(sim, () => (sim.state.settlements[0].buildings.archeryRange ?? 0) > 0, 4000, 'range');
    }
    runUntil(sim, () => (sim.state.settlements[0].buildings.barracks ?? 0) > 0, 2000, 'barracks');
    for (const [unit, count] of Object.entries(units)) {
      fund(sim);
      issueNow(sim, { kind: 'trainUnits', settlement: 0, unit, count });
    }
    runUntil(sim, () => sim.state.settlements[0].trainQueue.length === 0, 20000, 'training done');
    const events = issueNow(sim, { kind: 'formArmy', settlement: 0, units });
    const formed = events.find((e) => e.kind === 'armyFormed');
    expect(formed, 'army formed').toBeDefined();
    return formed && formed.kind === 'armyFormed' ? formed.army : -1;
  }

  it('formArmy pulls from the garrison; over-draw rejects', () => {
    const sim = freshSim(1234);
    const id = raiseArmy(sim, { militia: 10, spearman: 5 });
    expect(id).toBeGreaterThanOrEqual(0);
    expect(sim.state.settlements[0].garrison.militia ?? 0).toBe(0);
    const events = issueNow(sim, { kind: 'formArmy', settlement: 0, units: { militia: 1 } });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
  });

  it('full loop: a strong mixed force marches, clears the camp, loots, returns', () => {
    const sim = freshSim(1234);
    // archers matter: melee-only vs an entrenched camp is a coin flip by design
    const id = raiseArmy(sim, { militia: 30, spearman: 20, archer: 15 });
    sim.state.realms[0].stock.gold = 100; // below cap so the loot is visible
    const gold0 = sim.state.realms[0].stock.gold;
    const events = issueNow(sim, { kind: 'orderArmy', army: id, objective: { kind: 'attackCamp', camp: 0 } });
    expect(events.some((e) => e.kind === 'armyDeparted')).toBe(true);

    const all = runUntil(sim, () => sim.state.camps[0].cleared, 30000, 'camp cleared');
    expect(all.some((e) => e.kind === 'battleStarted')).toBe(true);
    expect(sim.state.realms[0].stock.gold).toBeGreaterThan(gold0);

    // raids (M6) may put wild armies on the map — only OUR army must come home
    runUntil(sim, () => !sim.state.armies.some((a) => a.ownerRealm === 0), 30000, 'army home');
    // survivors are back in the garrison
    expect(totalUnits(sim.state.settlements[0].garrison)).toBeGreaterThan(0);
  });

  it('a token force loses or routs against the same camp', () => {
    const sim = freshSim(1234);
    const id = raiseArmy(sim, { militia: 3 });
    issueNow(sim, { kind: 'orderArmy', army: id, objective: { kind: 'attackCamp', camp: 0 } });
    const mine = () => sim.state.armies.filter((a) => a.ownerRealm === 0);
    const events = runUntil(
      sim,
      () => mine().length === 0 || mine().every((a) => a.phase === 'returning'),
      30000,
      'battle resolved',
    );
    expect(sim.state.camps[0].cleared).toBe(false);
    // it may die at the palisade, rout, or (since M7a) be cut down by roaming
    // raiders in the open field on the way — all of them are losing
    expect(
      events.some(
        (e) =>
          e.kind === 'battleLost' || e.kind === 'armyRouted' || (e.kind === 'armyDestroyed' && e.realm === 0),
      ),
    ).toBe(true);
  });

  it('marching is deterministic: same seed & commands → same positions', () => {
    const runOnce = () => {
      const sim = freshSim(42);
      const id = raiseArmy(sim, { militia: 12 });
      issueNow(sim, { kind: 'orderArmy', army: id, objective: { kind: 'attackCamp', camp: 0 } });
      run(sim, 200);
      const a = sim.state.armies[0];
      return a ? `${a.x.toFixed(6)},${a.z.toFixed(6)},${a.phase}` : 'gone';
    };
    expect(runOnce()).toBe(runOnce());
  });
});
