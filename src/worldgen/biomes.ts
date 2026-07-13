import { clamp } from '../core/math';
import { makeNoise } from '../core/noise';
import { hidx } from './coords';
import { Biome, GRID, SEA_LEVEL } from './types';

export interface BiomeResult {
  biome: Uint8Array;
  moist: Float32Array;
}

export function classifyBiomes(seed: number, heightmap: Float32Array, riverDist: Float32Array): BiomeResult {
  const nz2 = makeNoise(seed + 29);
  const biome = new Uint8Array(GRID * GRID);
  const moist = new Float32Array(GRID * GRID);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      const h = heightmap[k];
      let m = nz2((i / GRID) * 3 + 5, (j / GRID) * 3 + 2, 4) * 0.5 + 0.5;
      m = clamp(m + riverDist[hidx(i, j)], 0, 1);
      moist[k] = m;
      let b: number;
      if (h < SEA_LEVEL) b = Biome.Water;
      else if (h < SEA_LEVEL + 0.02) b = Biome.Marsh;
      else if (h > 0.78) b = Biome.Rock;
      else if (h > 0.62) b = Biome.Pine;
      else if (m > 0.62) b = Biome.Deciduous;
      else if (m > 0.34) b = Biome.Farmland;
      else b = Biome.Meadow;
      biome[k] = b;
    }
  }
  return { biome, moist };
}
