import { describe, expect, it } from 'vitest';
import { resolveStat } from '../src/sim/modifiers';
import { freshSim } from './helpers';

describe('modifier resolution', () => {
  it('stacks as (base + adds) × muls across researched techs', () => {
    const sim = freshSim(1234);
    const r = sim.state.realms[0];
    r.researchedTechs.push('wheelbarrow', 'cropRotation'); // food ×1.1, ×1.15
    const v = resolveStat({ state: sim.state, realm: 0 }, 100, { stat: 'gatherRate', resource: 'food' });
    expect(v).toBeCloseTo(100 * 1.1 * 1.15, 10);
  });

  it('scope filtering: a food tech does not touch wood; unscoped touches all', () => {
    const sim = freshSim(1234);
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
    const sim = freshSim(1234);
    sim.state.settlements[0].buildings.university = 3; // three universities…
    const one = resolveStat({ state: sim.state, realm: 0 }, 1, { stat: 'researchSpeed' });
    expect(one).toBeCloseTo(1.25, 10); // …still ×1.25, not ×1.25³
  });

  it('settlement scope sees local buildings; realm scope sees the union', () => {
    const sim = freshSim(1234);
    sim.state.settlements[1].buildings.granary = 1; // food ×1.10, presence-based
    const local0 = resolveStat({ state: sim.state, realm: 0, settlement: 0 }, 10, {
      stat: 'gatherRate',
      resource: 'food',
    });
    const local1 = resolveStat({ state: sim.state, realm: 0, settlement: 1 }, 10, {
      stat: 'gatherRate',
      resource: 'food',
    });
    const realmWide = resolveStat({ state: sim.state, realm: 0 }, 10, {
      stat: 'gatherRate',
      resource: 'food',
    });
    expect(local0).toBe(10); // settlement 0 has no granary
    expect(local1).toBeCloseTo(11, 10);
    expect(realmWide).toBeCloseTo(11, 10); // union includes settlement 1's granary
  });

  it('add modifiers apply before muls', () => {
    const sim = freshSim(1234);
    sim.state.settlements[0].buildings.temple = 1; // unrest add −1
    const v = resolveStat({ state: sim.state, realm: 0, settlement: 0 }, 5, { stat: 'unrest' });
    expect(v).toBe(4);
  });
});
