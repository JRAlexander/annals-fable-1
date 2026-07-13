import { describe, expect, it } from 'vitest';
import { totalUnits } from '../src/sim/combat';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { advanceTick } from '../src/sim/tick';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
}
function runUntil(sim: SimRun, pred: () => boolean, maxTicks: number, what: string): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return all;
    all.push(...advanceTick(sim.state, [], sim.streams));
  }
  if (!pred()) throw new Error(`runUntil: '${what}' not reached within ${maxTicks} ticks`);
  return all;
}

/** A player army standing ready at the capital, conjured for war tests. */
function conjureArmy(sim: SimRun, units: Record<string, number>): number {
  const capital = sim.state.settlements.find((s) => s.id === sim.state.world.capital.id);
  if (!capital) throw new Error('no capital');
  for (const [u, n] of Object.entries(units)) capital.garrison[u] = n;
  const events = issueNow(sim, { kind: 'formArmy', settlement: capital.id, units });
  const formed = events.find((e) => e.kind === 'armyFormed');
  if (!formed || formed.kind !== 'armyFormed') throw new Error('army not formed');
  return formed.army;
}

describe('war', () => {
  it('declareWar sets mutual state and narrates; duplicates reject', () => {
    const sim = freshSim(1234);
    const events = issueNow(sim, { kind: 'declareWar', target: 1 });
    expect(events.some((e) => e.kind === 'warDeclared')).toBe(true);
    expect(sim.state.realms[0].atWarWith).toContain(1);
    expect(sim.state.realms[1].atWarWith).toContain(0);
    const again = issueNow(sim, { kind: 'declareWar', target: 1 });
    expect(again.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });

  it('attackSettlement rejects at peace, works at war', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { swordsman: 40, spearman: 20 });
    const enemy = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!enemy) throw new Error('no rival settlement');
    let events = issueNow(sim, {
      kind: 'orderArmy',
      army: id,
      objective: { kind: 'attackSettlement', settlement: enemy.id },
    });
    expect(events.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);

    issueNow(sim, { kind: 'declareWar', target: 1 });
    events = issueNow(sim, {
      kind: 'orderArmy',
      army: id,
      objective: { kind: 'attackSettlement', settlement: enemy.id },
    });
    expect(events.some((e) => e.kind === 'armyMarchedOnSettlement')).toBe(true);
  });

  it('a strong army besieges, the levy rises, and the settlement falls', () => {
    const sim = freshSim(1234);
    issueNow(sim, { kind: 'declareWar', target: 1 });
    // weakest rival village
    const enemy = sim.state.settlements.filter((s) => s.ownerRealm === 1).sort((a, b) => a.pop - b.pop)[0];
    if (!enemy) throw new Error('no rival settlement');
    const id = conjureArmy(sim, { swordsman: 60, spearman: 30, archer: 20 });
    issueNow(sim, {
      kind: 'orderArmy',
      army: id,
      objective: { kind: 'attackSettlement', settlement: enemy.id },
    });

    const events = runUntil(sim, () => enemy.ownerRealm === 0, 30000, 'settlement captured');
    expect(events.some((e) => e.kind === 'levyRaised')).toBe(true);
    expect(events.some((e) => e.kind === 'siegeStarted')).toBe(true);
    expect(events.some((e) => e.kind === 'settlementCaptured')).toBe(true);
    expect(totalUnits(enemy.garrison)).toBe(0); // the defenders are no more
  });

  it('AI rivals develop over time and eventually bring war', () => {
    const sim = freshSim(1234);
    const buildingsOf = (realm: number) =>
      sim.state.settlements
        .filter((s) => s.ownerRealm === realm)
        .reduce((t, s) => t + Object.values(s.buildings).reduce((x: number, y) => x + (y ?? 0), 0), 0);
    const before = buildingsOf(1) + buildingsOf(2);
    run(sim, 4000);
    const after = buildingsOf(1) + buildingsOf(2);
    expect(after, 'AI realms construct buildings').toBeGreaterThan(before);
    expect(
      sim.state.realms
        .filter((r) => !r.isPlayer)
        .some((r) => r.researchedTechs.length > 0 || r.research !== null),
      'AI researches',
    ).toBe(true);
    // grace periods are ≤ ~670 days; by day 800 someone declared war on the player
    run(sim, 4200);
    expect(sim.state.realms[0].atWarWith.length, 'the player has enemies').toBeGreaterThan(0);
  });

  it('the sim stays deterministic with AI realms active', () => {
    const once = () => {
      const sim = freshSim(777);
      run(sim, 3000);
      return hashState(sim.state);
    };
    expect(once()).toBe(once());
  });

  it('AI armies march on the player once at war', () => {
    const sim = freshSim(1234);
    // force the war and give the rival a ready garrison — we test the marching logic
    issueNow(sim, { kind: 'declareWar', target: 1 });
    const rivalSeat = sim.state.settlements
      .filter((s) => s.ownerRealm === 1)
      .sort((a, b) => b.pop - a.pop)[0];
    if (!rivalSeat) throw new Error('no rival seat');
    rivalSeat.buildings.barracks = 1;
    rivalSeat.garrison = { militia: 40, spearman: 20 };
    const events = runUntil(
      sim,
      () => sim.state.armies.some((a) => a.ownerRealm === 1),
      12000,
      'AI army formed',
    );
    void events;
    const aiArmy = sim.state.armies.find((a) => a.ownerRealm === 1);
    expect(aiArmy).toBeDefined();
    runUntil(
      sim,
      () =>
        sim.state.armies.some((a) => a.ownerRealm === 1 && a.objective?.kind === 'attackSettlement') ||
        sim.state.settlements.some((s) => s.ownerRealm !== 0 && totalUnits(s.garrison) === 0 && false),
      12000,
      'AI army ordered at the player',
    );
    const marching = sim.state.armies.find((a) => a.ownerRealm === 1);
    expect(marching?.objective?.kind).toBe('attackSettlement');
  });
});
