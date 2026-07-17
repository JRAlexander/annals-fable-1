import { describe, expect, it } from 'vitest';
import { nearestFrontier } from '../src/app/autoExplore';
import { Fog } from '../src/app/visibility';
import { hidx } from '../src/worldgen/coords';
import { GRID } from '../src/worldgen/types';

/** All-land, all-explored world to carve test cases into. */
function fixtures(): { fog: Uint8Array; nav: Float64Array } {
  const fog = new Uint8Array(GRID * GRID).fill(Fog.Explored);
  const nav = new Float64Array(GRID * GRID).fill(1);
  return { fog, nav };
}

describe('auto-explore frontier picking (M13b)', () => {
  it('finds the nearest unexplored navigable cell', () => {
    const { fog, nav } = fixtures();
    fog[hidx(70, 64)] = Fog.Unexplored; // 6 cells out
    fog[hidx(90, 64)] = Fog.Unexplored; // 26 cells out
    expect(nearestFrontier(fog, nav, 64, 64)).toEqual({ i: 70, j: 64 });
  });

  it('ties break deterministically by the fixed ring-scan order', () => {
    const { fog, nav } = fixtures();
    // two frontiers on the same Chebyshev ring: the scan visits dj (rows)
    // outermost, di innermost — lowest j wins, then lowest i within the row
    fog[hidx(64, 60)] = Fog.Unexplored;
    fog[hidx(60, 64)] = Fog.Unexplored;
    const first = nearestFrontier(fog, nav, 64, 64);
    expect(first).toEqual({ i: 64, j: 60 });
    // twice more: same answer, no hidden state
    expect(nearestFrontier(fog, nav, 64, 64)).toEqual(first);
  });

  it('skips water and the caller blacklist', () => {
    const { fog, nav } = fixtures();
    fog[hidx(66, 64)] = Fog.Unexplored;
    nav[hidx(66, 64)] = Number.POSITIVE_INFINITY; // open water — not a destination
    fog[hidx(68, 64)] = Fog.Unexplored;
    fog[hidx(64, 70)] = Fog.Unexplored;
    expect(nearestFrontier(fog, nav, 64, 64)).toEqual({ i: 68, j: 64 });
    const barred = new Set([hidx(68, 64)]);
    expect(nearestFrontier(fog, nav, 64, 64, barred)).toEqual({ i: 64, j: 70 });
  });

  it('a fully explored map yields null', () => {
    const { fog, nav } = fixtures();
    expect(nearestFrontier(fog, nav, 64, 64)).toBeNull();
  });
});
