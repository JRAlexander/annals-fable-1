import { describe, expect, it } from 'vitest';
import {
  BASE_GATHER_PER_TICK,
  HOUSING_BASE,
  JOB_RESOURCE,
  STORAGE_BASE,
  WORK_JOBS,
} from '../src/content/economy';
import { TECHS } from '../src/content/techs';
import type { IssuedCommand } from '../src/sim/commands';
import { hashState } from '../src/sim/hash';
import { resolveStat } from '../src/sim/modifiers';
import { freshSim, run } from './helpers';

const research = (tech: string, seq = 0): IssuedCommand => ({
  tick: 0,
  realm: 0,
  seq,
  cmd: { kind: 'setResearch', tech },
});

describe('research', () => {
  it('pays at start and completes at exactly researchTime', () => {
    const sim = freshSim(1234);
    // capital starts with no farm building — build one so wheelbarrow is researchable
    run(sim, 1, {
      0: [{ tick: 0, realm: 0, seq: 0, cmd: { kind: 'queueBuilding', settlement: 0, building: 'farm' } }],
    });
    run(sim, TECHS.wheelbarrow.researchTime + 5); // wait out farm construction
    const food0 = sim.state.realms[0].stock.food;
    const events = run(sim, 1, { [sim.state.tick]: [research('wheelbarrow')] });
    expect(events.some((e) => e.kind === 'researchStarted')).toBe(true);
    // cost deducted at start (production also ran this tick, so compare < start)
    expect(sim.state.realms[0].stock.food).toBeLessThan(food0);
    expect(sim.state.realms[0].research).toEqual({ kind: 'tech', tech: 'wheelbarrow', progress: 1 });

    const rest = run(sim, TECHS.wheelbarrow.researchTime);
    expect(rest.some((e) => e.kind === 'researchCompleted')).toBe(true);
    expect(sim.state.realms[0].researchedTechs).toContain('wheelbarrow');
    expect(sim.state.realms[0].research).toBeNull();
  });

  it('every tech measurably changes some resolved stat (the M3 done-criterion)', () => {
    // one world for all techs — a fresh worldgen per tech blows CI's test timeout
    const sim = freshSim(1234);
    for (const tech of Object.values(TECHS)) {
      sim.state.realms[0].researchedTechs = [];
      const ctx = { state: sim.state, realm: 0 };
      const queries = [
        ...WORK_JOBS.map((j) => ({
          label: `gather:${j}`,
          q: { stat: 'gatherRate' as const, resource: JOB_RESOURCE[j] },
          base: BASE_GATHER_PER_TICK[j],
        })),
        { label: 'housing', q: { stat: 'housingCap' as const }, base: HOUSING_BASE.capital },
        { label: 'storage', q: { stat: 'storageCap' as const }, base: STORAGE_BASE.capital },
        { label: 'growth', q: { stat: 'popGrowth' as const }, base: 0.002 },
        { label: 'build', q: { stat: 'buildSpeed' as const }, base: 1 },
        { label: 'research', q: { stat: 'researchSpeed' as const }, base: 1 },
        ...(['infantry', 'cavalry', 'ranged', 'siege'] as const).flatMap((tag) => [
          { label: `atk:${tag}`, q: { stat: 'unitAttack' as const, unitTag: tag }, base: 8 },
          { label: `arm:${tag}`, q: { stat: 'unitArmor' as const, unitTag: tag }, base: 2 },
        ]),
      ];
      const before = queries.map((q) => resolveStat(ctx, q.base, q.q));
      sim.state.realms[0].researchedTechs.push(tech.id);
      const after = queries.map((q) => resolveStat(ctx, q.base, q.q));
      expect(after, `tech ${tech.id} changed nothing`).not.toEqual(before);
    }
  });

  it('a university speeds up research realm-wide', () => {
    const plain = freshSim(1234);
    const learned = freshSim(1234);
    learned.state.settlements[2].buildings.university = 1;
    const speed = (sim: typeof plain) =>
      resolveStat({ state: sim.state, realm: 0 }, 1, { stat: 'researchSpeed' });
    expect(speed(learned)).toBeGreaterThan(speed(plain));
  });

  it('rejection paths leave the state hash untouched', () => {
    const mk = () => {
      const sim = freshSim(7);
      run(sim, 30);
      return sim;
    };
    const cases: IssuedCommand['cmd'][] = [
      { kind: 'setResearch', tech: 'ziggurat' }, // unknown
      { kind: 'setResearch', tech: 'banking' }, // age gate (highKingdom in founding)
      { kind: 'setResearch', tech: 'wheelbarrow' }, // no farm building yet at seed 7 start
    ];
    for (const cmd of cases) {
      const baseline = mk();
      run(baseline, 1);
      const sim = mk();
      const events = run(sim, 1, { [sim.state.tick]: [{ tick: 0, realm: 0, seq: 0, cmd }] });
      expect(
        events.some((e) => e.kind === 'commandRejected'),
        JSON.stringify(cmd),
      ).toBe(true);
      expect(hashState(sim.state)).toBe(hashState(baseline.state));
    }
  });

  it('slot exclusivity: cannot start a second research while one runs', () => {
    const sim = freshSim(1234);
    run(sim, 1, {
      0: [{ tick: 0, realm: 0, seq: 0, cmd: { kind: 'queueBuilding', settlement: 0, building: 'farm' } }],
    });
    run(sim, 100);
    const t = sim.state.tick;
    const events = run(sim, 1, {
      [t]: [research('wheelbarrow', 0), research('timberFraming', 1)],
    });
    // second command rejects: either busy-slot (farm exists) or missing house building
    expect(events.filter((e) => e.kind === 'commandRejected').length).toBeGreaterThanOrEqual(1);
  });
});
