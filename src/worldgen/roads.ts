import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import { hAt, hidx } from './coords';
import type { Road, SettlementSite } from './types';
import { Biome, CELL_SCALE, GRID } from './types';

/** MST over the settlement graph plus a couple of loop edges, each routed greedily. */
export function buildRoads(
  heightmap: Float32Array,
  biome: Uint8Array,
  settlements: SettlementSite[],
  rng: Rng,
): Road[] {
  const S = settlements;
  const edges: [number, number, number][] = [];
  for (let a = 0; a < S.length; a++) {
    for (let b = a + 1; b < S.length; b++) {
      edges.push([a, b, Math.hypot(S[a].i - S[b].i, S[a].j - S[b].j)]);
    }
  }
  edges.sort((x, y) => x[2] - y[2]);
  const par = S.map((_, i) => i);
  const find = (x: number): number => {
    if (par[x] === x) return x;
    par[x] = find(par[x]);
    return par[x];
  };
  const used: [number, number][] = [];
  for (const [a, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      par[ra] = rb;
      used.push([a, b]);
    }
  }
  for (const [a, b, d] of edges) {
    if (used.length >= S.length + 2) break;
    if (d < 26 * CELL_SCALE && !used.some((e) => e[0] === a && e[1] === b)) used.push([a, b]);
  }

  const roads: Road[] = [];
  for (const [a, b] of used) {
    const road = routeRoad(heightmap, biome, S[a], S[b], rng);
    if (road) roads.push({ a, b, path: road.path, bridges: road.bridges });
  }
  return roads;
}

/** Greedy least-cost walk with slope/water/forest penalties. */
function routeRoad(
  heightmap: Float32Array,
  biome: Uint8Array,
  A: SettlementSite,
  B: SettlementSite,
  rng: Rng,
): { path: [number, number][]; bridges: [number, number][] } | null {
  const path: [number, number][] = [[A.i, A.j]];
  const bridges: [number, number][] = [];
  let i = A.i;
  let j = A.j;
  let guard = 0;
  const guardMax = Math.round(600 * CELL_SCALE);
  while (guard++ < guardMax) {
    if (Math.abs(i - B.i) <= 1 && Math.abs(j - B.j) <= 1) {
      path.push([B.i, B.j]);
      break;
    }
    let bestC = 1e9;
    let ni = i;
    let nj = j;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = clamp(i + di, 0, GRID - 1);
        const b = clamp(j + dj, 0, GRID - 1);
        const step = Math.hypot(a - B.i, b - B.j); // heuristic toward goal
        const dh = hAt(heightmap, a, b) - hAt(heightmap, i, j);
        // slope penalties rescaled like buildable(): neighbor deltas shrink on finer grids
        let c = step + Math.abs(dh) * 40 * CELL_SCALE + dh * 20 * CELL_SCALE;
        const bb = biome[hidx(a, b)];
        if (bb === Biome.Water) c += 6;
        if (bb === Biome.Deciduous || bb === Biome.Pine) c += 1.2;
        if (bb === Biome.Rock) c += 4;
        c += (rng() - 0.5) * 0.3;
        if (c < bestC) {
          bestC = c;
          ni = a;
          nj = b;
        }
      }
    }
    if (ni === i && nj === j) break;
    if (biome[hidx(ni, nj)] === Biome.Water) bridges.push([ni, nj]);
    i = ni;
    j = nj;
    path.push([i, j]);
  }
  return { path, bridges };
}
