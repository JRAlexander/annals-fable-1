import * as THREE from 'three';
import { CULTURES } from '../content/cultures';
import type { BuildingId } from '../content/schema';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { DecorArch, WorldData } from '../worldgen/types';
import { MAX_HEIGHT, SEA_LEVEL } from '../worldgen/types';
import { archGeo } from './buildingsMesh';

/** Visual stand-ins from the ANNALS arch kit until buildings get bespoke models. */
export const BUILDING_ARCH: Record<BuildingId, DecorArch> = {
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
  barracks: 'warehouse',
  archeryRange: 'longhouse',
  stable: 'longhouse',
  wonder: 'keep', // stands taller via per-instance scale below
};

/** The Wonder dwarfs everything else. */
const ARCH_SCALE: Partial<Record<BuildingId, number>> = { wonder: 3.2 };

const GOLDEN_ANGLE = 2.399963;

/**
 * Renders player-constructed buildings in a ring outside each settlement's
 * organic core. Placement is a pure function of (settlement, index) so it is
 * identical on every client and every reload — no rng, no sim coupling.
 */
export function createConstructed(
  scene: THREE.Scene,
  world: WorldData,
): { sync(state: GameState, fog?: { exploredAt(x: number, z: number): boolean; version: number }): void } {
  let group: THREE.Group | null = null;
  let lastSig = '';

  /** Instance tint: the owner culture's trim, softened toward white so vertex colors survive. */
  const tintOf = new Map<string, THREE.Color>();
  function cultureTint(culture: string | null): THREE.Color {
    const key = culture ?? '';
    let c = tintOf.get(key);
    if (!c) {
      c = new THREE.Color(CULTURES[key]?.architecture.palette.trim ?? 0xffffff).lerp(
        new THREE.Color(0xffffff),
        0.45,
      );
      tintOf.set(key, c);
    }
    return c;
  }

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
    sync(state, fog) {
      // rebuild when construction, ownership (captures), or the fog frontier changes
      let count = 0;
      for (const s of state.settlements) {
        for (const n of Object.values(s.buildings)) count += n ?? 0;
      }
      const sig = `${count}|${state.settlements.map((s) => s.ownerRealm).join(',')}|${fog?.version ?? -1}`;
      if (sig === lastSig) return;
      lastSig = sig;

      if (group) scene.remove(group);
      group = new THREE.Group();
      group.name = 'constructed';

      const byArch = new Map<
        DecorArch,
        { x: number; z: number; y: number; rot: number; tint: THREE.Color; scale?: number }[]
      >();
      for (const s of state.settlements) {
        const site = world.settlements[s.id];
        // rival grounds render only once explored (player structures always show)
        if (s.ownerRealm !== 0 && fog && !fog.exploredAt(site.x, site.z)) continue;
        const tint = cultureTint(state.realms[s.ownerRealm]?.culture ?? null);
        // player-placed buildings stand at their chosen ground...
        const placedCounts: Partial<Record<BuildingId, number>> = {};
        for (const pb of s.placed) {
          placedCounts[pb.building] = (placedCounts[pb.building] ?? 0) + 1;
          const arch = BUILDING_ARCH[pb.building];
          if (!arch) continue;
          const y = terrainHeight(world.heightmap, pb.x, pb.z);
          const list = byArch.get(arch) ?? [];
          list.push({
            x: pb.x,
            z: pb.z,
            y,
            rot: (pb.x + pb.z) % Math.PI,
            tint,
            scale: ARCH_SCALE[pb.building],
          });
          byArch.set(arch, list);
        }
        // ...the rest (AI and legacy construction) keep the generated ring
        let k = 0;
        // stable id order keeps existing buildings in place as new ones appear
        for (const id of Object.keys(BUILDING_ARCH) as BuildingId[]) {
          const n = (s.buildings[id] ?? 0) - (placedCounts[id] ?? 0);
          for (let i = 0; i < n; i++) {
            const arch = BUILDING_ARCH[id];
            const list = byArch.get(arch) ?? [];
            list.push({ ...placement(s.id, k++), tint });
            byArch.set(arch, list);
          }
        }
      }

      const _m = new THREE.Matrix4();
      const _q = new THREE.Quaternion();
      const _v = new THREE.Vector3();
      const _s = new THREE.Vector3();
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
          const sc = 1.6 * (p.scale ?? 1);
          _s.set(sc, sc, sc);
          _m.compose(_v, _q, _s);
          im.setMatrixAt(i, _m);
          im.setColorAt(i, p.tint);
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.frustumCulled = false; // instance bounds are not where the geometry is
        group.add(im);
      }
      scene.add(group);
    },
  };
}
