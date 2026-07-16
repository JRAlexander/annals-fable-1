import * as THREE from 'three';
import { CULTURES } from '../content/cultures';
import type { BuildingId } from '../content/schema';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { MAX_HEIGHT, SEA_LEVEL } from '../worldgen/types';
import { archGeo, type DecorArch } from './buildingsMesh';

/** Visual stand-ins from the ANNALS arch kit until buildings get bespoke models. */
export const BUILDING_ARCH: Record<BuildingId, DecorArch> = {
  townCenter: 'keep',
  palisade: 'wall',
  stoneWall: 'wall',
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

/** The Wonder dwarfs everything else; town centers stand a head above; walls run long. */
export const ARCH_SCALE: Partial<Record<BuildingId, number>> = {
  wonder: 3.2,
  townCenter: 1.15,
  stoneWall: 1.4,
};

/** Wall buildings render as a ring around the town, not at their placed spot (M10). */
const WALL_IDS = new Set<BuildingId>(['palisade', 'stoneWall']);

const GOLDEN_ANGLE = 2.399963;

/**
 * Where the k-th auto-placed (non-`placed`) building of a settlement stands:
 * a golden-angle ring outside the town, walking outward off any water. Shared
 * with the scaffold layer so in-progress buildings rise exactly where the
 * finished ones will land.
 */
export function ringPlacement(
  world: WorldData,
  siteIdx: number,
  k: number,
): { x: number; z: number; y: number; rot: number } {
  const site = world.settlements[siteIdx];
  const radius = site.radius * 1.12;
  const angle = site.id * 1.7 + k * GOLDEN_ANGLE;
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = site.x + Math.cos(angle) * (radius + attempt * 24);
    const z = site.z + Math.sin(angle) * (radius + attempt * 24);
    const y = terrainHeight(world.heightmap, x, z);
    if (y > SEA_LEVEL * MAX_HEIGHT + 2) return { x, z, y, rot: angle + Math.PI / 2 };
  }
  const y = terrainHeight(world.heightmap, site.x, site.z);
  return { x: site.x, z: site.z, y, rot: 0 };
}

/**
 * The ring index the NEXT auto-placed building of `building` would take,
 * given the current per-id ring counts: ids before it (in BUILDING_ARCH
 * order) occupy the leading slots, its own existing instances the next.
 * Wall ids never join the ring.
 */
export function ringIndexFor(counts: Partial<Record<BuildingId, number>>, building: BuildingId): number {
  let k = 0;
  for (const id of Object.keys(BUILDING_ARCH) as BuildingId[]) {
    if (WALL_IDS.has(id)) continue;
    if (id === building) return k + (counts[id] ?? 0);
    k += counts[id] ?? 0;
  }
  return k;
}

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
          // walls render as a ring around the town; the placed spot gets a
          // watchtower marker instead — "the gate stands where I put it"
          const arch = WALL_IDS.has(pb.building) ? 'tower' : BUILDING_ARCH[pb.building];
          if (!arch) continue;
          const y = terrainHeight(world.heightmap, pb.x, pb.z);
          const list = byArch.get(arch) ?? [];
          list.push({
            x: pb.x,
            z: pb.z,
            y,
            rot: (pb.x + pb.z) % Math.PI,
            tint,
            scale: WALL_IDS.has(pb.building) ? 0.8 : ARCH_SCALE[pb.building],
          });
          byArch.set(arch, list);
        }
        // ...the rest (AI and legacy construction) keep the generated ring
        let k = 0;
        // stable id order keeps existing buildings in place as new ones appear
        for (const id of Object.keys(BUILDING_ARCH) as BuildingId[]) {
          if (WALL_IDS.has(id)) continue; // walls live on the ring below
          const n = (s.buildings[id] ?? 0) - (placedCounts[id] ?? 0);
          for (let i = 0; i < n; i++) {
            const arch = BUILDING_ARCH[id];
            const list = byArch.get(arch) ?? [];
            list.push({ ...ringPlacement(world, s.id, k++), tint });
            byArch.set(arch, list);
          }
        }

        // the town wall: a full ring of segments once any wall building stands
        const stone = (s.buildings.stoneWall ?? 0) > 0;
        if (stone || (s.buildings.palisade ?? 0) > 0) {
          const wallTint = tint
            .clone()
            .lerp(new THREE.Color(stone ? 0x9a9384 : 0x8a6a3f), stone ? 0.4 : 0.55);
          const segs = Math.floor(site.radius / 9);
          const list = byArch.get('wall') ?? [];
          for (let w = 0; w < segs; w++) {
            const a = (w / segs) * 6.283;
            const wx = site.x + Math.cos(a) * (site.radius * 0.92);
            const wz = site.z + Math.sin(a) * (site.radius * 0.92);
            const wy = terrainHeight(world.heightmap, wx, wz);
            if (wy < SEA_LEVEL * MAX_HEIGHT + 1) continue; // the sea is wall enough
            list.push({ x: wx, z: wz, y: wy, rot: a + 1.5708, tint: wallTint, scale: stone ? 1.4 : 0.85 });
          }
          byArch.set('wall', list);
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
        im.name = `constructed-${arch}`;
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
