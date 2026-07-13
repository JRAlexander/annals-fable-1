import { describe, expect, it } from 'vitest';
import { makeRng, makeStreams } from '../src/core/rng';

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('streams are independent — draining one never affects another', () => {
    const s1 = makeStreams(42);
    const s2 = makeStreams(42);
    for (let i = 0; i < 500; i++) s1.combat(); // extra combat rolls in run 1 only
    for (let i = 0; i < 100; i++) expect(s1.world()).toBe(s2.world());
    for (let i = 0; i < 100; i++) expect(s1.history()).toBe(s2.history());
  });

  it('outputs stay in [0, 1)', () => {
    const r = makeRng(999);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
