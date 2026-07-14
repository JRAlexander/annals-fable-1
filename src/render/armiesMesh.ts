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

// rival banners are dark red, brightening when they close for the kill
const ENEMY_PHASE_COLOR: Record<string, number> = {
  idle: 0x6a1f1f,
  marching: 0x8a2a22,
  returning: 0x5a2a2a,
  fighting: 0xd83a2a,
};

// the wilds march under no banner at all — black; the dragon burns ember-red
const WILD_PHASE_COLOR: Record<string, number> = {
  idle: 0x1a1a1a,
  marching: 0x24201c,
  returning: 0x1a1a1a,
  fighting: 0x3a2418,
};
const DRAGON_COLOR = 0xd84418;

const SOLDIER_COLOR: Record<string, number> = { player: 0xd8c88f, rival: 0x9a3a30, wild: 0x2a2622 };

export interface ArmyPick {
  mesh: THREE.InstancedMesh;
  /** instanceId → army id, refreshed every sync. */
  ids: number[];
}

export interface ArmiesHandle {
  sync(
    state: GameState,
    alpha: number,
    selected?: ReadonlySet<number>,
    /** Fog predicates (M7b): hostile armies need line of sight, tents need exploration. */
    fog?: { visibleAt(x: number, z: number): boolean; exploredAt(x: number, z: number): boolean },
    /** Individually selected soldiers (M8a) get small rings. */
    selectedUnits?: ReadonlySet<number>,
  ): void;
  /** The banner cones, raycastable; instanceId maps through `ids`. */
  getPickTargets(): ArmyPick | null;
}

/**
 * Armies as banner-cones plus soldier formations (M7a), camps as dark tents.
 * Positions interpolate between the last two sim ticks via the loop's alpha.
 * The cone mesh doubles as the RTS pick target; selection shows as a ring.
 */
export function createArmies(scene: THREE.Scene, world: WorldData): ArmiesHandle {
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
  const _c = new THREE.Color();
  world.camps.forEach((c, k) => {
    const y = terrainHeight(world.heightmap, c.x, c.z);
    _v.set(c.x, y, c.z);
    _s.set(1.8, 1.4, 1.8);
    _q.identity();
    _m.compose(_v, _q, _s);
    tents.setMatrixAt(k, _m);
  });
  tents.instanceMatrix.needsUpdate = true;
  tents.frustumCulled = false; // instance matrices live far from the geometry origin
  scene.add(tents);
  const tentShown: boolean[] = world.camps.map(() => true);

  const coneGeo = new THREE.ConeGeometry(8, 26, 6);
  coneGeo.translate(0, 13, 0);
  const soldierGeo = new THREE.BoxGeometry(3.2, 9, 3.2);
  soldierGeo.translate(0, 4.5, 0);
  const ringGeo = new THREE.RingGeometry(16, 20, 24);
  ringGeo.rotateX(-Math.PI / 2);

  let cones: THREE.InstancedMesh | null = null;
  let soldiers: THREE.InstancedMesh | null = null;
  let rings: THREE.InstancedMesh | null = null;
  let coneCap = 0;
  let soldierCap = 0;
  let ringCap = 0;
  let pickIds: number[] = [];

  const ensureCapacity = (needCones: number, needSoldiers: number, needRings: number) => {
    if (!cones || needCones > coneCap) {
      if (cones) scene.remove(cones);
      coneCap = Math.max(8, needCones * 2);
      cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), coneCap);
      cones.name = 'army-banners';
      cones.frustumCulled = false; // instance bounds are not where the geometry is
      scene.add(cones);
    }
    if (!soldiers || needSoldiers > soldierCap) {
      if (soldiers) scene.remove(soldiers);
      soldierCap = Math.max(64, needSoldiers * 2);
      soldiers = new THREE.InstancedMesh(
        soldierGeo,
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
        soldierCap,
      );
      soldiers.name = 'army-soldiers';
      soldiers.frustumCulled = false;
      soldiers.raycast = () => {}; // picking goes through the banner cones only
      scene.add(soldiers);
    }
    if (!rings || needRings > ringCap) {
      if (rings) scene.remove(rings);
      ringCap = Math.max(8, needRings * 2);
      rings = new THREE.InstancedMesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xc9a227,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        }),
        ringCap,
      );
      rings.name = 'selection-rings';
      rings.frustumCulled = false;
      rings.raycast = () => {};
      scene.add(rings);
    }
  };

  return {
    getPickTargets(): ArmyPick | null {
      return cones ? { mesh: cones, ids: pickIds } : null;
    },
    sync(state, alpha, selected, fog, selectedUnits) {
      // tents show when the ground is explored and the camp still stands
      for (const camp of state.camps) {
        const c = world.camps[camp.id];
        const want = !camp.cleared && (fog ? fog.exploredAt(c.x, c.z) : true);
        if (want !== tentShown[camp.id]) {
          tentShown[camp.id] = want;
          if (want) {
            _v.set(c.x, terrainHeight(world.heightmap, c.x, c.z), c.z);
            _s.set(1.8, 1.4, 1.8);
          } else {
            _v.set(c.x, -100, c.z);
            _s.set(0.001, 0.001, 0.001);
          }
          _q.identity();
          _m.compose(_v, _q, _s);
          tents.setMatrixAt(camp.id, _m);
          tents.instanceMatrix.needsUpdate = true;
        }
      }

      const n = state.armies.length;
      const soldierWant = state.units.length;
      const selCount = (selected?.size ?? 0) + (selectedUnits?.size ?? 0);
      ensureCapacity(n, soldierWant, Math.max(1, selCount));
      pickIds = [];
      const ownerOf = new Map(state.armies.map((a) => [a.id, a.ownerRealm]));

      let sIdx = 0;
      let rIdx = 0;
      state.armies.forEach((a, k) => {
        const x = a.prevX + (a.x - a.prevX) * alpha;
        const z = a.prevZ + (a.z - a.prevZ) * alpha;
        const y = terrainHeight(world.heightmap, x, z);
        const isDragon = (a.units.dragon ?? 0) > 0;
        // hostile armies move unseen beyond the fog (zero-scale keeps pick ids stable)
        const hidden = fog !== undefined && a.ownerRealm !== 0 && !fog.visibleAt(x, z);
        if (hidden) {
          _v.set(x, -100, z);
          _s.set(0.001, 0.001, 0.001);
          _q.identity();
          _m.compose(_v, _q, _s);
          cones?.setMatrixAt(k, _m);
          pickIds.push(a.id);
          return;
        }
        const sc = isDragon ? 3.2 : 0.8 + Math.sqrt(totalUnits(a.units)) * 0.12;
        _v.set(x, y, z);
        _s.set(sc, sc, sc);
        _q.identity();
        _m.compose(_v, _q, _s);
        cones?.setMatrixAt(k, _m);
        const palette =
          a.ownerRealm === 0 ? PHASE_COLOR : a.ownerRealm < 0 ? WILD_PHASE_COLOR : ENEMY_PHASE_COLOR;
        cones?.setColorAt(k, _c.set(isDragon ? DRAGON_COLOR : (palette[a.phase] ?? 0xc9a227)));
        pickIds.push(a.id);

        if (selected?.has(a.id) && rings && rIdx < ringCap) {
          const rs = Math.max(1.2, sc);
          _v.set(x, y + 1.5, z);
          _s.set(rs, 1, rs);
          _q.identity();
          _m.compose(_v, _q, _s);
          rings.setMatrixAt(rIdx, _m);
          rIdx++;
        }
      });

      // every soldier at its TRUE position (M8a), interpolated like the banners
      for (const u of state.units) {
        if (!soldiers || sIdx >= soldierCap) break;
        const owner = ownerOf.get(u.group) ?? 0;
        const ux = u.prevX + (u.x - u.prevX) * alpha;
        const uz = u.prevZ + (u.z - u.prevZ) * alpha;
        if (fog && owner !== 0 && !fog.visibleAt(ux, uz)) continue; // unseen soldiers stay unseen
        const uy = terrainHeight(world.heightmap, ux, uz);
        const isDragonUnit = u.type === 'dragon';
        _v.set(ux, uy, uz);
        const usc = isDragonUnit ? 4 : 1;
        _s.set(usc, usc, usc);
        _q.identity();
        _m.compose(_v, _q, _s);
        soldiers.setMatrixAt(sIdx, _m);
        soldiers.setColorAt(
          sIdx,
          _c.set(owner === 0 ? SOLDIER_COLOR.player : owner < 0 ? SOLDIER_COLOR.wild : SOLDIER_COLOR.rival),
        );
        sIdx++;
        if (selectedUnits?.has(u.id) && rings && rIdx < ringCap) {
          _v.set(ux, uy + 1, uz);
          _s.set(0.28, 1, 0.28);
          _q.identity();
          _m.compose(_v, _q, _s);
          rings.setMatrixAt(rIdx, _m);
          rIdx++;
        }
      }

      if (cones) {
        cones.count = n;
        cones.instanceMatrix.needsUpdate = true;
        if (cones.instanceColor) cones.instanceColor.needsUpdate = true;
      }
      if (soldiers) {
        soldiers.count = sIdx;
        soldiers.instanceMatrix.needsUpdate = true;
        if (soldiers.instanceColor) soldiers.instanceColor.needsUpdate = true;
      }
      if (rings) {
        rings.count = rIdx;
        rings.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
