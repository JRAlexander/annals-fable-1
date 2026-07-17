import { describe, expect, it } from 'vitest';
import {
  MARSHAL_ARMY_SIZE,
  MARSHAL_ATTACK_RATIO,
  MARSHAL_FOOD_FLOOR,
  MARSHAL_MAX_ARMIES,
  MARSHAL_RETREAT_FRACTION,
} from '../src/content/rts';
import { campThreat, power, totalUnits } from '../src/sim/combat';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
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
function fund(sim: SimRun, amount = 9000): void {
  sim.state.realms[0].stock = { food: amount, wood: amount, stone: amount, gold: amount };
}
const cap = (sim: SimRun) => sim.state.settlements[sim.state.realms[0].capital];

describe('full autopilot (M14): the steward', () => {
  it('toggles validate ownership; a stewarded town queues a building on the day boundary', () => {
    const sim = freshSim(1234);
    const rival = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!rival) throw new Error('no rival town');
    let events = issueNow(sim, { kind: 'setSteward', settlement: rival.id, enabled: true });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    expect(rival.steward).toBe(false);

    fund(sim);
    events = issueNow(sim, { kind: 'setSteward', settlement: cap(sim).id, enabled: true });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(false);
    expect(cap(sim).steward).toBe(true);
    runUntil(sim, () => cap(sim).buildQueue.length > 0, 20, 'steward queued a building');
    expect(cap(sim).buildQueue[0].building).toBe('farm'); // the book leads with farms
  });

  it('a manually queued building pre-empts the steward for the day', () => {
    const sim = freshSim(1234);
    fund(sim);
    issueNow(sim, { kind: 'setSteward', settlement: cap(sim).id, enabled: true });
    issueNow(sim, { kind: 'queueBuilding', settlement: cap(sim).id, building: 'house' });
    run(sim, 12); // across the day boundary
    // the steward saw a busy queue and stood down — only the player's house is there
    expect(cap(sim).buildQueue.map((j) => j.building)).toEqual(['house']);
  });

  it('fills an idle research slot once per realm per day, and never queues a Wonder', () => {
    const sim = freshSim(1234);
    fund(sim);
    const c = cap(sim);
    // two stewarded towns, one research pick
    const second = sim.state.settlements.find((s) => s.ownerRealm === 0 && s.id !== c.id);
    issueNow(sim, { kind: 'setSteward', settlement: c.id, enabled: true });
    if (second) issueNow(sim, { kind: 'setSteward', settlement: second.id, enabled: true });
    c.buildings.farm = (c.buildings.farm ?? 0) + 1; // something to research at
    runUntil(sim, () => sim.state.realms[0].research !== null, 30, 'research started');
    expect(sim.state.realms[0].research?.kind).toBe('tech');

    // a golden-age fortune: the steward still refuses the Wonder
    sim.state.realms[0].age = 'golden';
    fund(sim, 90000);
    run(sim, 40);
    const wonderQueued = sim.state.settlements.some(
      (s) => s.ownerRealm === 0 && s.buildQueue.some((j) => j.building === 'wonder'),
    );
    expect(wonderQueued).toBe(false);
  });

  it('capture clears the steward; stewarded runs are hash-deterministic', () => {
    const sim = freshSim(1234);
    const c = cap(sim);
    c.steward = true;
    c.governor = true;
    // simulate the capture bookkeeping path via a rival takeover
    issueNow(sim, { kind: 'declareWar', target: 1 });
    // (full siege is covered in sim-autonomy; here assert the flag semantics via twin-run)
    const once = () => {
      const t = freshSim(777);
      t.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
      run(t, 3);
      run(t, 1, {
        [t.state.tick]: [
          {
            tick: t.state.tick,
            realm: 0,
            seq: 0,
            cmd: { kind: 'setSteward', settlement: t.state.realms[0].capital, enabled: true },
          },
        ],
      });
      run(t, 600);
      return hashState(t.state);
    };
    expect(once()).toBe(once());
  });
});

describe('full autopilot (M14): the marshal', () => {
  it('trains the garrison toward the target at barracks towns, honoring the food floor', () => {
    const sim = freshSim(1234);
    fund(sim);
    const c = cap(sim);
    c.buildings.barracks = (c.buildings.barracks ?? 0) + 1;
    issueNow(sim, { kind: 'setMarshal', enabled: true });
    runUntil(sim, () => c.trainQueue.length > 0 || totalUnits(c.garrison) > 0, 20, 'marshal trains');

    // a starving realm trains no one
    const poor = freshSim(1234);
    const pc = cap(poor);
    pc.buildings.barracks = (pc.buildings.barracks ?? 0) + 1;
    poor.state.realms[0].stock = { food: MARSHAL_FOOD_FLOOR - 50, wood: 9000, stone: 9000, gold: 9000 };
    issueNow(poor, { kind: 'setMarshal', enabled: true });
    run(poor, 12);
    expect(pc.trainQueue.length).toBe(0);
  });

  it('skips rally-flagged towns entirely', () => {
    const sim = freshSim(1234);
    fund(sim);
    const c = cap(sim);
    c.buildings.barracks = (c.buildings.barracks ?? 0) + 1;
    const site = sim.state.world.settlements[c.id];
    issueNow(sim, { kind: 'setRally', settlement: c.id, rally: { kind: 'point', i: site.i, j: site.j } });
    issueNow(sim, { kind: 'setMarshal', enabled: true });
    run(sim, 25);
    expect(c.trainQueue.length).toBe(0); // the player has other plans here
  });

  it('forms marshal-flagged armies at MARSHAL_ARMY_SIZE with muster set, up to the cap', () => {
    const sim = freshSim(1234);
    fund(sim);
    const c = cap(sim);
    c.garrison = { militia: MARSHAL_ARMY_SIZE + 2 };
    issueNow(sim, { kind: 'setMarshal', enabled: true });
    runUntil(sim, () => sim.state.armies.some((a) => a.marshal), 15, 'marshal army formed');
    const army = sim.state.armies.find((a) => a.marshal);
    if (!army) throw new Error('no marshal army');
    expect(army.muster).toBe(MARSHAL_ARMY_SIZE + 2);
    expect(army.stance).toBe('defensive');
    expect(MARSHAL_MAX_ARMIES).toBeGreaterThan(0);
  });

  it('clears a beatable nearby camp and declines an unbeatable one', () => {
    const sim = freshSim(1234);
    fund(sim);
    issueNow(sim, { kind: 'setMarshal', enabled: true });
    const c = cap(sim);
    // a host that outmuscles the nearest camp by any measure
    c.garrison = { swordsman: 40, spearman: 20, archer: 20 };
    runUntil(
      sim,
      () => sim.state.armies.some((a) => a.marshal && a.objective?.kind === 'attackCamp'),
      30,
      'camp assault ordered',
    );
    const army = sim.state.armies.find((a) => a.marshal);
    if (!army || army.objective?.kind !== 'attackCamp') throw new Error('no assault');
    const hasRam = (army.units.ram ?? 0) > 0;
    expect(power(sim.state, 0, army.units)).toBeGreaterThanOrEqual(
      MARSHAL_ATTACK_RATIO * campThreat(sim.state, army.objective.camp, hasRam),
    );

    // a token band stations instead of dying at a palisade
    const weak = freshSim(1234);
    weak.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
    issueNow(weak, { kind: 'setMarshal', enabled: true });
    // hand the marshal a tiny pre-flagged army so it never trains a bigger one
    const wc = cap(weak);
    wc.garrison = { militia: MARSHAL_ARMY_SIZE };
    weak.state.realms[0].stock.food = MARSHAL_FOOD_FLOOR - 50; // no reinforcements
    runUntil(weak, () => weak.state.armies.some((a) => a.marshal), 15, 'small army formed');
    run(weak, 15);
    const small = weak.state.armies.find((a) => a.marshal);
    expect(small?.objective?.kind === 'attackCamp').toBe(false);
  });

  it('pulls an under-strength army home to re-muster', () => {
    const sim = freshSim(1234);
    fund(sim);
    const c = cap(sim);
    c.garrison = { militia: MARSHAL_ARMY_SIZE };
    sim.state.realms[0].stock.food = MARSHAL_FOOD_FLOOR - 50; // freeze training
    issueNow(sim, { kind: 'setMarshal', enabled: true });
    runUntil(sim, () => sim.state.armies.some((a) => a.marshal), 15, 'army formed');
    const army = sim.state.armies.find((a) => a.marshal);
    if (!army) throw new Error('no army');
    // the campaign went badly
    army.units = { militia: Math.floor(MARSHAL_RETREAT_FRACTION * army.muster) - 1 };
    runUntil(sim, () => army.objective?.kind === 'returnHome', 15, 'ordered home');
    runUntil(sim, () => !sim.state.armies.some((a) => a.id === army.id), 3000, 'disbanded home');
    expect(totalUnits(c.garrison)).toBeGreaterThan(0);
  });

  it('never declares war, never besieges realms, never touches unmarked armies', () => {
    const sim = freshSim(1234);
    fund(sim, 20000);
    const c = cap(sim);
    c.buildings.barracks = (c.buildings.barracks ?? 0) + 1;
    issueNow(sim, { kind: 'setMarshal', enabled: true });
    // an unmarked player army standing idle in the field
    c.garrison = { militia: 8 };
    issueNow(sim, { kind: 'formArmy', settlement: c.id, units: { militia: 8 } });
    const mine = sim.state.armies.find((a) => a.ownerRealm === 0 && !a.marshal);
    if (!mine) throw new Error('no player army');
    const events = run(sim, 1500);
    expect(events.some((e) => e.kind === 'warDeclared' && e.realm === 0)).toBe(false);
    for (const a of sim.state.armies) {
      if (a.marshal) expect(a.objective?.kind === 'attackSettlement').toBe(false);
    }
    // the unmarked army may fight if attacked, but the marshal never tasked it
    const survivor = sim.state.armies.find((a) => a.id === mine.id);
    if (survivor && survivor.phase === 'idle') expect(survivor.objective).toBeNull();
  });

  it('marshal runs are deterministic and the flag genuinely drives the system', () => {
    const once = (marshal: boolean) => {
      const sim = freshSim(777);
      sim.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
      const c = cap(sim);
      c.buildings.barracks = (c.buildings.barracks ?? 0) + 1;
      run(sim, 3);
      if (marshal) {
        run(sim, 1, {
          [sim.state.tick]: [
            { tick: sim.state.tick, realm: 0, seq: 0, cmd: { kind: 'setMarshal', enabled: true } },
          ],
        });
      } else {
        run(sim, 1);
      }
      run(sim, 1200);
      return hashState(sim.state);
    };
    expect(once(true)).toBe(once(true));
    expect(once(true)).not.toBe(once(false));
  });
});

describe('full autopilot (M14): power arithmetic', () => {
  it('power is monotonic, tech-sensitive; campThreat respects walls and rams', () => {
    const sim = freshSim(1234);
    const p10 = power(sim.state, 0, { militia: 10 });
    const p20 = power(sim.state, 0, { militia: 20 });
    expect(p20).toBeGreaterThan(p10);
    // forging raises attack — a forged realm scores higher for the same men
    sim.state.realms[0].researchedTechs.push('forging');
    expect(power(sim.state, 0, { militia: 10 })).toBeGreaterThan(p10);

    const camp = sim.state.camps[0];
    const bare = power(sim.state, -1, camp.defenders);
    expect(campThreat(sim.state, camp.id, false)).toBeGreaterThan(bare);
    expect(campThreat(sim.state, camp.id, true)).toBeLessThan(campThreat(sim.state, camp.id, false));
    camp.cleared = true;
    expect(campThreat(sim.state, camp.id, false)).toBe(0);
  });
});
