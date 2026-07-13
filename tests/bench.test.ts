import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/worldgen/world';
import { freshSim, run } from './helpers';

/**
 * Perf regression guard. Run via `npm run sim:bench`.
 * A hard ms/tick budget lands in CI at M4 (units) per docs/PLAN.md.
 */
describe('bench', () => {
  it('worldgen timing', () => {
    const t0 = performance.now();
    const seeds = [1, 2, 3, 4, 5];
    for (const s of seeds) generateWorld(s);
    const ms = (performance.now() - t0) / seeds.length;
    console.log(`generateWorld: ${ms.toFixed(1)} ms avg over ${seeds.length} seeds`);
  });

  it('sim tick timing stays under the 2ms budget with armies in the field', () => {
    const sim = freshSim(1);
    run(sim, 100); // warm-up
    // an active military: garrisons and marching armies in play
    const s = sim.state.settlements[0];
    s.garrison = { militia: 300, spearman: 200, archer: 150 };
    for (let a = 0; a < 4; a++) {
      run(sim, 1, {
        [sim.state.tick]: [
          {
            tick: sim.state.tick,
            realm: 0,
            seq: a,
            cmd: { kind: 'formArmy', settlement: 0, units: { militia: 50, spearman: 30, archer: 20 } },
          },
        ],
      });
    }
    sim.state.armies.forEach((army, i) => {
      run(sim, 1, {
        [sim.state.tick]: [
          {
            tick: sim.state.tick,
            realm: 0,
            seq: i,
            cmd: {
              kind: 'orderArmy',
              army: army.id,
              objective: { kind: 'attackCamp', camp: i % sim.state.camps.length },
            },
          },
        ],
      });
    });
    const N = 2000;
    const t0 = performance.now();
    run(sim, N);
    const ms = (performance.now() - t0) / N;
    console.log(`advanceTick (armies active): ${(ms * 1000).toFixed(1)} µs avg over ${N} ticks`);
    expect(ms).toBeLessThan(2); // docs/PLAN.md budget, enforced from M4
  });
});
