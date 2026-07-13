import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/rng';
import { cellPos, hidx, terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { Biome, GRID, WORLD_SIZE } from '../worldgen/types';

function colorGeo(g: THREE.BufferGeometry, col: number): THREE.BufferGeometry {
  const c = new THREE.Color(col);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/**
 * Decorative forest cover on forest biomes. Uses its own seeded stream (not a
 * sim stream) — purely visual, still deterministic per seed.
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
  if (!pts.length) return group;

  const mkTrunk = () => {
    const t = new THREE.CylinderGeometry(0.5, 0.7, 4, 5);
    t.translate(0, 2, 0);
    return colorGeo(t, 0x5a4432);
  };
  const can = new THREE.ConeGeometry(3.4, 8, 6);
  can.translate(0, 8, 0);
  colorGeo(can, 0x2f5a34);
  const canP = new THREE.ConeGeometry(2.6, 9, 6);
  canP.translate(0, 8.5, 0);
  colorGeo(canP, 0x2a4a3a);
  const decid = mergeGeometries([mkTrunk(), can], false);
  const pine = mergeGeometries([mkTrunk(), canP], false);
  decid.computeVertexNormals();
  pine.computeVertexNormals();

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  for (const [geo, wantPine] of [
    [decid, false],
    [pine, true],
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
  return group;
}
