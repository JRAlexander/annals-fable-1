import { describe, it } from 'vitest';
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

  it('sim tick timing', () => {
    const sim = freshSim(1);
    run(sim, 100); // warm-up
    const N = 2000;
    const t0 = performance.now();
    run(sim, N);
    const ms = (performance.now() - t0) / N;
    console.log(`advanceTick: ${(ms * 1000).toFixed(1)} µs avg over ${N} ticks`);
  });
});
