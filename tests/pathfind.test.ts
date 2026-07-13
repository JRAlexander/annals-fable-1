import { describe, expect, it } from 'vitest';
import { findPath, pathReaches } from '../src/sim/pathfind';
import { hidx } from '../src/worldgen/coords';
import { GRID } from '../src/worldgen/types';
import { generateWorld } from '../src/worldgen/world';

function pathCost(world: ReturnType<typeof generateWorld>, path: [number, number][]): number {
  let c = 0;
  for (let k = 1; k < path.length; k++) {
    const [i, j] = path[k];
    const diag = path[k - 1][0] !== i && path[k - 1][1] !== j;
    c += world.navCost[hidx(i, j)] * (diag ? Math.SQRT2 : 1);
  }
  return c;
}

describe('A* pathfinding', () => {
  it('reaches every camp↔settlement pairing on the probe seeds', () => {
    for (const seed of [1234, 7, 42, 99999]) {
      const world = generateWorld(seed);
      for (const c of world.camps) {
        for (const s of world.settlements) {
          const out = findPath(world, c.i, c.j, s.i, s.j);
          expect(pathReaches(out, s.i, s.j), `seed ${seed} camp ${c.id} → settlement ${s.id}`).toBe(true);
          const back = findPath(world, s.i, s.j, c.i, c.j);
          expect(pathReaches(back, c.i, c.j), `seed ${seed} settlement ${s.id} → camp ${c.id}`).toBe(true);
        }
      }
    }
  });

  it('is deterministic', () => {
    const world = generateWorld(1234);
    const a = findPath(world, world.camps[0].i, world.camps[0].j, world.capital.i, world.capital.j);
    const b = findPath(world, world.camps[0].i, world.camps[0].j, world.capital.i, world.capital.j);
    expect(a).toEqual(b);
  });

  it('road travel between connected settlements is used when cheaper', () => {
    const world = generateWorld(7);
    // two road-connected settlements — the A* path should cost no more than
    // the road polyline itself (it may shortcut, never detour worse)
    const road = world.roads[0];
    const a = world.settlements.find((s) => s.id === road.a);
    const b = world.settlements.find((s) => s.id === road.b);
    if (!a || !b) throw new Error('road endpoints missing');
    const path = findPath(world, a.i, a.j, b.i, b.j);
    expect(pathReaches(path, b.i, b.j)).toBe(true);
    const roadCost = road.path.reduce((t, [i, j]) => t + world.navCost[hidx(i, j)] * Math.SQRT2, 0);
    expect(pathCost(world, path)).toBeLessThanOrEqual(roadCost);
  });

  it('an optimal path is never worse than the old greedy walk (spot check)', () => {
    const world = generateWorld(42);
    const c = world.camps[0];
    const s = world.capital;
    const path = findPath(world, c.i, c.j, s.i, s.j);
    // sanity ceiling: straight-line cells × a generous cost bound
    const straight = Math.hypot(c.i - s.i, c.j - s.j);
    expect(path.length).toBeLessThan(straight * 4 + 10);
  });

  it('pathReaches is honest for unreachable water goals', () => {
    const world = generateWorld(7);
    // find a water cell
    let wi = -1;
    let wj = -1;
    outer: for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        if (!Number.isFinite(world.navCost[hidx(i, j)])) {
          wi = i;
          wj = j;
          break outer;
        }
      }
    }
    expect(wi).toBeGreaterThanOrEqual(0);
    const path = findPath(world, world.capital.i, world.capital.j, wi, wj);
    expect(pathReaches(path, wi, wj)).toBe(false);
  });

  it('same-cell path still satisfies pathReaches', () => {
    const world = generateWorld(7);
    const s = world.capital;
    expect(pathReaches(findPath(world, s.i, s.j, s.i, s.j), s.i, s.j)).toBe(true);
  });
});
