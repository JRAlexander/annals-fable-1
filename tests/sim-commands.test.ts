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
  it('assignVillagers shifts income: all-wood beats baseline wood, starves the quarries', () => {
    const base = freshSim(1234);
    run(base, 250);

    const forest = freshSim(1234);
    const cmds: IssuedCommand[] = [];
    let seq = 0;
    for (const s of forest.state.settlements.filter((x) => x.ownerRealm === 0)) {
      const n = forest.state.villagers.filter((v) => v.settlement === s.id).length;
      cmds.push(issue({ kind: 'assignVillagers', settlement: s.id, job: 'stone', count: 0 }, 0, seq++));
      cmds.push(issue({ kind: 'assignVillagers', settlement: s.id, job: 'gold', count: 0 }, 0, seq++));
      cmds.push(issue({ kind: 'assignVillagers', settlement: s.id, job: 'wood', count: n }, 0, seq++));
    }
    run(forest, 250, { 0: cmds });

    expect(forest.state.realms[0].stock.wood).toBeGreaterThan(base.state.realms[0].stock.wood);
    expect(forest.state.realms[0].stock.stone).toBeLessThanOrEqual(base.state.realms[0].stock.stone);
  });

  it('invalid settlement id rejects without touching state', () => {
    const a = freshSim(7);
    const b = freshSim(7);
    run(a, 50);
    const events = run(b, 50, {
      10: [issue({ kind: 'assignVillagers', settlement: 999, job: 'farm', count: 1 })],
    });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    expect(hashState(b.state)).toBe(hashState(a.state));
  });

  it('a foreign realm cannot reassign someone else’s villagers', () => {
    const sim = freshSim(7);
    const events = run(sim, 20, {
      5: [issue({ kind: 'assignVillagers', settlement: 0, job: 'farm', count: 1 }, 3)],
    });
    const rej = events.find((e) => e.kind === 'commandRejected');
    expect(rej).toBeDefined();
  });

  it('negative, fractional, or absurd job targets reject', () => {
    const sim = freshSim(7);
    const events = run(sim, 20, {
      5: [
        issue({ kind: 'assignVillagers', settlement: 0, job: 'farm', count: -1 }, 0, 0),
        issue({ kind: 'assignVillagers', settlement: 0, job: 'farm', count: 1.5 }, 0, 1),
        issue({ kind: 'assignVillagers', settlement: 0, job: 'farm', count: 9999 }, 0, 2),
      ],
    });
    expect(events.filter((e) => e.kind === 'commandRejected' && e.realm === 0)).toHaveLength(3);
  });

  it('trainVillagers pays food and pop; poverty and the pop floor reject', () => {
    const sim = freshSim(7);
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    const popBefore = s.pop;
    const foodBefore = sim.state.realms[0].stock.food;
    run(sim, 1, { 0: [issue({ kind: 'trainVillagers', settlement: s.id, count: 2 })] });
    expect(s.pop).toBe(popBefore - 2);
    expect(sim.state.realms[0].stock.food).toBe(foodBefore - 80);
    expect(s.villagerQueue.remaining).toBe(2);

    // broke realm rejects
    sim.state.realms[0].stock.food = 0;
    let events = run(sim, 1, {
      [sim.state.tick]: [issue({ kind: 'trainVillagers', settlement: s.id, count: 1 })],
    });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);

    // pop floor rejects
    sim.state.realms[0].stock.food = 9000;
    s.pop = 30;
    events = run(sim, 1, {
      [sim.state.tick]: [issue({ kind: 'trainVillagers', settlement: s.id, count: 1 })],
    });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
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
