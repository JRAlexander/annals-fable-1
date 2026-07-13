import { describe, expect, it } from 'vitest';
import { CULTURE_IDS } from '../src/content/cultures';
import { resolveStat } from '../src/sim/modifiers';
import { initGameState } from '../src/sim/state';
import { generateWorld } from '../src/worldgen/world';
import { freshSim, run } from './helpers';

describe('cultures', () => {
  it('the world is partitioned: 3 realms, every settlement owned, player holds the capital', () => {
    const sim = freshSim(1234);
    expect(sim.state.realms).toHaveLength(3);
    expect(new Set(sim.state.realms.map((r) => r.culture)).size).toBe(3);
    expect(sim.state.realms[0].isPlayer).toBe(true);
    expect(sim.state.realms[1].isPlayer).toBe(false);
    const capital = sim.state.settlements.find((s) => s.id === sim.state.world.capital.id);
    expect(capital?.ownerRealm).toBe(0);
    for (const s of sim.state.settlements) {
      expect(s.ownerRealm).toBeGreaterThanOrEqual(0);
      expect(s.ownerRealm).toBeLessThan(3);
    }
    for (const realmId of [0, 1, 2]) {
      expect(
        sim.state.settlements.some((s) => s.ownerRealm === realmId),
        `realm ${realmId} landless`,
      ).toBe(true);
    }
  });

  it('partition is deterministic', () => {
    const world = generateWorld(7);
    const a = initGameState(world, 'norvik').settlements.map((s) => s.ownerRealm);
    const b = initGameState(generateWorld(7), 'norvik').settlements.map((s) => s.ownerRealm);
    expect(a).toEqual(b);
  });

  it('culture bonuses apply: Ashari research faster, Norvik infantry hit harder', () => {
    const world = generateWorld(1234);
    const ashari = initGameState(world, 'ashari');
    const norvik = initGameState(generateWorld(1234), 'norvik');
    expect(resolveStat({ state: ashari, realm: 0 }, 1, { stat: 'researchSpeed' })).toBeCloseTo(1.25, 10);
    expect(
      resolveStat({ state: norvik, realm: 0 }, 8, { stat: 'unitAttack', unitTag: 'infantry' }),
    ).toBeCloseTo(9, 10);
    // and the player's choice changes which realm has what
    expect(ashari.realms[0].culture).toBe('ashari');
    expect(ashari.realms.map((r) => r.culture).sort()).toEqual([...CULTURE_IDS].sort());
  });

  it('unique units and techs are culture-gated', () => {
    const sim = freshSim(1234); // player = valen
    sim.state.realms[0].stock = { food: 9999, wood: 9999, stone: 9999, gold: 9999 };
    // huscarl is Norvik's — a Valen realm cannot train it even with a barracks
    sim.state.settlements[0].buildings.barracks = 1;
    sim.state.realms[0].age = 'flowering';
    const events = run(sim, 1, {
      [sim.state.tick]: [
        { tick: 0, realm: 0, seq: 0, cmd: { kind: 'trainUnits', settlement: 0, unit: 'huscarl', count: 1 } },
        { tick: 0, realm: 0, seq: 1, cmd: { kind: 'setResearch', tech: 'shieldwall' } },
      ],
    });
    const rejections = events.filter((e) => e.kind === 'commandRejected' && e.realm === 0);
    expect(rejections.length).toBe(2);
  });
});
