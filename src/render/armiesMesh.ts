import * as THREE from 'three';
import { totalUnits } from '../sim/combat';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { archGeo } from './buildingsMesh';

const PHASE_COLOR: Record<string, number> = {
  idle: 0xc9a227,
  marching: 0xe0b83a,
  returning: 0xb0a06a,
  fighting: 0xc94a3a,
};

/**
 * Armies as banner-cones (size tracks strength, color tracks phase) and camps
 * as dark tents that vanish when cleared. Army positions interpolate between
 * the last two sim ticks via the loop's alpha — the first use of the hook.
 */
export function createArmies(
  scene: THREE.Scene,
  world: WorldData,
): { sync(state: GameState, alpha: number): void } {
  // camp tents: built once, hidden when cleared
  const tentGeo = archGeo('longhouse');
  const tents = new THREE.InstancedMesh(
    tentGeo,
    new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x554433 }),
    world.camps.length,
  );
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  world.camps.forEach((c, k) => {
    const y = terrainHeight(world.heightmap, c.x, c.z);
    _v.set(c.x, y, c.z);
    _s.set(1.8, 1.4, 1.8);
    _q.identity();
    _m.compose(_v, _q, _s);
    tents.setMatrixAt(k, _m);
  });
  tents.instanceMatrix.needsUpdate = true;
  scene.add(tents);

  const coneGeo = new THREE.ConeGeometry(8, 26, 6);
  coneGeo.translate(0, 13, 0);
  let cones: THREE.InstancedMesh | null = null;
  let capacity = 0;
  const clearedShown = new Set<number>();

  return {
    sync(state, alpha) {
      // hide cleared camps (once)
      for (const camp of state.camps) {
        if (camp.cleared && !clearedShown.has(camp.id)) {
          clearedShown.add(camp.id);
          const c = world.camps[camp.id];
          _v.set(c.x, -100, c.z);
          _s.set(0.001, 0.001, 0.001);
          _q.identity();
          _m.compose(_v, _q, _s);
          tents.setMatrixAt(camp.id, _m);
          tents.instanceMatrix.needsUpdate = true;
        }
      }

      const n = state.armies.length;
      if (!cones || n > capacity) {
        if (cones) scene.remove(cones);
        capacity = Math.max(8, n * 2);
        cones = new THREE.InstancedMesh(
          coneGeo,
          new THREE.MeshLambertMaterial({ color: 0xc9a227 }),
          capacity,
        );
        scene.add(cones);
      }
      state.armies.forEach((a, k) => {
        const x = a.prevX + (a.x - a.prevX) * alpha;
        const z = a.prevZ + (a.z - a.prevZ) * alpha;
        const y = terrainHeight(world.heightmap, x, z);
        const sc = 0.8 + Math.sqrt(totalUnits(a.units)) * 0.12;
        _v.set(x, y, z);
        _s.set(sc, sc, sc);
        _q.identity();
        _m.compose(_v, _q, _s);
        cones?.setMatrixAt(k, _m);
        cones?.setColorAt(k, new THREE.Color(PHASE_COLOR[a.phase] ?? 0xc9a227));
      });
      if (cones) {
        cones.count = n;
        cones.instanceMatrix.needsUpdate = true;
        if (cones.instanceColor) cones.instanceColor.needsUpdate = true;
      }
    },
  };
}
