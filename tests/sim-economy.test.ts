import { describe, expect, it } from 'vitest';
import { CARRY_CAPACITY } from '../src/content/economy';
import { resolveStat } from '../src/sim/modifiers';
import { isDayEnd, TICKS_PER_DAY } from '../src/sim/time';
import { freshSim, run } from './helpers';

/** Give a settlement standing, PLACED workplaces — placement matters now. */
function standUp(sim: ReturnType<typeof freshSim>, sid: number, building: string, n: number, r = 60) {
  const s = sim.state.settlements[sid];
  const site = sim.state.world.settlements[sid];
  s.buildings[building] = (s.buildings[building] ?? 0) + n;
  for (let i = 0; i < n; i++) {
    s.placed.push({ building, x: site.x + r + i * 30, z: site.z + 20 });
  }
}

describe('economy (villagers carry it — M12)', () => {
  it('a worked settlement grows all four stocks', () => {
    const sim = freshSim(1234);
    const realm = sim.state.realms[0];
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    standUp(sim, s.id, 'farm', 2);
    standUp(sim, s.id, 'market', 1, 120);
    s.jobTargets = { farm: 4, wood: 3, stone: 2, gold: 2 };
    const start = { ...realm.stock };
    run(sim, 600);
    for (const r of ['food', 'wood', 'stone', 'gold'] as const) {
      expect(realm.stock[r], r).toBeGreaterThan(start[r]);
    }
  });

  it('income arrives in whole carried loads — every deposit is one basket', () => {
    const sim = freshSim(42);
    // one farmer, one farm, nobody else works, across every player town
    for (const s of sim.state.settlements) {
      if (s.ownerRealm !== 0) continue;
      s.jobTargets = { farm: 0, wood: 0, stone: 0, gold: 0 };
    }
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    standUp(sim, s.id, 'farm', 1);
    s.jobTargets.farm = 1;
    const carry = resolveStat({ state: sim.state, realm: 0, settlement: s.id }, CARRY_CAPACITY, {
      stat: 'gatherRate',
      resource: 'food',
    });

    run(sim, 5); // let the reconciler put the farmer to work
    const realm = sim.state.realms[0];
    let deposits = 0;
    for (let t = 0; t < 60; t++) {
      const eatingTick = isDayEnd(sim.state.tick); // this tick ends a day: the realm eats
      const before = realm.stock.food;
      run(sim, 1);
      const delta = realm.stock.food - before;
      if (eatingTick) continue;
      if (delta > 0) {
        expect(delta).toBeCloseTo(carry, 8);
        deposits++;
      }
    }
    expect(deposits).toBeGreaterThan(0); // the farmer completed trips
  });

  it('stock never exceeds storage cap, and storageFull fires at the brim', () => {
    const sim = freshSim(7);
    run(sim, 1); // let the storage system derive the caps
    const realm = sim.state.realms[0];
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    s.jobTargets = { farm: 0, wood: 5, stone: 0, gold: 0 };
    realm.stock.wood = realm.storageCap.wood; // the yard is already full
    const events = run(sim, 300);
    for (const r of ['food', 'wood', 'stone', 'gold'] as const) {
      expect(realm.stock[r]).toBeLessThanOrEqual(realm.storageCap[r]);
    }
    expect(events.some((e) => e.kind === 'storageFull')).toBe(true);
  });

  it('fed settlements grow toward the housing cap and never past it', () => {
    const sim = freshSim(1234);
    // a realm without farms starves by design now — feed the player's people
    const cap = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!cap) throw new Error('player owns nothing');
    standUp(sim, cap.id, 'farm', 2);
    const pop0 = sim.state.settlements.map((s) => s.pop);
    run(sim, 1200);
    sim.state.settlements.forEach((s, i) => {
      expect(s.pop, `settlement ${i}`).toBeGreaterThanOrEqual(pop0[i] * 0.9); // no unexplained collapse
      expect(s.pop).toBeLessThanOrEqual(s.popCap);
    });
    expect(sim.state.settlements.some((s, i) => s.pop > pop0[i])).toBe(true);
  });

  it('starvation: no food and no farms → deaths and starvation events', () => {
    const sim = freshSim(99);
    sim.state.realms[0].stock.food = 0; // no farms stand at init — no food comes in
    const popBefore = sim.state.settlements.reduce((t, s) => t + s.pop, 0);
    const events = run(sim, TICKS_PER_DAY * 20);
    const popAfter = sim.state.settlements.reduce((t, s) => t + s.pop, 0);
    expect(popAfter).toBeLessThan(popBefore);
    expect(events.some((e) => e.kind === 'starvation')).toBe(true);
  });
});
