import { describe, expect, it } from 'vitest';
import type { IssuedCommand } from '../src/sim/commands';
import { hashState } from '../src/sim/hash';
import { freshSim, run } from './helpers';

const SCRIPT: Record<number, IssuedCommand[]> = {
  300: [
    {
      tick: 300,
      realm: 0,
      seq: 0,
      cmd: { kind: 'setWorkerAllocation', settlement: 0, alloc: { farm: 2, forest: 1, quarry: 1, trade: 1 } },
    },
  ],
  900: [
    {
      tick: 900,
      realm: 0,
      seq: 1,
      cmd: { kind: 'setWorkerAllocation', settlement: 1, alloc: { forest: 3, farm: 1 } },
    },
  ],
};

// Golden hash for seed 1234 @ 2000 ticks with SCRIPT. If a sim change is
// INTENTIONAL, update this value; if you didn't mean to change sim behavior,
// this failing means you did.
const GOLDEN_HASH_1234 = 'ac338150';

describe('sim determinism', () => {
  it('same seed + same command log → identical state hash after 2000 ticks', () => {
    const a = freshSim(1234);
    const b = freshSim(1234);
    run(a, 2000, SCRIPT);
    run(b, 2000, SCRIPT);
    expect(hashState(a.state)).toBe(hashState(b.state));
  });

  it('matches the committed golden hash', () => {
    const sim = freshSim(1234);
    run(sim, 2000, SCRIPT);
    expect(hashState(sim.state)).toBe(GOLDEN_HASH_1234);
  });

  it('chronicle prose is byte-identical across runs', () => {
    const a = freshSim(42);
    const b = freshSim(42);
    const ta = run(a, 1500).filter((e) => e.kind === 'chronicle');
    const tb = run(b, 1500).filter((e) => e.kind === 'chronicle');
    expect(ta).toEqual(tb);
    expect(ta.length).toBeGreaterThan(0);
  });

  it('state stays structured-clone-safe after 500 ticks', () => {
    const sim = freshSim(7);
    run(sim, 500);
    const clone = structuredClone(sim.state);
    expect(hashState(clone)).toBe(hashState(sim.state));
  });

  it('different seed → different hash', () => {
    const a = freshSim(1);
    const b = freshSim(2);
    run(a, 300);
    run(b, 300);
    expect(hashState(a.state)).not.toBe(hashState(b.state));
  });

  it('an extra command changes the hash', () => {
    const a = freshSim(1234);
    const b = freshSim(1234);
    run(a, 500);
    run(b, 500, {
      100: [
        {
          tick: 100,
          realm: 0,
          seq: 0,
          cmd: { kind: 'setWorkerAllocation', settlement: 0, alloc: { forest: 5 } },
        },
      ],
    });
    expect(hashState(a.state)).not.toBe(hashState(b.state));
  });
});
