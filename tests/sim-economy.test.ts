import { describe, expect, it } from 'vitest';
import { FOOD_PER_POP_DAY } from '../src/content/economy';
import { advanceTick } from '../src/sim/tick';
import { TICKS_PER_DAY } from '../src/sim/time';
import { freshSim, run } from './helpers';

describe('economy', () => {
  it('a built-up settlement grows all four stocks (buildings are the economy)', () => {
    const sim = freshSim(1234);
    const realm = sim.state.realms[0];
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    // stand the production chain up directly — the build pipeline is tested elsewhere
    s.buildings.farm = 2;
    s.buildings.lumberCamp = 2;
    s.buildings.quarry = 2;
    s.buildings.market = 2;
    s.alloc = { farm: 0.4, forest: 0.3, quarry: 0.2, trade: 0.1 };
    const start = { ...realm.stock };
    run(sim, 200);
    for (const r of ['food', 'wood', 'stone', 'gold'] as const) {
      expect(realm.stock[r], r).toBeGreaterThan(start[r]);
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

    const popBeforeEating = sim.state.settlements
      .filter((x) => x.ownerRealm === 0)
      .reduce((t, s) => t + s.pop, 0);
    run(sim, TICKS_PER_DAY - 1); // completes the day, including consumption
    const expected = startFood + TICKS_PER_DAY * perTick - popBeforeEating * FOOD_PER_POP_DAY;
    expect(realm.stock.food).toBeCloseTo(expected, 6);
  });

  it('stock never exceeds storage cap, and storageFull fires at the brim', () => {
    const sim = freshSim(7);
    run(sim, 1); // let the storage system derive the caps
    const realm = sim.state.realms[0];
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    s.buildings.lumberCamp = 1;
    s.alloc = { farm: 0.25, forest: 0.5, quarry: 0.15, trade: 0.1 };
    realm.stock.wood = realm.storageCap.wood; // the yard is already full
    const events = run(sim, 50);
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
