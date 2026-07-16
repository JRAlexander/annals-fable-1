import { describe, expect, it } from 'vitest';
import { replay, type SaveGame } from '../src/app/save';
import type { IssuedCommand } from '../src/sim/commands';
import { hashState } from '../src/sim/hash';
import { advanceTick } from '../src/sim/tick';
import { freshSim, run } from './helpers';

/** A short reign: raise villagers, assign them, build, train — then the realm sleeps. */
const COMMANDS: IssuedCommand[] = [
  { tick: 200, realm: 0, seq: 0, cmd: { kind: 'trainVillagers', settlement: 0, count: 3 } },
  { tick: 300, realm: 0, seq: 1, cmd: { kind: 'assignVillagers', settlement: 0, job: 'wood', count: 6 } },
  { tick: 400, realm: 0, seq: 2, cmd: { kind: 'queueBuilding', settlement: 0, building: 'barracks' } },
  { tick: 1200, realm: 0, seq: 3, cmd: { kind: 'trainUnits', settlement: 0, unit: 'militia', count: 5 } },
];

describe('save & replay', () => {
  it('replaying seed + command log reproduces the exact state hash', () => {
    const sim = freshSim(1234);
    const byTick: Record<number, IssuedCommand[]> = {};
    for (const c of COMMANDS) byTick[c.tick] = [...(byTick[c.tick] ?? []), c];
    run(sim, 3000, byTick);
    const live = hashState(sim.state);

    const save: SaveGame = { v: 3, seed: 1234, culture: 'valen', tick: 3000, commands: COMMANDS };
    const restored = replay(save);
    expect(hashState(restored.state)).toBe(live);
    expect(restored.state.tick).toBe(3000);
    expect(restored.chronicleTail.length).toBeGreaterThan(0);
  });

  it('a resumed game continues identically to one that never stopped', () => {
    // world A: run 2500 ticks straight
    const straight = freshSim(42);
    run(straight, 2500);

    // world B: run 1500, "save", replay, run the remaining 1000 on the restored state
    const save: SaveGame = { v: 3, seed: 42, culture: 'valen', tick: 1500, commands: [] };
    const resumed = replay(save);
    for (let i = 0; i < 1000; i++) advanceTick(resumed.state, [], resumed.streams);

    expect(hashState(resumed.state)).toBe(hashState(straight.state));
  });

  it('the save round-trips through JSON untouched', () => {
    const save: SaveGame = { v: 3, seed: 7, culture: 'norvik', tick: 500, commands: COMMANDS };
    const back = JSON.parse(JSON.stringify(save)) as SaveGame;
    expect(back).toEqual(save);
    const a = replay(save);
    const b = replay(back);
    expect(hashState(a.state)).toBe(hashState(b.state));
  });
});
