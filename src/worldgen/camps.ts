import type { Rng } from '../core/rng';
import { ri } from '../core/rng';
import { cellPos, hidx } from './coords';
import type { SettlementSite } from './types';
import { Biome, CELL_SCALE, GRID } from './types';

export interface CampSite {
  id: number;
  i: number;
  j: number;
  x: number;
  z: number;
}

/**
 * Bandit camps: neutral hostile sites, the army targets of M4 (rival realms
 * arrive in M5). Called at the END of generate() so the world stream's draw
 * prefix — and therefore ANNALS seed parity for terrain/settlements — is
 * untouched.
 */
export function siteCamps(
  heightmap: Float32Array,
  biome: Uint8Array,
  settlements: SettlementSite[],
  rng: Rng,
): CampSite[] {
  const minSep = 18 * CELL_SCALE;
  const margin = Math.round(6 * CELL_SCALE);
  const want = ri(rng, 2, 4);
  const camps: CampSite[] = [];
  // deterministic coarse scan; prefer spots far from civilization, small rng jitter
  const cand: { i: number; j: number; score: number }[] = [];
  for (let j = margin; j < GRID - margin; j += 3) {
    for (let i = margin; i < GRID - margin; i += 3) {
      const b = biome[hidx(i, j)];
      if (b === Biome.Water || b === Biome.Marsh || b === Biome.Rock) continue;
      const nearest = Math.min(...settlements.map((s) => Math.hypot(s.i - i, s.j - j)));
      if (nearest < minSep) continue;
      cand.push({ i, j, score: nearest + rng() * 4 });
    }
  }
  cand.sort((a, b) => b.score - a.score);
  for (const c of cand) {
    if (camps.length >= want) break;
    if (camps.every((o) => Math.hypot(o.i - c.i, o.j - c.j) > minSep * 0.6)) {
      const p = cellPos(c.i, c.j);
      camps.push({ id: camps.length, i: c.i, j: c.j, x: p.x, z: p.z });
    }
  }
  return camps;
}
