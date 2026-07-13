import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { ri } from '../core/rng';
import { hidx } from './coords';
import { CELL_SCALE, GRID, SEA_LEVEL } from './types';

export interface HydrologyResult {
  rivers: [number, number][][];
  riverDist: Float32Array;
  isRiver: Uint8Array;
}

/**
 * Steepest-descent river carving from the highest ridge cell, plus a moisture
 * field spread from river cells. Mutates the heightmap in basins (lake nudge).
 */
export function carveRivers(heightmap: Float32Array, rng: Rng): HydrologyResult {
  const H = heightmap;
  const rivers: [number, number][][] = [];
  const guardMax = Math.round(400 * CELL_SCALE);

  let best = -1;
  let bi = 0;
  let bj = 0;
  const margin = Math.round(6 * CELL_SCALE);
  for (let j = margin; j < GRID - margin; j++) {
    for (let i = margin; i < GRID - margin; i++) {
      if (H[hidx(i, j)] > best) {
        best = H[hidx(i, j)];
        bi = i;
        bj = j;
      }
    }
  }

  function carve(si: number, sj: number): [number, number][] {
    let i = si;
    let j = sj;
    const path: [number, number][] = [];
    let guard = 0;
    while (guard++ < guardMax) {
      path.push([i, j]);
      const h = H[hidx(i, j)];
      if (h < SEA_LEVEL + 0.005) break;
      let lo = h;
      let ni = i;
      let nj = j;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const a = clamp(i + di, 0, GRID - 1);
          const b = clamp(j + dj, 0, GRID - 1);
          if (H[hidx(a, b)] < lo) {
            lo = H[hidx(a, b)];
            ni = a;
            nj = b;
          }
        }
      }
      if (ni === i && nj === j) {
        // basin → lake; nudge downslope by lowering
        H[hidx(i, j)] -= 0.004;
        if (guard > guardMax - 20) break;
        continue;
      }
      i = ni;
      j = nj;
    }
    return path;
  }

  const main = carve(bi, bj);
  rivers.push(main);
  const tribOffsets: [number, number][] = [
    [8, 4],
    [-6, 7],
    [5, -8],
    [-7, -5],
  ];
  const tribs = ri(rng, 2, 3);
  for (let t = 0; t < tribs; t++) {
    const start = main[ri(rng, 2, Math.max(3, main.length - 6))];
    const off = tribOffsets[t % 4];
    rivers.push(
      carve(
        clamp(start[0] + Math.round(off[0] * CELL_SCALE), 2, GRID - 3),
        clamp(start[1] + Math.round(off[1] * CELL_SCALE), 2, GRID - 3),
      ),
    );
  }

  const isRiver = new Uint8Array(GRID * GRID);
  for (const r of rivers) for (const [i, j] of r) isRiver[hidx(i, j)] = 1;
  const riverDist = new Float32Array(GRID * GRID);
  for (let k = 0; k < GRID * GRID; k++) riverDist[k] = isRiver[k] ? 0.5 : 0;
  // one blur pass to spread moisture near water
  const blurR = Math.max(2, Math.round(2 * CELL_SCALE));
  const tmp = new Float32Array(riverDist.length);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      let s = 0;
      let n = 0;
      for (let dj = -blurR; dj <= blurR; dj++) {
        for (let di = -blurR; di <= blurR; di++) {
          const a = clamp(i + di, 0, GRID - 1);
          const b = clamp(j + dj, 0, GRID - 1);
          s += riverDist[hidx(a, b)];
          n++;
        }
      }
      tmp[hidx(i, j)] = (s / n) * 1.4;
    }
  }

  return { rivers, riverDist: tmp, isRiver };
}
