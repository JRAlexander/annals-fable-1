import { clamp, lerp } from '../core/math';
import { GRID, MAX_HEIGHT, WORLD_SIZE } from './types';

export function hidx(i: number, j: number): number {
  return j * GRID + i;
}

export function hAt(heightmap: Float32Array, i: number, j: number): number {
  return heightmap[hidx(clamp(i, 0, GRID - 1), clamp(j, 0, GRID - 1))];
}

/** Grid cell → world position (cell center in metres). */
export function cellPos(i: number, j: number): { x: number; z: number } {
  return { x: (i / (GRID - 1) - 0.5) * WORLD_SIZE, z: (j / (GRID - 1) - 0.5) * WORLD_SIZE };
}

export function worldToCell(x: number, z: number): { i: number; j: number } {
  return {
    i: clamp(Math.round((x / WORLD_SIZE + 0.5) * (GRID - 1)), 0, GRID - 1),
    j: clamp(Math.round((z / WORLD_SIZE + 0.5) * (GRID - 1)), 0, GRID - 1),
  };
}

/** Bilinear heightmap sample in metres. */
export function terrainHeight(heightmap: Float32Array, x: number, z: number): number {
  const fi = (x / WORLD_SIZE + 0.5) * (GRID - 1);
  const fj = (z / WORLD_SIZE + 0.5) * (GRID - 1);
  const i = clamp(Math.floor(fi), 0, GRID - 2);
  const j = clamp(Math.floor(fj), 0, GRID - 2);
  const tx = fi - i;
  const tz = fj - j;
  const h00 = heightmap[hidx(i, j)];
  const h10 = heightmap[hidx(i + 1, j)];
  const h01 = heightmap[hidx(i, j + 1)];
  const h11 = heightmap[hidx(i + 1, j + 1)];
  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz) * MAX_HEIGHT;
}
