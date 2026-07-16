import * as THREE from 'three';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';

/**
 * The working population, visible at last (M12b): every villager a small
 * instanced figure streaming between workplace and dropoff. Loaded walkers
 * tint toward their cargo, so the supply lanes read at a glance. Hostile
 * villagers hide in the fog like soldiers do; picking never sees them.
 */

/** Idle/empty-handed villagers by owner. */
const VILLAGER_COLOR = { player: 0xe6d9b8, rival: 0xb08a7a, wild: 0x6a6a6a };
/** Carry tints: the basket shows what it holds. */
const CARGO_COLOR: Record<string, THREE.Color> = {
  farm: new THREE.Color(0xd9c34a),
  wood: new THREE.Color(0x8a6a3f),
  stone: new THREE.Color(0x9a9384),
  gold: new THREE.Color(0xe0b83a),
};

export interface VillagersHandle {
  sync(state: GameState, alpha: number, fog?: { visibleAt(x: number, z: number): boolean }): void;
}

export function createVillagers(scene: THREE.Scene, world: WorldData): VillagersHandle {
  const geo = new THREE.BoxGeometry(2.2, 5, 2.2);
  geo.translate(0, 2.5, 0);

  let mesh: THREE.InstancedMesh | null = null;
  let cap = 0;

  const ensure = (need: number) => {
    if (mesh && need <= cap) return;
    if (mesh) scene.remove(mesh);
    cap = Math.max(64, need * 2);
    mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), cap);
    mesh.name = 'villagers';
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
      ensure(state.villagers.length);
      if (!mesh) return;
      let i = 0;
      for (const v of state.villagers) {
        const owner = state.settlements[v.settlement]?.ownerRealm ?? 0;
        const x = v.prevX + (v.x - v.prevX) * alpha;
        const z = v.prevZ + (v.z - v.prevZ) * alpha;
        if (fog && owner !== 0 && !fog.visibleAt(x, z)) continue; // unseen hands stay unseen
        _v.set(x, terrainHeight(world.heightmap, x, z), z);
        _q.identity();
        _m.compose(_v, _q, _s);
        mesh.setMatrixAt(i, _m);
        const base =
          owner === 0 ? VILLAGER_COLOR.player : owner < 0 ? VILLAGER_COLOR.wild : VILLAGER_COLOR.rival;
        _c.set(base);
        const cargo = v.carry > 0 && v.job !== 'idle' ? CARGO_COLOR[v.job] : undefined;
        if (cargo) _c.lerp(cargo, 0.55); // a loaded walker leans toward its cargo's color
        mesh.setColorAt(i, _c);
        i++;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
