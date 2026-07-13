import { clamp } from '../core/math';
import { hidx } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { CELL_SCALE, GRID } from '../worldgen/types';

/**
 * Deterministic greedy walk over the navgrid (roads are fast lanes, water is
 * impassable). Same shape as worldgen's road router but rng-free — army paths
 * must be identical on every client. Good enough until A* lands with the RTS.
 */
export function findPath(
  world: WorldData,
  fromI: number,
  fromJ: number,
  toI: number,
  toJ: number,
): [number, number][] {
  const path: [number, number][] = [[fromI, fromJ]];
  let i = fromI;
  let j = fromJ;
  let guard = 0;
  const guardMax = Math.round(800 * CELL_SCALE);
  while (guard++ < guardMax) {
    if (Math.abs(i - toI) <= 1 && Math.abs(j - toJ) <= 1) {
      path.push([toI, toJ]);
      break;
    }
    let bestC = Number.POSITIVE_INFINITY;
    let ni = i;
    let nj = j;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = clamp(i + di, 0, GRID - 1);
        const b = clamp(j + dj, 0, GRID - 1);
        const nav = world.navCost[hidx(a, b)];
        if (!Number.isFinite(nav)) continue;
        const c = Math.hypot(a - toI, b - toJ) + nav * 1.5;
        if (c < bestC) {
          bestC = c;
          ni = a;
          nj = b;
        }
      }
    }
    if (ni === i && nj === j) break; // boxed in — partial path
    i = ni;
    j = nj;
    path.push([i, j]);
  }
  return path;
}
