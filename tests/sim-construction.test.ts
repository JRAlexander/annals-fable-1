import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '../src/content/buildings';
import type { IssuedCommand } from '../src/sim/commands';
import { hashState } from '../src/sim/hash';
import { freshSim, run } from './helpers';

const queue = (building: string, settlement = 0, seq = 0): IssuedCommand => ({
  tick: 0,
  realm: 0,
  seq,
  cmd: { kind: 'queueBuilding', settlement, building },
});

describe('construction', () => {
  it('queueing pays the cost immediately and completes after buildTime', () => {
    const twin = freshSim(1234); // identical run without the command isolates the cost
    const sim = freshSim(1234);
    run(twin, 1);
    const events = run(sim, 1, { 0: [queue('farm')] });
    expect(events.some((e) => e.kind === 'buildingQueued')).toBe(true);
    const woodCost = BUILDINGS.farm.cost.wood as number;
    expect(sim.state.realms[0].stock.wood).toBeCloseTo(twin.state.realms[0].stock.wood - woodCost, 6);
    expect(sim.state.settlements[0].buildQueue).toHaveLength(1);

    const rest = run(sim, BUILDINGS.farm.buildTime);
    expect(rest.some((e) => e.kind === 'buildingCompleted' && e.building === 'farm')).toBe(true);
    expect(sim.state.settlements[0].buildings.farm).toBe(1);
    expect(sim.state.settlements[0].buildQueue).toHaveLength(0);
  });

  it('farms raise food income — villagers can only work fields that exist', () => {
    // same farmer target both worlds; only one world builds the farm
    const wantFarmers: IssuedCommand = {
      tick: 0,
      realm: 0,
      seq: 9,
      cmd: { kind: 'assignVillagers', settlement: 0, job: 'farm', count: 6 },
    };
    const base = freshSim(1234);
    run(base, 400, { 0: [wantFarmers] });

    const built = freshSim(1234);
    run(built, 400, { 0: [wantFarmers, queue('farm', 0, 0), queue('farm', 0, 1)] });

    // with no farm standing the farmers idle: the built world out-eats the bare one
    expect(built.state.realms[0].stock.food).toBeGreaterThan(base.state.realms[0].stock.food);
  });

  it('houses raise the housing cap', () => {
    const sim = freshSim(1234);
    run(sim, 20); // let popCap settle
    const cap0 = sim.state.settlements[0].popCap;
    run(sim, BUILDINGS.house.buildTime + 20, { [sim.state.tick]: [queue('house')] });
    expect(sim.state.settlements[0].popCap).toBe(cap0 + 20);
  });

  it('a storehouse raises the storage cap', () => {
    const sim = freshSim(1234);
    run(sim, 5);
    const cap0 = sim.state.realms[0].storageCap.food;
    run(sim, BUILDINGS.storehouse.buildTime + 5, { [sim.state.tick]: [queue('storehouse')] });
    expect(sim.state.realms[0].storageCap.food).toBe(cap0 + 500);
  });

  it('rejects when unaffordable, leaving state untouched', () => {
    const a = freshSim(7);
    const b = freshSim(7);
    a.state.realms[0].stock.wood = 0;
    b.state.realms[0].stock.wood = 0;
    run(a, 30);
    const events = run(b, 30, { 5: [queue('storehouse')] });
    const rej = events.find((e) => e.kind === 'commandRejected');
    expect(rej && rej.kind === 'commandRejected' && rej.reason).toMatch(/cannot afford/);
    expect(hashState(b.state)).toBe(hashState(a.state));
  });

  it('rejects unknown buildings', () => {
    const sim = freshSim(7);
    const events = run(sim, 5, { 1: [queue('ziggurat')] });
    const rej = events.find((e) => e.kind === 'commandRejected');
    expect(rej && rej.kind === 'commandRejected' && rej.reason).toMatch(/unknown building/);
  });

  it('the queue is FIFO: second building starts after the first completes', () => {
    const sim = freshSim(1234);
    const seeded = sim.state.settlements[0].buildings.house ?? 0; // capitals start housed (M9)
    run(sim, 1, { 0: [queue('house', 0, 0), queue('house', 0, 1)] });
    expect(sim.state.settlements[0].buildQueue).toHaveLength(2);
    run(sim, BUILDINGS.house.buildTime);
    expect(sim.state.settlements[0].buildings.house).toBe(seeded + 1);
    expect(sim.state.settlements[0].buildQueue).toHaveLength(1);
    run(sim, BUILDINGS.house.buildTime);
    expect(sim.state.settlements[0].buildings.house).toBe(seeded + 2);
  });
});
