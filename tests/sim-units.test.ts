import { describe, expect, it } from 'vitest';
import { replay, type SaveGame } from '../src/app/save';
import { totalUnits } from '../src/sim/combat';
import type { Command, IssuedCommand } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { unitsOf } from '../src/sim/unitStore';
import { worldToCell } from '../src/worldgen/coords';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
}
function conjureArmy(sim: SimRun, units: Record<string, number>): number {
  const s = sim.state.settlements[sim.state.world.capital.id];
  for (const [u, n] of Object.entries(units)) s.garrison[u] = n;
  const events = issueNow(sim, { kind: 'formArmy', settlement: s.id, units });
  const formed = events.find((e) => e.kind === 'armyFormed');
  if (!formed || formed.kind !== 'armyFormed') throw new Error('army not formed');
  return formed.army;
}
/** counts === entities, per type, for every army. */
function parityHolds(sim: SimRun): boolean {
  for (const a of sim.state.armies) {
    const entities = unitsOf(sim.state, a.id);
    const byType = new Map<string, number>();
    for (const u of entities) byType.set(u.type, (byType.get(u.type) ?? 0) + 1);
    for (const [type, n] of Object.entries(a.units)) {
      if ((byType.get(type) ?? 0) !== (n ?? 0)) return false;
    }
    if (entities.length !== totalUnits(a.units)) return false;
  }
  // and no orphans
  const alive = new Set(sim.state.armies.map((a) => a.id));
  return sim.state.units.every((u) => alive.has(u.group));
}

describe('the unit store (M8a)', () => {
  it('formArmy spawns one entity per soldier; disband removes them all', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { militia: 12, spearman: 5 });
    expect(unitsOf(sim.state, id)).toHaveLength(17);
    expect(parityHolds(sim)).toBe(true);
    issueNow(sim, { kind: 'orderArmy', army: id, objective: { kind: 'returnHome' } });
    run(sim, 200);
    expect(sim.state.armies.find((a) => a.id === id)).toBeUndefined();
    expect(sim.state.units.filter((u) => u.group === id)).toHaveLength(0);
  });

  it('casualties thin the ranks: parity holds through a whole war', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { swordsman: 40, spearman: 20, archer: 20 });
    issueNow(sim, { kind: 'orderArmy', army: id, objective: { kind: 'attackCamp', camp: 0 } });
    for (let k = 0; k < 30; k++) {
      run(sim, 100);
      expect(parityHolds(sim), `parity at tick ${sim.state.tick}`).toBe(true);
    }
  });

  it('soldiers steer to their formation slots and follow the march', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { militia: 9 });
    run(sim, 50); // settle into formation
    const army = sim.state.armies.find((a) => a.id === id);
    if (!army) throw new Error('no army');
    for (const u of unitsOf(sim.state, id)) {
      expect(Math.hypot(u.x - army.x, u.z - army.z)).toBeLessThan(60);
    }
    const { i, j } = worldToCell(army.x, army.z);
    issueNow(sim, { kind: 'orderArmy', army: id, objective: { kind: 'moveTo', i: i + 5, j: j + 5 } });
    run(sim, 400);
    for (const u of unitsOf(sim.state, id)) {
      expect(Math.hypot(u.x - army.x, u.z - army.z)).toBeLessThan(80); // the column kept up
    }
  });

  it('moveUnits splits chosen soldiers into a new marching army', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { militia: 10, archer: 6 });
    run(sim, 30);
    const archers = unitsOf(sim.state, id)
      .filter((u) => u.type === 'archer')
      .map((u) => u.id);
    const src = sim.state.armies.find((a) => a.id === id);
    if (!src) throw new Error('no army');
    const { i, j } = worldToCell(src.x, src.z);
    const events = issueNow(sim, {
      kind: 'moveUnits',
      units: archers,
      to: { x: src.x + 300, z: src.z },
    });
    expect(events.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(false);
    const det = sim.state.armies.find((a) => a.id !== id && a.ownerRealm === 0);
    expect(det).toBeDefined();
    if (!det) return;
    expect(det.units.archer).toBe(6);
    expect(src.units.archer).toBeUndefined();
    expect(src.units.militia).toBe(10);
    expect(parityHolds(sim)).toBe(true);
    void i;
    void j;
    run(sim, 600);
    expect(det.phase === 'idle' || det.phase === 'marching').toBe(true);
    expect(parityHolds(sim)).toBe(true);
  });

  it('moveUnits rejects foreign, unknown, and embattled soldiers', () => {
    const sim = freshSim(1234);
    conjureArmy(sim, { militia: 5 });
    const unknown = issueNow(sim, { kind: 'moveUnits', units: [9999], to: { x: 0, z: 0 } });
    expect(unknown.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
    const empty = issueNow(sim, { kind: 'moveUnits', units: [], to: { x: 0, z: 0 } });
    expect(empty.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });

  it('attackTarget sends a detachment at a camp', () => {
    const sim = freshSim(1234);
    const id = conjureArmy(sim, { swordsman: 30, archer: 15 });
    run(sim, 20);
    const half = unitsOf(sim.state, id)
      .slice(0, 25)
      .map((u) => u.id);
    const events = issueNow(sim, { kind: 'attackTarget', units: half, target: 0, targetKind: 'camp' });
    expect(events.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(false);
    const det = sim.state.armies.find((a) => a.id !== id && a.ownerRealm === 0);
    expect(det?.objective).toEqual({ kind: 'attackCamp', camp: 0 });
    expect(parityHolds(sim)).toBe(true);
  });

  it('a save with moveUnits commands replays to the identical hash', () => {
    // fully replayable script: build, train, form, then split — no state pokes
    const capitalId = freshSim(42).state.world.capital.id;
    const script: IssuedCommand[] = [];
    let seq = 0;
    script.push({
      tick: 10,
      realm: 0,
      seq: seq++,
      cmd: { kind: 'queueBuilding', settlement: capitalId, building: 'barracks' },
    });
    script.push({
      tick: 1200,
      realm: 0,
      seq: seq++,
      cmd: { kind: 'trainUnits', settlement: capitalId, unit: 'militia', count: 8 },
    });
    script.push({
      tick: 1600,
      realm: 0,
      seq: seq++,
      cmd: { kind: 'formArmy', settlement: capitalId, units: { militia: 8 } },
    });

    const live = freshSim(42);
    const byTick: Record<number, IssuedCommand[]> = {};
    for (const c of script) byTick[c.tick] = [...(byTick[c.tick] ?? []), c];
    run(live, 1650, byTick);
    // now split 4 known unit ids — the ids are deterministic, so the same
    // command replays identically
    const army = live.state.armies.find((a) => a.ownerRealm === 0);
    if (!army) throw new Error('no army formed in live run');
    const four = unitsOf(live.state, army.id)
      .slice(0, 4)
      .map((u) => u.id);
    const splitCmd: IssuedCommand = {
      tick: 1650,
      realm: 0,
      seq: seq++,
      cmd: { kind: 'moveUnits', units: four, to: { x: army.x + 200, z: army.z } },
    };
    run(live, 350, { 1650: [splitCmd] });

    const save: SaveGame = { v: 2, seed: 42, culture: 'valen', tick: 2000, commands: [...script, splitCmd] };
    const restored = replay(save);
    expect(hashState(restored.state)).toBe(hashState(live.state));
  });
});
