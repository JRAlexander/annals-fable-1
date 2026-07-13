import { hidx } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { GRID } from '../worldgen/types';

/**
 * Deterministic A* over the navgrid (roads are 0.5-cost fast lanes, water is
 * impassable). 8-connected; entering a cell costs its navCost (×√2 diagonal);
 * the heuristic is octile distance × 0.5 (the road cost — the cheapest cell
 * that exists), so it is admissible and paths are optimal. Ties break on
 * (f, then h, then insertion order) so every client walks the same road.
 * Unreachable goals yield the path to the closest approach — callers check
 * with `pathReaches`.
 */

const SQRT2 = Math.SQRT2;
const MIN_CELL_COST = 0.5; // roads — see worldgen/navgrid.ts

/** Binary min-heap keyed on (f, h, seq). */
class Heap {
  private f: number[] = [];
  private h: number[] = [];
  private seq: number[] = [];
  private node: number[] = [];
  private n = 0;
  private counter = 0;

  get size(): number {
    return this.n;
  }

  private less(a: number, b: number): boolean {
    if (this.f[a] !== this.f[b]) return this.f[a] < this.f[b];
    if (this.h[a] !== this.h[b]) return this.h[a] < this.h[b];
    return this.seq[a] < this.seq[b];
  }

  private swap(a: number, b: number): void {
    [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    [this.h[a], this.h[b]] = [this.h[b], this.h[a]];
    [this.seq[a], this.seq[b]] = [this.seq[b], this.seq[a]];
    [this.node[a], this.node[b]] = [this.node[b], this.node[a]];
  }

  push(node: number, f: number, h: number): void {
    let i = this.n++;
    this.f[i] = f;
    this.h[i] = h;
    this.seq[i] = this.counter++;
    this.node[i] = node;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.node[0];
    this.n--;
    if (this.n > 0) {
      this.f[0] = this.f[this.n];
      this.h[0] = this.h[this.n];
      this.seq[0] = this.seq[this.n];
      this.node[0] = this.node[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

function octile(ai: number, aj: number, bi: number, bj: number): number {
  const dx = Math.abs(ai - bi);
  const dy = Math.abs(aj - bj);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

export function findPath(
  world: WorldData,
  fromI: number,
  fromJ: number,
  toI: number,
  toJ: number,
): [number, number][] {
  const nav = world.navCost;
  const start = hidx(fromI, fromJ);
  const goal = hidx(toI, toJ);
  if (start === goal)
    return [
      [fromI, fromJ],
      [toI, toJ],
    ]; // length-2 so pathReaches holds

  const g = new Float64Array(GRID * GRID).fill(Number.POSITIVE_INFINITY);
  const came = new Int32Array(GRID * GRID).fill(-1);
  const closed = new Uint8Array(GRID * GRID);
  const open = new Heap();

  g[start] = 0;
  open.push(start, octile(fromI, fromJ, toI, toJ) * MIN_CELL_COST, 0);

  // closest approach, for honest partial paths to unreachable goals
  let bestNode = start;
  let bestH = octile(fromI, fromJ, toI, toJ);

  let found = false;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      found = true;
      break;
    }
    const ci = cur % GRID;
    const cj = (cur / GRID) | 0;
    const hCur = octile(ci, cj, toI, toJ);
    if (hCur < bestH) {
      bestH = hCur;
      bestNode = cur;
    }
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue;
        const nk = hidx(ni, nj);
        if (closed[nk]) continue;
        const step = nav[nk];
        if (!Number.isFinite(step)) continue;
        const tentative = g[cur] + step * (di && dj ? SQRT2 : 1);
        if (tentative < g[nk]) {
          g[nk] = tentative;
          came[nk] = cur;
          const h = octile(ni, nj, toI, toJ) * MIN_CELL_COST;
          open.push(nk, tentative + h, h);
        }
      }
    }
  }

  const end = found ? goal : bestNode;
  const path: [number, number][] = [];
  for (let k = end; k !== -1; k = came[k]) {
    path.push([k % GRID, (k / GRID) | 0]);
    if (k === start) break;
  }
  path.reverse();
  return path;
}

/** True when a path actually ends at (toI, toJ) rather than being cut short. */
export function pathReaches(path: [number, number][], toI: number, toJ: number): boolean {
  const last = path[path.length - 1];
  return path.length >= 2 && last[0] === toI && last[1] === toJ;
}
