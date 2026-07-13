import { describe, it } from 'vitest';
import { generateWorld } from '../src/worldgen/world';

/**
 * Perf regression guard (grows into the sim tick benchmark at M1).
 * Run via `npm run sim:bench`.
 */
describe('bench', () => {
  it('worldgen timing', () => {
    const t0 = performance.now();
    const seeds = [1, 2, 3, 4, 5];
    for (const s of seeds) generateWorld(s);
    const ms = (performance.now() - t0) / seeds.length;
    // eslint-disable-next-line no-console
    console.log(`generateWorld: ${ms.toFixed(1)} ms avg over ${seeds.length} seeds`);
  });
});
