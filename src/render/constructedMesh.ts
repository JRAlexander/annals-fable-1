import * as THREE from 'three';
import { CULTURES } from '../content/cultures';
import type { BuildingId } from '../content/schema';
import { ringSpot } from '../sim/placement';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { MAX_HEIGHT, SEA_LEVEL } from '../worldgen/types';
import {
  BUILDING_KINDS,
  type BuildingCulture,
  type BuildingKind,
  buildingGeo,
  WALL_SEG_LEN,
} from './buildingKit';

/** Wall buildings render as a ring around the town, not at their placed spot (M10). */
const WALL_IDS = new Set<BuildingId>(['palisade', 'stoneWall']);

/** The 18 game buildings in kit order — ring assignment stays stable frame to frame. */
const RING_ORDER = BUILDING_KINDS.filter(
  (k) => k !== 'wallSegment' && k !== 'wallTower' && k !== 'tent',
) as readonly BuildingId[];
const KIND_SET = new Set<string>(BUILDING_KINDS);

/** The owner realm's culture, for culture-styled geometry (M18b). */
export function cultureOf(state: GameState, realm: number): BuildingCulture {
  const c = state.realms[realm]?.culture;
  return c === 'norvik' || c === 'ashari' ? c : 'valen';
}

/**
 * Renders player-constructed buildings in a ring outside each settlement's
 * organic core. Placement is a pure function of (settlement, index) so it is
 * identical on every client and every reload — no rng, no sim coupling.
 * Since M18b every building draws from the culture-styled kit at world scale.
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

      // instancing keyed by kind AND culture — three peoples, three skylines
      const byKey = new Map<
        string,
        {
          kind: BuildingKind;
          culture: BuildingCulture;
          list: { x: number; z: number; y: number; rot: number; tint: THREE.Color }[];
        }
      >();
      const push = (
        kind: BuildingKind,
        culture: BuildingCulture,
        p: { x: number; z: number; y: number; rot: number; tint: THREE.Color },
      ) => {
        const key = `${kind}:${culture}`;
        let e = byKey.get(key);
        if (!e) {
          e = { kind, culture, list: [] };
          byKey.set(key, e);
        }
        e.list.push(p);
      };

      for (const s of state.settlements) {
        const site = world.settlements[s.id];
        // rival grounds render only once explored (player structures always show)
        if (s.ownerRealm !== 0 && fog && !fog.exploredAt(site.x, site.z)) continue;
        const culture = cultureOf(state, s.ownerRealm);
        const tint = cultureTint(state.realms[s.ownerRealm]?.culture ?? null);
        // player-placed buildings stand at their chosen ground...
        const placedCounts: Partial<Record<BuildingId, number>> = {};
        for (const pb of s.placed) {
          placedCounts[pb.building] = (placedCounts[pb.building] ?? 0) + 1;
          // walls render as a ring around the town; the placed spot gets a
          // watchtower marker instead — "the gate stands where I put it"
          const kind = WALL_IDS.has(pb.building) ? 'wallTower' : (pb.building as BuildingKind);
          if (!KIND_SET.has(kind)) continue;
          const y = terrainHeight(world.heightmap, pb.x, pb.z);
          push(kind, culture, { x: pb.x, z: pb.z, y, rot: (pb.x + pb.z) % Math.PI, tint });
        }
        // ...the rest (AI and legacy construction) keep the generated ring
        let k = 0;
        // stable id order keeps existing buildings in place as new ones appear
        for (const id of RING_ORDER) {
          if (WALL_IDS.has(id)) continue; // walls live on the ring below
          const n = (s.buildings[id] ?? 0) - (placedCounts[id] ?? 0);
          for (let i = 0; i < n; i++) {
            const p = ringSpot(world, s.id, k++);
            // entrances (+Z) turn toward the town they serve
            const rot = Math.atan2(site.x - p.x, site.z - p.z);
            push(id as BuildingKind, culture, { ...p, rot, tint });
          }
        }

        // the town wall: a full ring of segments once any wall building stands
        const stone = (s.buildings.stoneWall ?? 0) > 0;
        if (stone || (s.buildings.palisade ?? 0) > 0) {
          const wallTint = tint
            .clone()
            .lerp(new THREE.Color(stone ? 0x9a9384 : 0x8a6a3f), stone ? 0.4 : 0.55);
          const ringR = site.radius * 0.92;
          // segment count from the kit's tiling length — the ring closes seamlessly
          const segs = Math.max(8, Math.round((6.283 * ringR) / WALL_SEG_LEN));
          for (let w = 0; w < segs; w++) {
            const a = (w / segs) * 6.283;
            const wx = site.x + Math.cos(a) * ringR;
            const wz = site.z + Math.sin(a) * ringR;
            const wy = terrainHeight(world.heightmap, wx, wz);
            if (wy < SEA_LEVEL * MAX_HEIGHT + 1) continue; // the sea is wall enough
            push('wallSegment', culture, { x: wx, z: wz, y: wy, rot: a + 1.5708, tint: wallTint });
          }
        }
      }

      const _m = new THREE.Matrix4();
      const _q = new THREE.Quaternion();
      const _v = new THREE.Vector3();
      const _s = new THREE.Vector3(1, 1, 1);
      const _e = new THREE.Euler();
      for (const [key, e] of byKey) {
        const im = new THREE.InstancedMesh(
          buildingGeo(e.kind, e.culture),
          new THREE.MeshLambertMaterial({ vertexColors: true }),
          e.list.length,
        );
        im.name = `constructed-${key}`;
        e.list.forEach((p, i) => {
          _v.set(p.x, p.y, p.z);
          _e.set(0, p.rot, 0);
          _q.setFromEuler(_e);
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
