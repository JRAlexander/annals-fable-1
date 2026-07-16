import { describe, expect, it } from 'vitest';
import type { UnitId } from '../src/content/schema';
import { UNITS } from '../src/content/units';
import { totalUnits } from '../src/sim/combat';
import { hashState } from '../src/sim/hash';
import type { Army, GameState, UnitCounts } from '../src/sim/state';
import { fightUnits } from '../src/sim/systems/unitCombat';
import { spawnArmyUnits } from '../src/sim/unitStore';
import { freshSim } from './helpers';

/** Units per side for a given budget, cost-for-cost. */
function costOf(id: UnitId): number {
  return Object.values(UNITS[id].cost).reduce((t, n) => t + (n ?? 0), 0);
}
function forBudget(id: UnitId, budget: number): number {
  return Math.max(1, Math.floor(budget / costOf(id)));
}

function conjure(state: GameState, ownerRealm: number, counts: UnitCounts, x: number): Army {
  const army: Army = {
    id: state.nextArmyId++,
    ownerRealm,
    home: 0,
    units: { ...counts },
    x,
    z: 0,
    prevX: x,
    prevZ: 0,
    path: [
      [0, 0],
      [0, 0],
    ],
    pathIdx: 1,
    cellProgress: 0,
    objective: null,
    phase: 'fighting',
    stance: 'standGround',
    battleStartStrength: totalUnits(counts),
    engagedWith: -1, // arena-managed
  };
  state.armies.push(army);
  spawnArmyUnits(state, army, counts);
  return army;
}

/**
 * The arena (M8b): two armies face off 60 units apart on an empty field and
 * the per-unit engine runs to the annihilation of a side (or 3000 ticks).
 * Same cost-for-cost expectations as the M4 statistical model — the counter
 * matrix is the balance contract.
 */
function fight(a: UnitCounts, b: UnitCounts): 'a' | 'b' | 'stall' {
  const sim = freshSim(1);
  const A = conjure(sim.state, 0, a, 0);
  const B = conjure(sim.state, -1, b, 60);
  A.engagedWith = B.id;
  B.engagedWith = A.id;
  for (let t = 0; t < 3000; t++) {
    fightUnits(sim.state, A, B);
    const aAlive = totalUnits(A.units);
    const bAlive = totalUnits(B.units);
    if (aAlive <= 0 && bAlive <= 0) return 'stall';
    if (bAlive <= 0) return 'a';
    if (aAlive <= 0) return 'b';
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
    const third = Math.floor(BUDGET / 3);
    expect(
      fight(
        {
          swordsman: forBudget('swordsman', third),
          spearman: forBudget('spearman', third),
          archer: forBudget('archer', third),
        },
        { militia: forBudget('militia', BUDGET) },
      ),
    ).toBe('a');
  });

  it('is deterministic', () => {
    const once = () => {
      const sim = freshSim(9);
      const A = conjure(sim.state, 0, { spearman: 20, archer: 10 }, 0);
      const B = conjure(sim.state, -1, { militia: 25, lightCavalry: 8 }, 60);
      A.engagedWith = B.id;
      B.engagedWith = A.id;
      for (let t = 0; t < 400; t++) fightUnits(sim.state, A, B);
      return hashState(sim.state);
    };
    expect(once()).toBe(once());
  });

  it('military techs tip an otherwise-even fight', () => {
    const sim = freshSim(1);
    sim.state.realms[0].researchedTechs.push('forging', 'scaleArmor');
    const A = conjure(sim.state, 0, { militia: 30 }, 0);
    const B = conjure(sim.state, 2, { militia: 30 }, 60);
    A.engagedWith = B.id;
    B.engagedWith = A.id;
    for (let t = 0; t < 3000; t++) {
      fightUnits(sim.state, A, B);
      if (totalUnits(A.units) <= 0 || totalUnits(B.units) <= 0) break;
    }
    expect(totalUnits(A.units)).toBeGreaterThan(0);
    expect(totalUnits(B.units)).toBe(0);
  });
});
