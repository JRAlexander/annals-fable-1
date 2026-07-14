import { describe, expect, it } from 'vitest';
import type { IssuedCommand } from '../src/sim/commands';
import { hashState } from '../src/sim/hash';
import { freshSim, run } from './helpers';

const issue = (cmd: IssuedCommand['cmd'], realm = 0, seq = 0): IssuedCommand => ({
  tick: 0,
  realm,
  seq,
  cmd,
});

describe('commands', () => {
  it('setWorkerAllocation shifts income: all-forest beats baseline wood, loses food', () => {
    const base = freshSim(1234);
    run(base, 600);

    const forest = freshSim(1234);
    const cmds: IssuedCommand[] = forest.state.settlements
      .filter((s) => s.ownerRealm === 0)
      .map((s, i) =>
        issue(
          {
            kind: 'setWorkerAllocation',
            settlement: s.id,
            alloc: { farm: 0, forest: 1, quarry: 0, trade: 0 },
          },
          0,
          i,
        ),
      );
    run(forest, 600, { 0: cmds });

    expect(forest.state.realms[0].stock.wood).toBeGreaterThan(base.state.realms[0].stock.wood);
    expect(forest.state.realms[0].stock.food).toBeLessThan(base.state.realms[0].stock.food);
  });

  it('invalid settlement id rejects without touching state', () => {
    const a = freshSim(7);
    const b = freshSim(7);
    run(a, 50);
    const events = run(b, 50, {
      10: [issue({ kind: 'setWorkerAllocation', settlement: 999, alloc: { farm: 1 } })],
    });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    expect(hashState(b.state)).toBe(hashState(a.state));
  });

  it('a foreign realm cannot reallocate someone else’s settlement', () => {
    const sim = freshSim(7);
    const events = run(sim, 20, {
      5: [issue({ kind: 'setWorkerAllocation', settlement: 0, alloc: { farm: 1 } }, 3)],
    });
    const rej = events.find((e) => e.kind === 'commandRejected');
    expect(rej).toBeDefined();
  });

  it('negative or all-zero weights reject', () => {
    const sim = freshSim(7);
    const events = run(sim, 20, {
      5: [
        issue({ kind: 'setWorkerAllocation', settlement: 0, alloc: { farm: -1 } }, 0, 0),
        issue(
          { kind: 'setWorkerAllocation', settlement: 0, alloc: { farm: 0, forest: 0, quarry: 0, trade: 0 } },
          0,
          1,
        ),
      ],
    });
    expect(events.filter((e) => e.kind === 'commandRejected' && e.realm === 0)).toHaveLength(2);
  });

  it('unit commands with unknown soldiers reject cleanly instead of throwing', () => {
    const sim = freshSim(7);
    const events = run(sim, 10, {
      2: [issue({ kind: 'moveUnits', units: [999], to: { x: 0, z: 0 } })],
    });
    const rej = events.find((e) => e.kind === 'commandRejected' && e.realm === 0);
    expect(rej && rej.kind === 'commandRejected' && rej.reason).toMatch(/no more/);
  });
});
