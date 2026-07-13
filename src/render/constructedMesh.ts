import * as THREE from 'three';
import type { BuildingId } from '../content/schema';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { DecorArch, WorldData } from '../worldgen/types';
import { MAX_HEIGHT, SEA_LEVEL } from '../worldgen/types';
import { archGeo } from './buildingsMesh';

/** Visual stand-ins from the ANNALS arch kit until buildings get bespoke models. */
const BUILDING_ARCH: Record<BuildingId, DecorArch> = {
  house: 'house',
  farm: 'mill',
  lumberCamp: 'longhouse',
  quarry: 'smithy',
  market: 'shop',
  storehouse: 'warehouse',
  temple: 'temple',
  granary: 'granary',
  university: 'tower',
  guildhall: 'tavern',
  keep: 'keep',
};

const GOLDEN_ANGLE = 2.399963;

/**
 * Renders player-constructed buildings in a ring outside each settlement's
 * organic core. Placement is a pure function of (settlement, index) so it is
 * identical on every client and every reload — no rng, no sim coupling.
 */
export function createConstructed(scene: THREE.Scene, world: WorldData): { sync(state: GameState): void } {
  let group: THREE.Group | null = null;
  let lastCount = -1;

  function placement(siteIdx: number, k: number): { x: number; z: number; y: number; rot: number } {
    const site = world.settlements[siteIdx];
    const radius = site.radius * 1.12;
    const angle = site.id * 1.7 + k * GOLDEN_ANGLE;
    // walk outward until we're on dry land (bounded — worlds always have land at sites)
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = site.x + Math.cos(angle) * (radius + attempt * 24);
      const z = site.z + Math.sin(angle) * (radius + attempt * 24);
      const y = terrainHeight(world.heightmap, x, z);
      if (y > SEA_LEVEL * MAX_HEIGHT + 2) return { x, z, y, rot: angle + Math.PI / 2 };
    }
    const y = terrainHeight(world.heightmap, site.x, site.z);
    return { x: site.x, z: site.z, y, rot: 0 };
  }

  return {
    sync(state) {
      let count = 0;
      for (const s of state.settlements) {
        for (const n of Object.values(s.buildings)) count += n ?? 0;
      }
      if (count === lastCount) return;
      lastCount = count;

      if (group) scene.remove(group);
      group = new THREE.Group();
      group.name = 'constructed';

      const byArch = new Map<DecorArch, { x: number; z: number; y: number; rot: number }[]>();
      for (const s of state.settlements) {
        let k = 0;
        // stable id order keeps existing buildings in place as new ones appear
        for (const id of Object.keys(BUILDING_ARCH) as BuildingId[]) {
          const n = s.buildings[id] ?? 0;
          for (let i = 0; i < n; i++) {
            const arch = BUILDING_ARCH[id];
            const list = byArch.get(arch) ?? [];
            list.push(placement(s.id, k++));
            byArch.set(arch, list);
          }
        }
      }

      const _m = new THREE.Matrix4();
      const _q = new THREE.Quaternion();
      const _v = new THREE.Vector3();
      const _s = new THREE.Vector3(1.6, 1.6, 1.6);
      const _e = new THREE.Euler();
      for (const [arch, list] of byArch) {
        const im = new THREE.InstancedMesh(
          archGeo(arch),
          new THREE.MeshLambertMaterial({ vertexColors: true }),
          list.length,
        );
        list.forEach((p, i) => {
          _v.set(p.x, p.y, p.z);
          _e.set(0, p.rot, 0);
          _q.setFromEuler(_e);
          _m.compose(_v, _q, _s);
          im.setMatrixAt(i, _m);
        });
        im.instanceMatrix.needsUpdate = true;
        group.add(im);
      }
      scene.add(group);
    },
  };
}
