import { placeName } from '../content/names';
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { cellPos, hAt, hidx } from './coords';
import type { SettlementSite, SettlementTier } from './types';
import { Biome, CELL_SCALE, GRID, SEA_LEVEL } from './types';

interface SiteFields {
  heightmap: Float32Array;
  biome: Uint8Array;
  riverDist: Float32Array;
  coastEdge: number;
}

/** Site desirability: flat, near water, near resources; -1 = unbuildable. */
export function buildable(f: SiteFields, i: number, j: number): number {
  const h = f.heightmap[hidx(i, j)];
  if (h < SEA_LEVEL + 0.01 || h > 0.72) return -1;
  const hx = Math.abs(hAt(f.heightmap, i + 1, j) - hAt(f.heightmap, i - 1, j));
  const hz = Math.abs(hAt(f.heightmap, i, j + 1) - hAt(f.heightmap, i, j - 1));
  const slope = hx + hz;
  // slope is a neighbor delta, so it shrinks as the grid gets finer — rescale
  let score = 1 - slope * 14 * CELL_SCALE;
  score += f.riverDist[hidx(i, j)] * 1.5;
  if (f.coastEdge >= 0) {
    const e = f.coastEdge === 0 ? i : f.coastEdge === 1 ? GRID - 1 - i : f.coastEdge === 2 ? j : GRID - 1 - j;
    if (e < 8 * CELL_SCALE) score += 0.6;
  }
  let res = 0;
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const b = f.biome[hidx(clamp(i + di, 0, GRID - 1), clamp(j + dj, 0, GRID - 1))];
      if (b === Biome.Farmland) res += 0.05;
      if (b === Biome.Deciduous || b === Biome.Rock) res += 0.03;
    }
  }
  score += res;
  return score;
}

export function siteSettlements(f: SiteFields, rng: Rng): SettlementSite[] {
  const cand: { i: number; j: number; s: number }[] = [];
  const margin = Math.round(4 * CELL_SCALE);
  for (let j = margin; j < GRID - margin; j += 2) {
    for (let i = margin; i < GRID - margin; i += 2) {
      const s = buildable(f, i, j);
      if (s > 0) cand.push({ i, j, s: s + rng() * 0.15 });
    }
  }
  cand.sort((a, b) => b.s - a.s);
  const chosen: { i: number; j: number }[] = [];
  const minSep = 10 * CELL_SCALE;
  for (const c of cand) {
    if (chosen.every((o) => Math.hypot(o.i - c.i, o.j - c.j) > minSep)) {
      chosen.push(c);
      if (chosen.length >= 9) break;
    }
  }

  const tiers: SettlementTier[] = [
    'capital',
    'town',
    'town',
    'town',
    'village',
    'village',
    'village',
    'village',
    'village',
  ];
  const settlements = chosen.map((c, idx): SettlementSite => {
    const tier = tiers[idx] ?? 'village';
    const p = cellPos(c.i, c.j);
    let isHarbor = false;
    if (f.coastEdge >= 0) {
      const e =
        f.coastEdge === 0
          ? c.i
          : f.coastEdge === 1
            ? GRID - 1 - c.i
            : f.coastEdge === 2
              ? c.j
              : GRID - 1 - c.j;
      if (e < 7 * CELL_SCALE) isHarbor = true;
    }
    return {
      id: idx,
      name: placeName(rng),
      i: c.i,
      j: c.j,
      x: p.x,
      z: p.z,
      tier,
      radius: tier === 'capital' ? 260 : tier === 'town' ? 150 : 70,
      isHarbor,
    };
  });
  if (!settlements.some((s) => s.tier === 'capital') && settlements.length) settlements[0].tier = 'capital';
  return settlements;
}
