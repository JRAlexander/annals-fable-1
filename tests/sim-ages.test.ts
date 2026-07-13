import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { advanceTick } from '../src/sim/tick';
import { freshSim, run, type SimRun } from './helpers';

/** Issue a command on the next tick. */
function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
}

/** Run until pred() or fail after maxTicks. */
function runUntil(sim: SimRun, pred: () => boolean, maxTicks: number, what: string): void {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return;
    advanceTick(sim.state, [], sim.streams);
  }
  if (!pred()) throw new Error(`runUntil: '${what}' not reached within ${maxTicks} ticks`);
}

/** Tests exercise gates/timers, not the economy grind — top up the stockpile. */
function fund(sim: SimRun): void {
  sim.state.realms[0].stock = { food: 5000, wood: 5000, stone: 5000, gold: 5000 };
  sim.state.realms[0].storageCap = { food: 9999, wood: 9999, stone: 9999, gold: 9999 };
}

const buildAndWait = (sim: SimRun, building: string, settlement = 0) => {
  fund(sim);
  const events = issueNow(sim, { kind: 'queueBuilding', settlement, building });
  expect(
    events.some((e) => e.kind === 'buildingQueued'),
    `queue ${building}`,
  ).toBe(true);
  runUntil(
    sim,
    () => (sim.state.settlements[settlement].buildings[building] ?? 0) > 0,
    2000,
    `${building} built`,
  );
};

const researchAndWait = (sim: SimRun, tech: string) => {
  fund(sim);
  const events = issueNow(sim, { kind: 'setResearch', tech });
  expect(
    events.some((e) => e.kind === 'researchStarted'),
    `start ${tech}`,
  ).toBe(true);
  runUntil(sim, () => sim.state.realms[0].researchedTechs.includes(tech), 2000, `${tech} researched`);
};

const advanceAndWait = (sim: SimRun, targetAge: string) => {
  fund(sim);
  const events = issueNow(sim, { kind: 'advanceAge' });
  expect(
    events.some((e) => e.kind === 'ageAdvanceStarted'),
    `advance to ${targetAge}`,
  ).toBe(true);
  runUntil(sim, () => sim.state.realms[0].age === targetAge, 2000, `age ${targetAge}`);
};

describe('ages', () => {
  it('advance rejects without 2 distinct current-age building types', () => {
    const sim = freshSim(1234);
    fund(sim);
    const events = issueNow(sim, { kind: 'advanceAge' });
    const rej = events.find((e) => e.kind === 'commandRejected');
    expect(rej && rej.kind === 'commandRejected' && rej.reason).toMatch(/needs 2 kinds/);
  });

  it('advance rejects when unaffordable even with the buildings', () => {
    const sim = freshSim(1234);
    buildAndWait(sim, 'farm');
    buildAndWait(sim, 'house');
    sim.state.realms[0].stock = { food: 0, wood: 0, stone: 0, gold: 0 };
    const events = issueNow(sim, { kind: 'advanceAge' });
    const rej = events.find((e) => e.kind === 'commandRejected');
    expect(rej && rej.kind === 'commandRejected' && rej.reason).toMatch(/cannot afford/);
  });

  it('age-gated buildings and techs reject before the age, accept after', () => {
    const sim = freshSim(1234);
    fund(sim);
    // temple is a flowering building — locked in founding
    let events = issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'temple' });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);

    buildAndWait(sim, 'farm');
    buildAndWait(sim, 'house');
    advanceAndWait(sim, 'flowering');

    fund(sim);
    events = issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'temple' });
    expect(events.some((e) => e.kind === 'buildingQueued')).toBe(true);
  });

  it('tech-gated building: guildhall needs caravans', () => {
    const sim = freshSim(1234);
    // walk to highKingdom
    buildAndWait(sim, 'farm');
    buildAndWait(sim, 'house');
    advanceAndWait(sim, 'flowering');
    buildAndWait(sim, 'temple');
    buildAndWait(sim, 'granary');
    advanceAndWait(sim, 'highKingdom');

    fund(sim);
    const rejected = issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'guildhall' });
    const rej = rejected.find((e) => e.kind === 'commandRejected');
    expect(rej && rej.kind === 'commandRejected' && rej.reason).toMatch(/Caravans/);
  });

  it('the full four-age climb: founding → flowering → high kingdom → golden', () => {
    const sim = freshSim(1234);

    // Founding: 2 founding building types, then advance
    buildAndWait(sim, 'farm');
    buildAndWait(sim, 'house');
    advanceAndWait(sim, 'flowering');

    // Flowering: 2 flowering types + market for the caravans line
    buildAndWait(sim, 'temple');
    buildAndWait(sim, 'granary');
    buildAndWait(sim, 'market');
    advanceAndWait(sim, 'highKingdom');

    // High Kingdom: university + guildhall (via coinage → caravans)
    buildAndWait(sim, 'university');
    researchAndWait(sim, 'coinage');
    researchAndWait(sim, 'caravans');
    buildAndWait(sim, 'guildhall');
    advanceAndWait(sim, 'golden');

    expect(sim.state.realms[0].age).toBe('golden');
    // and the realm can research a golden tech at its university
    researchAndWait(sim, 'goldenCharter');
    expect(sim.state.realms[0].researchedTechs).toContain('goldenCharter');
  });
});
