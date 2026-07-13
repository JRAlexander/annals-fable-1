import { placeName } from '../content/names';
import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { chance, pick, ri } from '../core/rng';
import { cellPos, hAt, hidx, terrainHeight, worldToCell } from './coords';
import type { DecorArch, SettlementSite, SettlementTier } from './types';
import { Biome, CELL_SCALE, GRID, MAX_HEIGHT, SEA_LEVEL } from './types';

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
    const pop =
      tier === 'capital' ? ri(rng, 2200, 2800) : tier === 'town' ? ri(rng, 400, 1200) : ri(rng, 60, 300);
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
      pop,
      radius: tier === 'capital' ? 260 : tier === 'town' ? 150 : 70,
      walls: tier === 'capital' ? 3 : tier === 'town' && chance(rng, 0.5) ? 2 : 0,
      isHarbor,
      buildings: [],
    };
  });
  if (!settlements.some((s) => s.tier === 'capital') && settlements.length) settlements[0].tier = 'capital';
  return settlements;
}

/**
 * Decorative building scatter (ANNALS' organic district rings) so M0 renders a
 * lived-in world. Replaced by sim-constructed buildings from M2 onward.
 */
export function scatterBuildings(f: SiteFields, s: SettlementSite, rng: Rng): void {
  const cnt =
    s.tier === 'capital' ? ri(rng, 160, 240) : s.tier === 'town' ? ri(rng, 60, 120) : ri(rng, 10, 26);
  for (let n = 0; n < cnt; n++) {
    const ang = rng() * 6.283;
    const rr = Math.sqrt(rng()) * s.radius;
    const bx = s.x + Math.cos(ang) * rr;
    const bz = s.z + Math.sin(ang) * rr;
    const th = terrainHeight(f.heightmap, bx, bz);
    if (th < SEA_LEVEL * MAX_HEIGHT + 2) continue;
    let arch: DecorArch;
    let tier: number;
    const ringT = rr / s.radius;
    if (n === 0 && s.tier === 'capital') {
      arch = 'keep';
    } else if (ringT < 0.18) {
      arch = pick(rng, ['shop', 'tavern', 'shop', 'smithy', 'warehouse'] as const);
    } else if (ringT < 0.5) {
      arch = pick(rng, ['house', 'shop', 'longhouse', 'smithy', 'granary'] as const);
    } else {
      arch = pick(rng, ['house', 'house', 'longhouse', 'mill'] as const);
    }
    if (n === 2 && s.tier !== 'village') arch = 'temple';
    if (arch === 'mill') {
      // mills want water
      const c = worldToCell(bx, bz);
      if (f.riverDist[hidx(c.i, c.j)] < 0.3 && !s.isHarbor) arch = 'house';
    }
    tier =
      s.tier === 'capital' ? ri(rng, 2, 3) : s.tier === 'town' ? ri(rng, 1, 3) : chance(rng, 0.35) ? 2 : 1;
    if (arch === 'keep' || arch === 'temple') tier = Math.max(tier, 2);
    s.buildings.push({
      arch,
      tier,
      x: bx,
      y: th,
      z: bz,
      rot: rng() * 6.283,
      w: 0.6 + rng() * 0.5,
    });
  }
  // walls: ring of segments for walled settlements
  if (s.walls > 0) {
    const segs = Math.floor(s.radius / 9);
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * 6.283;
      const bx = s.x + Math.cos(a) * (s.radius * 0.92);
      const bz = s.z + Math.sin(a) * (s.radius * 0.92);
      const th = terrainHeight(f.heightmap, bx, bz);
      if (th < SEA_LEVEL * MAX_HEIGHT + 1) continue;
      s.buildings.push({ arch: 'wall', tier: s.walls, x: bx, y: th, z: bz, rot: a + 1.57, w: 1 });
    }
  }
}
