import { describe, expect, it } from 'vitest';
import { freshSim, run } from './helpers';

describe('chronicle', () => {
  it('opens with a founding entry at tick 0', () => {
    const sim = freshSim(1234);
    const events = run(sim, 1);
    const entry = events.find((e) => e.kind === 'chronicle');
    expect(entry).toBeDefined();
    if (entry?.kind === 'chronicle') {
      expect(entry.text).toContain('Here begins the chronicle');
      expect(entry.tone).toBe('good');
    }
  });

  it('all prose entries are nonempty and dated', () => {
    const sim = freshSim(42);
    const prose = run(sim, 2500).filter((e) => e.kind === 'chronicle');
    expect(prose.length).toBeGreaterThan(1);
    for (const e of prose) {
      if (e.kind === 'chronicle') {
        expect(e.text.length).toBeGreaterThan(10);
        expect(e.tick).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
