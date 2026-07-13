import { describe, expect, it } from 'vitest';
import type { UnitId } from '../src/content/schema';
import { UNITS } from '../src/content/units';
import { makeRng } from '../src/core/rng';
import { applyLosses, resolveRound, totalUnits } from '../src/sim/combat';
import type { UnitCounts } from '../src/sim/state';
import { freshSim } from './helpers';

/** Units per side for a given budget, cost-for-cost. */
function costOf(id: UnitId): number {
  return Object.values(UNITS[id].cost).reduce((t, n) => t + (n ?? 0), 0);
}
function forBudget(id: UnitId, budget: number): number {
  return Math.max(1, Math.floor(budget / costOf(id)));
}

/** Fight to the end (or 500 rounds); returns the surviving side. */
function fight(a: UnitCounts, b: UnitCounts, seed = 7): 'a' | 'b' | 'stall' {
  const sim = freshSim(1);
  const rng = makeRng(seed);
  const ctx = { state: sim.state, realm: 0 };
  const foeCtx = { state: sim.state, realm: -1 };
  const aa: UnitCounts = { ...a };
  const bb: UnitCounts = { ...b };
  for (let round = 0; round < 500; round++) {
    const r = resolveRound(aa, bb, ctx, foeCtx, rng);
    applyLosses(aa, r.attackerLosses);
    applyLosses(bb, r.defenderLosses);
    if (totalUnits(aa) <= 0 && totalUnits(bb) <= 0) return 'stall';
    if (totalUnits(bb) <= 0) return 'a';
    if (totalUnits(aa) <= 0) return 'b';
  }
  return 'stall';
}

const BUDGET = 3000;

describe('combat counters (cost-for-cost)', () => {
  it('spearmen beat knights', () => {
    expect(fight({ spearman: forBudget('spearman', BUDGET) }, { knight: forBudget('knight', BUDGET) })).toBe(
      'a',
    );
  });

  it('knights beat militia', () => {
    expect(fight({ knight: forBudget('knight', BUDGET) }, { militia: forBudget('militia', BUDGET) })).toBe(
      'a',
    );
  });

  it('skirmishers beat archers', () => {
    expect(
      fight({ skirmisher: forBudget('skirmisher', BUDGET) }, { archer: forBudget('archer', BUDGET) }),
    ).toBe('a');
  });

  it('archers beat militia', () => {
    expect(fight({ archer: forBudget('archer', BUDGET) }, { militia: forBudget('militia', BUDGET) })).toBe(
      'a',
    );
  });

  it('light cavalry beat archers', () => {
    expect(
      fight({ lightCavalry: forBudget('lightCavalry', BUDGET) }, { archer: forBudget('archer', BUDGET) }),
    ).toBe('a');
  });

  it('swordsmen beat spearmen', () => {
    expect(
      fight({ swordsman: forBudget('swordsman', BUDGET) }, { spearman: forBudget('spearman', BUDGET) }),
    ).toBe('a');
  });

  it('a mixed force beats mono-militia of equal cost', () => {
    const third = BUDGET / 3;
    expect(
      fight(
        {
          swordsman: forBudget('swordsman', third),
          archer: forBudget('archer', third),
          spearman: forBudget('spearman', third),
        },
        { militia: forBudget('militia', BUDGET) },
      ),
    ).toBe('a');
  });

  it('is deterministic for a fixed rng seed', () => {
    const a = { spearman: 20, archer: 10 };
    const b = { militia: 25, lightCavalry: 8 };
    expect(fight(a, b, 42)).toBe(fight(a, b, 42));
  });

  it('military techs tip an otherwise-even fight', () => {
    const sim = freshSim(1);
    const rng = makeRng(9);
    const armed = { state: sim.state, realm: 0 };
    const plain = { state: sim.state, realm: -1 };
    sim.state.realms[0].researchedTechs.push('forging', 'scaleArmor');
    const mine: UnitCounts = { militia: 30 };
    const theirs: UnitCounts = { militia: 30 };
    for (let round = 0; round < 500; round++) {
      const r = resolveRound(mine, theirs, armed, plain, rng);
      applyLosses(mine, r.attackerLosses);
      applyLosses(theirs, r.defenderLosses);
      if (totalUnits(mine) <= 0 || totalUnits(theirs) <= 0) break;
    }
    expect(totalUnits(mine)).toBeGreaterThan(0);
    expect(totalUnits(theirs)).toBe(0);
  });
});
