import { clamp, lerp, smoothstep } from '../core/math';
import { makeNoise } from '../core/noise';
import type { Rng } from '../core/rng';
import { ri } from '../core/rng';
import { GRID } from './types';

export interface TerrainResult {
  heightmap: Float32Array;
  /** -1 = landlocked; 0..3 = which edge is sea. */
  coastEdge: number;
}

/** fBm + domain warp + mountain spine + optional coastline, normalized to 0..1. */
export function buildTerrain(seed: number, rng: Rng): TerrainResult {
  const heightmap = new Float32Array(GRID * GRID);
  const nz = makeNoise(seed + 11);
  const nz2 = makeNoise(seed + 29);
  const wz = makeNoise(seed + 53);
  const spineAng = rng() * 3.14;
  const spineOff = (rng() - 0.5) * 0.4;
  const coastEdge = rng() < 0.4 ? ri(rng, 0, 3) : -1;

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const u = i / (GRID - 1);
      const v = j / (GRID - 1);
      const wx = wz(u * 2, v * 2) * 0.35;
      const wy = wz(u * 2 + 7, v * 2 + 3) * 0.35;
      let h = nz(u * 2.2 + wx, v * 2.2 + wy, 6) * 0.5 + 0.5;
      h = h ** 1.35;
      // mountain spine: distance to a line through the map
      const cx = u - 0.5;
      const cy = v - 0.5;
      const d = Math.abs(cx * Math.cos(spineAng) + cy * Math.sin(spineAng) - spineOff);
      const spine = Math.exp((-d * d) / 0.012) * 0.9;
      h = h * 0.62 + spine * 0.7;
      h += nz2(u * 6, v * 6, 4) * 0.06;
      // coastline: lower one edge into sea
      if (coastEdge >= 0) {
        const e = coastEdge === 0 ? u : coastEdge === 1 ? 1 - u : coastEdge === 2 ? v : 1 - v;
        const shore = smoothstep(clamp(e / 0.22, 0, 1));
        h = lerp(-0.12, h, shore);
      }
      heightmap[j * GRID + i] = h;
    }
  }

  let mn = 1e9;
  let mx = -1e9;
  for (let k = 0; k < heightmap.length; k++) {
    mn = Math.min(mn, heightmap[k]);
    mx = Math.max(mx, heightmap[k]);
  }
  for (let k = 0; k < heightmap.length; k++) heightmap[k] = (heightmap[k] - mn) / (mx - mn);

  return { heightmap, coastEdge };
}
