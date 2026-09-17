import * as THREE from 'three';
import { makeRng } from '../core/rng';
import { cellPos, hidx, terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { Biome, GRID, WORLD_SIZE } from '../worldgen/types';
import { rockGeo, treeGeo } from './terrainPalette';

/**
 * Decorative forest cover on forest biomes, and rock outcrops on the high
 * ground (M18b). Uses its own seeded stream (not a sim stream) — purely
 * visual, still deterministic per seed.
 */
export function buildTrees(world: WorldData): THREE.Group {
  const rng = makeRng(world.seed + 777);
  const group = new THREE.Group();
  group.name = 'trees';
  // density tuned for a 96 grid; rescale so total tree count stays similar
  const densityScale = (96 / GRID) ** 2;
  const pts: { x: number; z: number; pine: boolean; s: number }[] = [];
  for (let j = 1; j < GRID - 1; j++) {
    for (let i = 1; i < GRID - 1; i++) {
      const b = world.biome[hidx(i, j)];
      if (b !== Biome.Deciduous && b !== Biome.Pine) continue;
      const density = (b === Biome.Deciduous ? 0.5 : 0.35) * densityScale;
      if (rng() < density) {
        const p = cellPos(i, j);
        const jx = ((rng() - 0.5) * WORLD_SIZE) / GRID;
        const jz = ((rng() - 0.5) * WORLD_SIZE) / GRID;
        const x = p.x + jx;
        const z = p.z + jz;
        if (world.settlements.some((s) => Math.hypot(s.x - x, s.z - z) < s.radius * 0.85)) continue;
        pts.push({ x, z, pine: b === Biome.Pine, s: 0.7 + rng() * 0.8 });
      }
    }
  }
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  for (const [geo, wantPine] of [
    [treeGeo('deciduous'), false],
    [treeGeo('pine'), true],
  ] as const) {
    const sub = pts.filter((p) => p.pine === wantPine);
    if (!sub.length) continue;
    const im = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      sub.length,
    );
    sub.forEach((p, k) => {
      const y = terrainHeight(world.heightmap, p.x, p.z);
      _v.set(p.x, y, p.z);
      _e.set(0, rng() * 6.28, 0);
      _q.setFromEuler(_e);
      _s.set(p.s, p.s * (0.8 + rng() * 0.5), p.s);
      _m.compose(_v, _q, _s);
      im.setMatrixAt(k, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }

  // rock outcrops: texture for the bare heights between grass and snow
  const rocks: { x: number; z: number; s: number; r: number }[] = [];
  for (let j = 1; j < GRID - 1; j++) {
    for (let i = 1; i < GRID - 1; i++) {
      if (world.biome[hidx(i, j)] !== Biome.Rock) continue;
      if (rng() >= 0.22 * densityScale) continue;
      const p = cellPos(i, j);
      const x = p.x + ((rng() - 0.5) * WORLD_SIZE) / GRID;
      const z = p.z + ((rng() - 0.5) * WORLD_SIZE) / GRID;
      if (world.settlements.some((s) => Math.hypot(s.x - x, s.z - z) < s.radius * 0.85)) continue;
      rocks.push({ x, z, s: 0.7 + rng() * 1.1, r: rng() * 6.28 });
    }
  }
  if (rocks.length) {
    const im = new THREE.InstancedMesh(
      rockGeo(),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      rocks.length,
    );
    rocks.forEach((p, k) => {
      _v.set(p.x, terrainHeight(world.heightmap, p.x, p.z), p.z);
      _e.set(0, p.r, 0);
      _q.setFromEuler(_e);
      _s.set(p.s, p.s, p.s);
      _m.compose(_v, _q, _s);
      im.setMatrixAt(k, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }
  return group;
}
