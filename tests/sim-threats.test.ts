import { describe, expect, it } from 'vitest';
import { RAID_START_DAY, WILD_REALM } from '../src/content/threats';
import { totalUnits } from '../src/sim/combat';
import { TICKS_PER_DAY } from '../src/sim/time';
import { freshSim, run } from './helpers';

describe('threats', () => {
  it('uncleared camps raid on schedule; the bands are wild armies', () => {
    const sim = freshSim(1234);
    const events = run(sim, TICKS_PER_DAY * (RAID_START_DAY + 2));
    const raids = events.filter((e) => e.kind === 'raidSpawned');
    expect(raids.length).toBeGreaterThan(0);
    expect(sim.state.armies.some((a) => a.ownerRealm === WILD_REALM)).toBe(true);
  });

  it('cleared camps stay quiet', () => {
    const sim = freshSim(1234);
    for (const c of sim.state.camps) c.cleared = true;
    const events = run(sim, TICKS_PER_DAY * (RAID_START_DAY + 30));
    expect(events.some((e) => e.kind === 'raidSpawned')).toBe(false);
  });

  it('a raid that beats the garrison plunders but never captures', () => {
    const sim = freshSim(1234);
    // strip every defense so the first raid walks in
    for (const s of sim.state.settlements) s.garrison = {};
    const before = sim.state.settlements.map((s) => s.ownerRealm);
    const events = run(sim, TICKS_PER_DAY * (RAID_START_DAY + 60));
    const raided = events.filter((e) => e.kind === 'settlementRaided');
    expect(raided.length).toBeGreaterThan(0);
    expect(sim.state.settlements.map((s) => s.ownerRealm)).toEqual(before); // no flags changed
    for (const e of raided) {
      if (e.kind === 'settlementRaided') expect(e.plunder).toBeGreaterThan(0);
    }
  });

  it('the dragon wakes with the Golden age, burns, and can be slain', () => {
    const sim = freshSim(1234);
    sim.state.realms[1].age = 'golden'; // ANY realm's dawn wakes it
    // a fortress garrison at every settlement — someone will slay it
    for (const s of sim.state.settlements) {
      s.garrison = { swordsman: 200, spearman: 100, archer: 100 };
    }
    const events = run(sim, TICKS_PER_DAY * 200);
    expect(events.some((e) => e.kind === 'dragonAwakened')).toBe(true);
    expect(sim.state.dragonWoken).toBe(true);
    const slain = events.find((e) => e.kind === 'dragonSlain');
    expect(slain).toBeDefined();
    // one dragon per world — never a second awakening
    expect(events.filter((e) => e.kind === 'dragonAwakened').length).toBe(1);
  });

  it('raid pressure is survivable with a real garrison (balance)', () => {
    const sim = freshSim(1234);
    const capital = sim.state.realms[0].capital;
    // a modest standing force, the kind a player has by day 45
    sim.state.settlements[capital].garrison = { spearman: 15, archer: 10 };
    run(sim, TICKS_PER_DAY * (RAID_START_DAY + 40));
    expect(sim.state.settlements[capital].ownerRealm).toBe(0);
    expect(sim.state.settlements[capital].pop).toBeGreaterThan(50); // not razed to nothing
  });

  it('threats change nothing about determinism: same seed → same hash', () => {
    const hashes = [1, 2].map(() => {
      const sim = freshSim(555);
      run(sim, TICKS_PER_DAY * (RAID_START_DAY + 20));
      return JSON.stringify(sim.state.lastRaidDay) + sim.state.armies.length;
    });
    expect(hashes[0]).toBe(hashes[1]);
  });
});
