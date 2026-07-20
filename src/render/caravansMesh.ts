import * as THREE from 'three';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';

/**
 * Trade carts on the road (M17b): each caravan an instanced wagon rolling
 * the route its sim entity walks. A laden cart coming home leans toward
 * gold, so a profitable road reads at a glance. Rival carts hide in the
 * fog like every other foreign unit; picking never sees carts at all.
 */

const CART_COLOR = { player: 0xc98f3a, rival: 0x8a7a66 };
const LADEN_TINT = new THREE.Color(0xe8c84a);

export interface CaravansHandle {
  sync(state: GameState, alpha: number, fog?: { visibleAt(x: number, z: number): boolean }): void;
}

export function createCaravans(scene: THREE.Scene, world: WorldData): CaravansHandle {
  // a low, broad wagon — unmistakably not a villager
  const geo = new THREE.BoxGeometry(5, 3.5, 3);
  geo.translate(0, 1.75, 0);

  let mesh: THREE.InstancedMesh | null = null;
  let cap = 0;

  const ensure = (need: number) => {
    if (mesh && need <= cap) return;
    if (mesh) scene.remove(mesh);
    cap = Math.max(16, need * 2);
    mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), cap);
    mesh.name = 'caravans';
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    scene.add(mesh);
  };

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  const _c = new THREE.Color();

  return {
    sync(state, alpha, fog) {
      ensure(state.caravans.length);
      if (!mesh) return;
      let i = 0;
      for (const c of state.caravans) {
        const owner = state.settlements[c.home]?.ownerRealm ?? 0;
        const x = c.prevX + (c.x - c.prevX) * alpha;
        const z = c.prevZ + (c.z - c.prevZ) * alpha;
        if (fog && owner !== 0 && !fog.visibleAt(x, z)) continue; // foreign commerce keeps its secrets
        _v.set(x, terrainHeight(world.heightmap, x, z), z);
        _q.identity();
        _m.compose(_v, _q, _s);
        mesh.setMatrixAt(i, _m);
        _c.set(owner === 0 ? CART_COLOR.player : CART_COLOR.rival);
        if (c.laden) _c.lerp(LADEN_TINT, 0.5); // gold rides home
        mesh.setColorAt(i, _c);
        i++;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
