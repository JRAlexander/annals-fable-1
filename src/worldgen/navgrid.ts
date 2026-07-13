import { hAt, hidx } from './coords';
import type { Road } from './types';
import { Biome, CELL_SCALE, GRID } from './types';

/**
 * Per-cell movement cost derived from terrain, for unit pathfinding (A-star /
 * flow fields when the RTS layer lands). Built at worldgen time so the artifact and
 * its invariants exist from M0. Infinity = impassable.
 */
export function buildNavGrid(heightmap: Float32Array, biome: Uint8Array, roads: Road[]): Float32Array {
  const cost = new Float32Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = hidx(i, j);
      const b = biome[k];
      if (b === Biome.Water) {
        cost[k] = Number.POSITIVE_INFINITY;
        continue;
      }
      const hx = Math.abs(hAt(heightmap, i + 1, j) - hAt(heightmap, i - 1, j));
      const hz = Math.abs(hAt(heightmap, i, j + 1) - hAt(heightmap, i, j - 1));
      let c = 1 + (hx + hz) * 30 * CELL_SCALE;
      if (b === Biome.Deciduous || b === Biome.Pine) c += 0.8;
      if (b === Biome.Rock) c += 2.5;
      if (b === Biome.Marsh) c += 1.5;
      cost[k] = c;
    }
  }
  // roads are fast lanes (and bridges make their water cells passable)
  for (const r of roads) {
    for (const [i, j] of r.path) cost[hidx(i, j)] = 0.5;
  }
  return cost;
}
