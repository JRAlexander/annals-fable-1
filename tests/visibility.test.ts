import { describe, expect, it } from 'vitest';
import {
  accumulate,
  computeVisibility,
  Fog,
  isExploredAt,
  isVisibleAt,
  packExplored,
  unpackExplored,
} from '../src/app/visibility';
import { hidx } from '../src/worldgen/coords';
import { GRID } from '../src/worldgen/types';
import { freshSim, run } from './helpers';

describe('fog of war visibility (M7b)', () => {
  it('the capital is visible at tick 0; the far rival seat is not', () => {
    const sim = freshSim(1234);
    const vis = computeVisibility(sim.state);
    const cap = sim.state.world.settlements[sim.state.realms[0].capital];
    expect(vis[hidx(cap.i, cap.j)]).toBe(Fog.Visible);
    const rival = sim.state.world.settlements[sim.state.realms[1].capital];
    expect(vis[hidx(rival.i, rival.j)]).toBe(Fog.Unexplored);
  });

  it('a marching player army carries sight with it', () => {
    const sim = freshSim(1234);
    const capital = sim.state.settlements[sim.state.world.capital.id];
    capital.garrison = { militia: 10 };
    run(sim, 1, {
      [sim.state.tick]: [
        {
          tick: sim.state.tick,
          realm: 0,
          seq: 0,
          cmd: { kind: 'formArmy', settlement: capital.id, units: { militia: 10 } },
        },
      ],
    });
    const me = sim.state.armies.find((a) => a.ownerRealm === 0);
    if (!me) throw new Error('no army');
    // teleport the scout far from any settlement (visibility is presentation — poking is fine)
    const rival = sim.state.world.settlements[sim.state.realms[1].capital];
    me.x = rival.x;
    me.z = rival.z;
    const vis = computeVisibility(sim.state);
    expect(vis[hidx(rival.i, rival.j)]).toBe(Fog.Visible);
  });

  it('explored accumulates monotonically and survives pack/unpack', () => {
    const sim = freshSim(1234);
    const fog = new Uint8Array(GRID * GRID);
    const vis = computeVisibility(sim.state);
    expect(accumulate(fog, vis)).toBe(true);
    const cap = sim.state.world.settlements[sim.state.realms[0].capital];
    expect(isVisibleAt(fog, cap.x, cap.z)).toBe(true);

    // sight leaves — the ground stays explored, no longer visible
    const empty = new Uint8Array(GRID * GRID);
    accumulate(fog, empty);
    expect(isVisibleAt(fog, cap.x, cap.z)).toBe(false);
    expect(isExploredAt(fog, cap.x, cap.z)).toBe(true);

    const packed = packExplored(fog);
    const restored = unpackExplored(packed);
    for (let k = 0; k < fog.length; k++) {
      expect(restored[k] >= Fog.Explored).toBe(fog[k] >= Fog.Explored);
    }
    expect(unpackExplored(undefined).every((v) => v === Fog.Unexplored)).toBe(true);
  });

  it('unchanged visibility reports no change', () => {
    const sim = freshSim(1234);
    const fog = new Uint8Array(GRID * GRID);
    const vis = computeVisibility(sim.state);
    accumulate(fog, vis);
    expect(accumulate(fog, vis)).toBe(false);
  });
});
