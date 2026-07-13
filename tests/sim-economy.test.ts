import { describe, expect, it } from 'vitest';
import { FOOD_PER_POP_DAY } from '../src/content/economy';
import { advanceTick } from '../src/sim/tick';
import { TICKS_PER_DAY } from '../src/sim/time';
import { freshSim, run } from './helpers';

describe('economy', () => {
  it('all four stocks grow from the start over 200 ticks', () => {
    const sim = freshSim(1234);
    const start = { ...sim.state.realms[0].stock };
    run(sim, 200);
    const end = sim.state.realms[0].stock;
    for (const r of ['food', 'wood', 'stone', 'gold'] as const) {
      expect(end[r], r).toBeGreaterThan(start[r]);
    }
  });

  it('one day of food accounting is exact: Δfood = 10×production − pop×need', () => {
    const sim = freshSim(42);
    // warm-up day so derived caches settle; measurement starts on a day boundary
    run(sim, TICKS_PER_DAY);
    const realm = sim.state.realms[0];
    const startFood = realm.stock.food;

    // pop (and thus worker counts) only changes at day end, so per-tick
    // production is constant across the day: measure it on the first tick
    advanceTick(sim.state, [], sim.streams);
    const perTick = realm.stock.food - startFood;
    expect(perTick).toBeGreaterThan(0);

    const popBeforeEating = sim.state.settlements.reduce((t, s) => t + s.pop, 0);
    run(sim, TICKS_PER_DAY - 1); // completes the day, including consumption
    const expected = startFood + TICKS_PER_DAY * perTick - popBeforeEating * FOOD_PER_POP_DAY;
    expect(realm.stock.food).toBeCloseTo(expected, 6);
  });

  it('stock never exceeds storage cap over 3000 ticks, and storageFull fires', () => {
    const sim = freshSim(7);
    const events = run(sim, 3000);
    const realm = sim.state.realms[0];
    for (const r of ['food', 'wood', 'stone', 'gold'] as const) {
      expect(realm.stock[r]).toBeLessThanOrEqual(realm.storageCap[r]);
    }
    expect(events.some((e) => e.kind === 'storageFull')).toBe(true);
  });

  it('fed settlements grow toward the housing cap and never past it', () => {
    const sim = freshSim(1234);
    const pop0 = sim.state.settlements.map((s) => s.pop);
    run(sim, 1200);
    sim.state.settlements.forEach((s, i) => {
      expect(s.pop).toBeGreaterThanOrEqual(pop0[i] * 0.9); // no unexplained collapse
      expect(s.pop).toBeLessThanOrEqual(s.popCap);
    });
    expect(sim.state.settlements.some((s, i) => s.pop > pop0[i])).toBe(true);
  });

  it('starvation: no food and no farms → deaths and starvation events', () => {
    const sim = freshSim(99);
    sim.state.realms[0].stock.food = 0;
    for (const s of sim.state.settlements) {
      s.siteCapacity.farm = 0; // the land gives nothing
      s.alloc = { farm: 0, forest: 1, quarry: 0, trade: 0 };
    }
    const popBefore = sim.state.settlements.reduce((t, s) => t + s.pop, 0);
    const events = run(sim, TICKS_PER_DAY * 20);
    const popAfter = sim.state.settlements.reduce((t, s) => t + s.pop, 0);
    expect(popAfter).toBeLessThan(popBefore);
    expect(events.some((e) => e.kind === 'starvation')).toBe(true);
  });
});
