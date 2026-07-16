import { describe, expect, it } from 'vitest';
import { replay, type SaveGame } from '../src/app/save';
import type { Command, IssuedCommand } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { hidx } from '../src/worldgen/coords';
import { GRID } from '../src/worldgen/types';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
}
function fund(sim: SimRun): void {
  sim.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
  sim.state.realms[0].storageCap = { food: 99999, wood: 99999, stone: 99999, gold: 99999 };
}
/** A valid open spot: just outside the capital's core, on land. */
function openSpot(sim: SimRun): { x: number; z: number } {
  const site = sim.state.world.settlements[sim.state.world.capital.id];
  for (let ang = 0; ang < Math.PI * 2; ang += 0.3) {
    const x = site.x + Math.cos(ang) * site.radius * 1.4;
    const z = site.z + Math.sin(ang) * site.radius * 1.4;
    const i = Math.round(((x + 3000) / 6000) * (GRID - 1));
    const j = Math.round(((z + 3000) / 6000) * (GRID - 1));
    if (Number.isFinite(sim.state.world.navCost[hidx(i, j)])) return { x, z };
  }
  throw new Error('no open spot found');
}

describe('free building placement (M7b)', () => {
  it('placeBuilding queues at the nearest settlement and completes at the chosen spot', () => {
    const sim = freshSim(1234);
    fund(sim);
    const at = openSpot(sim);
    const events = issueNow(sim, { kind: 'placeBuilding', building: 'farm', at });
    expect(events.some((e) => e.kind === 'buildingQueued')).toBe(true);
    const capital = sim.state.settlements[sim.state.world.capital.id];
    expect(capital.buildQueue.some((j) => j.at?.x === at.x && j.at?.z === at.z)).toBe(true);

    const all = run(sim, 2000);
    expect(all.some((e) => e.kind === 'buildingCompleted' && e.building === 'farm')).toBe(true);
    expect(capital.placed.some((p) => p.building === 'farm' && p.x === at.x && p.z === at.z)).toBe(true);
    expect(capital.buildings.farm ?? 0).toBeGreaterThan(0); // counts still drive the economy
  });

  it('rejects the sea, foreign ground, and spots far from any settlement', () => {
    const sim = freshSim(1234);
    fund(sim);
    // water cell
    let wx = 0;
    let wz = 0;
    outer: for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        if (!Number.isFinite(sim.state.world.navCost[hidx(i, j)])) {
          wx = (i / (GRID - 1)) * 6000 - 3000;
          wz = (j / (GRID - 1)) * 6000 - 3000;
          break outer;
        }
      }
    }
    const sea = issueNow(sim, { kind: 'placeBuilding', building: 'farm', at: { x: wx, z: wz } });
    expect(sea.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);

    // a rival seat's doorstep is out of OUR influence
    const rival = sim.state.world.settlements[sim.state.realms[1].capital];
    const far = issueNow(sim, {
      kind: 'placeBuilding',
      building: 'farm',
      at: { x: rival.x + rival.radius * 1.2, z: rival.z },
    });
    expect(far.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });

  it('rejects overlap with an already placed building and the town core', () => {
    const sim = freshSim(1234);
    fund(sim);
    const at = openSpot(sim);
    issueNow(sim, { kind: 'placeBuilding', building: 'farm', at });
    fund(sim);
    const overlap = issueNow(sim, { kind: 'placeBuilding', building: 'house', at: { x: at.x + 2, z: at.z } });
    expect(overlap.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);

    const core = sim.state.world.settlements[sim.state.world.capital.id];
    fund(sim);
    const inCore = issueNow(sim, { kind: 'placeBuilding', building: 'house', at: { x: core.x, z: core.z } });
    expect(inCore.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });

  it('still enforces cost and age gates', () => {
    const sim = freshSim(1234);
    const at = openSpot(sim);
    sim.state.realms[0].stock = { food: 0, wood: 0, stone: 0, gold: 0 };
    const broke = issueNow(sim, { kind: 'placeBuilding', building: 'farm', at });
    expect(broke.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
    fund(sim);
    const early = issueNow(sim, { kind: 'placeBuilding', building: 'keep', at });
    expect(early.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });

  it('replays: a save with placeBuilding commands reproduces the exact hash', () => {
    const probe = freshSim(42);
    const at = openSpot(probe); // farm costs 40 wood — affordable from starting stock
    const commands: IssuedCommand[] = [
      { tick: 50, realm: 0, seq: 0, cmd: { kind: 'placeBuilding', building: 'farm', at } },
    ];
    const live = freshSim(42);
    run(live, 2000, { 50: commands });
    const save: SaveGame = { v: 2, seed: 42, culture: 'valen', tick: 2000, commands };
    const restored = replay(save);
    expect(hashState(restored.state)).toBe(hashState(live.state));
    // and the building really stands at its chosen ground in both worlds
    const placed = restored.state.settlements.flatMap((s) => s.placed);
    expect(placed.some((p) => p.building === 'farm' && p.x === at.x && p.z === at.z)).toBe(true);
  });
});
