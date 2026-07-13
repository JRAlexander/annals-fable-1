import * as THREE from 'three';
import { cellPos, terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { MAX_HEIGHT, SEA_LEVEL } from '../worldgen/types';

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

export function buildRoadsMesh(world: WorldData): THREE.Group {
  const group = new THREE.Group();
  group.name = 'roads';
  const positions: number[] = [];
  const indices: number[] = [];
  let vc = 0;
  for (const road of world.roads) {
    const p = road.path;
    for (let n = 0; n < p.length - 1; n++) {
      const a = cellPos(p[n][0], p[n][1]);
      const b = cellPos(p[n + 1][0], p[n + 1][1]);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const wdt = 3.2;
      const ya = terrainHeight(world.heightmap, a.x, a.z) + 0.6;
      const yb = terrainHeight(world.heightmap, b.x, b.z) + 0.6;
      positions.push(
        a.x + nx * wdt,
        ya,
        a.z + nz * wdt,
        a.x - nx * wdt,
        ya,
        a.z - nz * wdt,
        b.x + nx * wdt,
        yb,
        b.z + nz * wdt,
        b.x - nx * wdt,
        yb,
        b.z - nz * wdt,
      );
      indices.push(vc, vc + 1, vc + 2, vc + 1, vc + 3, vc + 2);
      vc += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x8a7355 })));

  // bridges: small deck boxes at water crossings
  const bpos: { x: number; z: number }[] = [];
  for (const road of world.roads) for (const [i, j] of road.bridges) bpos.push(cellPos(i, j));
  if (bpos.length) {
    const bg = new THREE.BoxGeometry(8, 1.4, 10);
    colorGeo(bg, 0x6a4a30);
    const im = new THREE.InstancedMesh(
      bg,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      bpos.length,
    );
    const _m = new THREE.Matrix4();
    const _v = new THREE.Vector3();
    bpos.forEach((p, k) => {
      _v.set(p.x, SEA_LEVEL * MAX_HEIGHT + 2.5, p.z);
      _m.setPosition(_v);
      im.setMatrixAt(k, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }
  return group;
}
