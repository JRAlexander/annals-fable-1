import { describe, expect, it } from 'vitest';
import { resolveStat } from '../src/sim/modifiers';
import { freshSim } from './helpers';

/** Pure-math tests: strip the default culture so only techs/buildings apply. */
function cultureFree(seed: number) {
  const sim = freshSim(seed);
  for (const r of sim.state.realms) r.culture = null;
  return sim;
}

describe('modifier resolution', () => {
  it('stacks as (base + adds) × muls across researched techs', () => {
    const sim = cultureFree(1234);
    const r = sim.state.realms[0];
    r.researchedTechs.push('wheelbarrow', 'cropRotation'); // food ×1.1, ×1.15
    const v = resolveStat({ state: sim.state, realm: 0 }, 100, { stat: 'gatherRate', resource: 'food' });
    expect(v).toBeCloseTo(100 * 1.1 * 1.15, 10);
  });

  it('scope filtering: a food tech does not touch wood; unscoped touches all', () => {
    const sim = cultureFree(1234);
    const r = sim.state.realms[0];
    r.researchedTechs.push('wheelbarrow'); // food-scoped ×1.1
    const ctx = { state: sim.state, realm: 0 };
    expect(resolveStat(ctx, 10, { stat: 'gatherRate', resource: 'wood' })).toBe(10);
    expect(resolveStat(ctx, 10, { stat: 'gatherRate', resource: 'food' })).toBeCloseTo(11, 10);

    r.researchedTechs.push('goldenCharter'); // unscoped gatherRate ×1.05
    expect(resolveStat(ctx, 10, { stat: 'gatherRate', resource: 'wood' })).toBeCloseTo(10.5, 10);
    expect(resolveStat(ctx, 10, { stat: 'gatherRate', resource: 'food' })).toBeCloseTo(11 * 1.05, 10);
  });

  it('building presence applies once per TYPE per scope, not per instance', () => {
    const sim = cultureFree(1234);
    sim.state.settlements[0].buildings.university = 3; // three universities…
    const one = resolveStat({ state: sim.state, realm: 0 }, 1, { stat: 'researchSpeed' });
    expect(one).toBeCloseTo(1.25, 10); // …still ×1.25, not ×1.25³
  });

  it('settlement scope sees local buildings; realm scope sees the union', () => {
    const sim = cultureFree(1234);
    // the world is partitioned among 3 realms now — use two PLAYER settlements
    const mine = sim.state.settlements.filter((s) => s.ownerRealm === 0);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const [a, b] = mine;
    b.buildings.granary = 1; // food ×1.10, presence-based
    const localA = resolveStat({ state: sim.state, realm: 0, settlement: a.id }, 10, {
      stat: 'gatherRate',
      resource: 'food',
    });
    const localB = resolveStat({ state: sim.state, realm: 0, settlement: b.id }, 10, {
      stat: 'gatherRate',
      resource: 'food',
    });
    const realmWide = resolveStat({ state: sim.state, realm: 0 }, 10, {
      stat: 'gatherRate',
      resource: 'food',
    });
    expect(localA).toBe(10); // no granary here
    expect(localB).toBeCloseTo(11, 10);
    expect(realmWide).toBeCloseTo(11, 10); // union includes the other settlement's granary
  });

  it('add modifiers apply before muls', () => {
    const sim = cultureFree(1234);
    sim.state.settlements[0].buildings.temple = 1; // unrest add −1
    const v = resolveStat({ state: sim.state, realm: 0, settlement: 0 }, 5, { stat: 'unrest' });
    expect(v).toBe(4);
  });
});
