import * as THREE from 'three';
import { clamp } from '../core/math';
import { hidx, terrainHeight, worldToCell } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { Biome, GRID, MAX_HEIGHT, WORLD_SIZE } from '../worldgen/types';

/** ANNALS biome palette (spring, no snow — seasons return with the sim). */
export function biomeColor(b: number, h: number): THREE.Color {
  const c = new THREE.Color();
  switch (b) {
    case Biome.Meadow:
      c.setHSL(0.28, 0.45, 0.42);
      break;
    case Biome.Farmland:
      c.setHSL(0.22, 0.5, 0.45);
      break;
    case Biome.Deciduous:
      c.setHSL(0.33, 0.5, 0.3);
      break;
    case Biome.Pine:
      c.setHSL(0.42, 0.35, 0.26);
      break;
    case Biome.Rock:
      c.setHSL(0.08, 0.12, 0.5);
      break;
    case Biome.Marsh:
      c.setHSL(0.18, 0.3, 0.35);
      break;
    default:
      c.setHSL(0.57, 0.5, 0.32); // underwater terrain
  }
  c.offsetHSL(0, 0, clamp(h / MAX_HEIGHT - 0.4, -1, 1) * 0.12);
  return c;
}

export function buildTerrainMesh(world: WorldData): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID - 1, GRID - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    const cell = worldToCell(x, z);
    const h = terrainHeight(world.heightmap, x, z);
    pos.setY(k, h);
    const b = world.biome[hidx(cell.i, cell.j)];
    const cc = biomeColor(b, h);
    col[k * 3] = cc.r;
    col[k * 3 + 1] = cc.g;
    col[k * 3 + 2] = cc.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'terrain';
  return mesh;
}
