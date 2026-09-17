import * as THREE from 'three';
import { hidx, terrainHeight, worldToCell } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { GRID, MAX_HEIGHT, WORLD_SIZE } from '../worldgen/types';
import { type PaletteBiome, biomeColor as paletteColor } from './terrainPalette';

/** Numeric BiomeId → the palette's named swatches (M18b), in enum order. */
const BIOME_NAME: readonly PaletteBiome[] = [
  'Meadow',
  'Farmland',
  'Deciduous',
  'Pine',
  'Rock',
  'Marsh',
  'Water',
];

/** Kept numeric-signature shim — the minimap paints with the same brush. */
export function biomeColor(b: number, h: number): THREE.Color {
  return paletteColor(BIOME_NAME[b] ?? 'Water', h / MAX_HEIGHT);
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
