import * as THREE from 'three';
import { Fog } from '../app/visibility';
import { hidx, terrainHeight, worldToCell } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { GRID, WORLD_SIZE } from '../worldgen/types';

const ALPHA_UNEXPLORED = 0.92;
const ALPHA_EXPLORED = 0.45;
const ALPHA_VISIBLE = 0;

/**
 * The shroud (M7b): a second terrain-shaped lattice floating just above the
 * ground, black with per-vertex alpha driven by the fog mask — so the fog
 * drapes over hills instead of clipping through them. Presentation only.
 */
export function createFog(scene: THREE.Scene, world: WorldData): { update(fog: Uint8Array): void } {
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID - 1, GRID - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const alpha = new Float32Array(pos.count).fill(ALPHA_UNEXPLORED);
  // remember each vertex's fog cell once — update() then only touches alphas
  const cellOf = new Int32Array(pos.count);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    pos.setY(k, terrainHeight(world.heightmap, x, z) + 3);
    const { i, j } = worldToCell(x, z);
    cellOf[k] = hidx(i, j);
  }
  geo.setAttribute('aFog', new THREE.BufferAttribute(alpha, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: `
      attribute float aFog;
      varying float vFog;
      void main() {
        vFog = aFog;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vFog;
      void main() {
        if (vFog < 0.01) discard;
        gl_FragColor = vec4(0.03, 0.035, 0.05, vFog);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fog';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5; // above terrain and water, below nothing that matters
  mesh.raycast = () => {}; // clicks pass through the shroud
  scene.add(mesh);

  return {
    update(fog: Uint8Array): void {
      for (let k = 0; k < alpha.length; k++) {
        const f = fog[cellOf[k]];
        alpha[k] = f === Fog.Visible ? ALPHA_VISIBLE : f === Fog.Explored ? ALPHA_EXPLORED : ALPHA_UNEXPLORED;
      }
      (geo.attributes.aFog as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}
