import { describe, expect, it } from 'vitest';
import { WONDER_DAYS } from '../src/content/threats';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { TICKS_PER_DAY } from '../src/sim/time';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
}

describe('victory and defeat', () => {
  it('every realm seats its capital; the player holds the world capital', () => {
    const sim = freshSim(1234);
    for (const r of sim.state.realms) {
      expect(sim.state.settlements[r.capital]?.ownerRealm, `realm ${r.id} owns its capital`).toBe(r.id);
    }
    expect(sim.state.realms[0].capital).toBe(sim.state.world.capital.id);
    expect(sim.state.outcome).toBeNull();
  });

  it('defeat: the game is lost when the player capital falls', () => {
    const sim = freshSim(1234);
    sim.state.settlements[sim.state.realms[0].capital].ownerRealm = 1;
    const events = run(sim, TICKS_PER_DAY + 1);
    expect(sim.state.outcome).toEqual({ kind: 'defeat' });
    expect(events.some((e) => e.kind === 'gameLost')).toBe(true);
    // the ending is latched — the world ticking on does not re-emit it
    const later = run(sim, TICKS_PER_DAY * 3);
    expect(later.some((e) => e.kind === 'gameLost')).toBe(false);
  });

  it('conquest: the game is won when the player holds every capital', () => {
    const sim = freshSim(1234);
    for (const r of sim.state.realms) sim.state.settlements[r.capital].ownerRealm = 0;
    const events = run(sim, TICKS_PER_DAY + 1);
    expect(sim.state.outcome).toEqual({ kind: 'victory', how: 'conquest' });
    expect(events.some((e) => e.kind === 'gameWon' && e.how === 'conquest')).toBe(true);
  });

  it('wonder: standing WONDER_DAYS unbroken wins; losing the town resets the clock', () => {
    const sim = freshSim(1234);
    const capital = sim.state.realms[0].capital;
    sim.state.settlements[capital].buildings.wonder = 1;
    let events = run(sim, TICKS_PER_DAY + 1);
    expect(events.some((e) => e.kind === 'wonderCompleted' && e.realm === 0)).toBe(true);
    expect(sim.state.realms[0].wonderDay).not.toBeNull();
    expect(sim.state.outcome).toBeNull(); // the clock has only started

    // the town falls before the season is out — the dream dies with it
    const fallen = structuredClone(sim.state);
    sim.state.settlements[capital].ownerRealm = 1;
    run(sim, TICKS_PER_DAY + 1);
    expect(sim.state.realms[0].wonderDay).toBeNull();

    // parallel world where it stands: victory after WONDER_DAYS
    sim.state = fallen;
    events = run(sim, TICKS_PER_DAY * (WONDER_DAYS + 2));
    expect(sim.state.outcome).toEqual({ kind: 'victory', how: 'wonder' });
    expect(events.some((e) => e.kind === 'gameWon' && e.how === 'wonder')).toBe(true);
  });

  it('a realm raises only one Wonder', () => {
    const sim = freshSim(1234);
    const r = sim.state.realms[0];
    r.age = 'golden';
    r.stock = { food: 9999, wood: 9999, stone: 9999, gold: 9999 };
    const first = issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'wonder' });
    expect(first.some((e) => e.kind === 'buildingQueued' && e.building === 'wonder')).toBe(true);
    r.stock = { food: 9999, wood: 9999, stone: 9999, gold: 9999 };
    const second = issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'wonder' });
    expect(second.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });
});
