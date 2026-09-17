import * as THREE from 'three';
import { totalUnits } from '../sim/combat';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { archGeo } from './buildingsMesh';
import { UNIT_KINDS, type UnitKind, unitGeo, unitHeight } from './unitKit';

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

export const SOLDIER_COLOR: Record<string, number> = { player: 0xd8c88f, rival: 0x9a3a30, wild: 0x2a2622 };

/** HP bars fade out beyond this camera distance — sub-pixel noise otherwise. */
const BAR_MAX_DIST_SQ = 1600 * 1600;
const BAR_W = 8;
const BAR_H = 1.1;

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
    /** HP bars over wounded soldiers (M10): max-hp memory + the camera to face. */
    bars?: { maxHp(id: number): number | undefined; camera: THREE.PerspectiveCamera },
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
  const _v2 = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _c = new THREE.Color();
  const _right = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
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
  const ringGeo = new THREE.RingGeometry(16, 20, 24);
  ringGeo.rotateX(-Math.PI / 2);

  const barGeo = new THREE.PlaneGeometry(1, 1);
  barGeo.translate(0.5, 0, 0); // left-anchored: the fill drains rightward

  let cones: THREE.InstancedMesh | null = null;
  let rings: THREE.InstancedMesh | null = null;
  let barsBack: THREE.InstancedMesh | null = null;
  let barsFront: THREE.InstancedMesh | null = null;
  let coneCap = 0;
  let barCap = 0;
  let ringCap = 0;
  let pickIds: number[] = [];

  // one instanced pool per unit type (M18a) — the kit's models replace the placeholder boxes
  interface SoldierPool {
    mesh: THREE.InstancedMesh;
    cap: number;
    idx: number;
  }
  const pools = new Map<UnitKind, SoldierPool>();
  const KIND_SET = new Set<string>(UNIT_KINDS);
  const soldierKind = (t: string): UnitKind => (KIND_SET.has(t) ? (t as UnitKind) : 'militia');
  const ensurePool = (kind: UnitKind, need: number): SoldierPool => {
    let p = pools.get(kind);
    if (p && need <= p.cap) return p;
    if (p) scene.remove(p.mesh);
    const cap = Math.max(16, need * 2);
    const mesh = new THREE.InstancedMesh(
      unitGeo(kind),
      new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xffffff }),
      cap,
    );
    mesh.name = `army-soldiers-${kind}`;
    mesh.frustumCulled = false;
    mesh.raycast = () => {}; // picking goes through the banner cones only
    scene.add(mesh);
    p = { mesh, cap, idx: 0 };
    pools.set(kind, p);
    return p;
  };
  /** Last movement heading per soldier — a standing unit keeps facing where it walked. */
  const headings = new Map<number, number>();
  const _e = new THREE.Euler();
  const kindCount = new Map<UnitKind, number>();

  const ensureCapacity = (needCones: number, needBars: number, needRings: number) => {
    if (!cones || needCones > coneCap) {
      if (cones) scene.remove(cones);
      coneCap = Math.max(8, needCones * 2);
      cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), coneCap);
      cones.name = 'army-banners';
      cones.frustumCulled = false; // instance bounds are not where the geometry is
      scene.add(cones);
    }
    if (!barsBack || needBars > barCap) {
      if (barsBack) scene.remove(barsBack);
      if (barsFront) scene.remove(barsFront);
      barCap = Math.max(64, needBars * 2);
      barsBack = new THREE.InstancedMesh(
        barGeo,
        new THREE.MeshBasicMaterial({ color: 0x14100c, side: THREE.DoubleSide }),
        barCap,
      );
      barsFront = new THREE.InstancedMesh(
        barGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
        barCap,
      );
      barsBack.name = 'hp-bars-back';
      barsFront.name = 'hp-bars-front';
      for (const b of [barsBack, barsFront]) {
        b.frustumCulled = false;
        b.raycast = () => {};
        b.count = 0;
        scene.add(b);
      }
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
    sync(state, alpha, selected, fog, selectedUnits, bars) {
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
        // the dragon has a real model now (M18a) — its banner shrinks to a marker
        const sc = isDragon ? 1.3 : 0.8 + Math.sqrt(totalUnits(a.units)) * 0.12;
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

      // every soldier at its TRUE position (M8a), interpolated like the banners;
      // two passes (M18a): size each type's pool first, then fill
      let bIdx = 0;
      const cam = bars?.camera;
      if (cam) {
        // camera-facing frame computed once — every bar shares the billboard
        _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
        _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      }
      kindCount.clear();
      for (const u of state.units) {
        const k = soldierKind(u.type);
        kindCount.set(k, (kindCount.get(k) ?? 0) + 1);
      }
      for (const [k, cnt] of kindCount) ensurePool(k, cnt);
      for (const p of pools.values()) p.idx = 0;
      if (headings.size > state.units.length * 4 + 64) headings.clear(); // stale ids from long-dead soldiers
      for (const u of state.units) {
        const owner = ownerOf.get(u.group) ?? 0;
        const ux = u.prevX + (u.x - u.prevX) * alpha;
        const uz = u.prevZ + (u.z - u.prevZ) * alpha;
        if (fog && owner !== 0 && !fog.visibleAt(ux, uz)) continue; // unseen soldiers stay unseen
        const kind = soldierKind(u.type);
        const pool = pools.get(kind);
        if (!pool || pool.idx >= pool.cap) continue;
        const uy = terrainHeight(world.heightmap, ux, uz);
        const isDragonUnit = u.type === 'dragon';
        _v.set(ux, uy, uz);
        const usc = isDragonUnit ? 4 : 1;
        _s.set(usc, usc, usc);
        const dx = u.x - u.prevX;
        const dz = u.z - u.prevZ;
        let heading = headings.get(u.id) ?? 0;
        if (dx * dx + dz * dz > 0.25) {
          // face the walk; below the threshold combat micro-steps would just jitter
          heading = Math.atan2(dx, dz);
          headings.set(u.id, heading);
        }
        _q.setFromEuler(_e.set(0, heading, 0));
        _m.compose(_v, _q, _s);
        pool.mesh.setMatrixAt(pool.idx, _m);
        // the dragon wears its true colors — an owner wash would blacken it
        pool.mesh.setColorAt(
          pool.idx,
          isDragonUnit
            ? _c.set(0xffffff)
            : _c.set(
                owner === 0 ? SOLDIER_COLOR.player : owner < 0 ? SOLDIER_COLOR.wild : SOLDIER_COLOR.rival,
              ),
        );
        pool.idx++;
        if (selectedUnits?.has(u.id) && rings && rIdx < ringCap) {
          _v.set(ux, uy + 1, uz);
          _s.set(0.28, 1, 0.28);
          _q.identity();
          _m.compose(_v, _q, _s);
          rings.setMatrixAt(rIdx, _m);
          rIdx++;
        }

        // hp bar — only over the wounded, only near enough to read (M10)
        if (bars && cam && barsBack && barsFront && bIdx < barCap) {
          const max = bars.maxHp(u.id);
          if (max !== undefined && u.hp < max && u.hp > 0) {
            // capped so a raised pike doesn't carry the bar with it
            _v.set(ux, uy + (Math.min(unitHeight(kind), 10.5) + 2.5) * usc, uz);
            if (cam.position.distanceToSquared(_v) < BAR_MAX_DIST_SQ) {
              const frac = Math.max(0, Math.min(1, u.hp / max));
              // back plate: slightly larger, nudged away from the camera
              _v2
                .copy(_v)
                .addScaledVector(_right, -(BAR_W + 0.5) / 2)
                .addScaledVector(_fwd, -0.06);
              _s.set(BAR_W + 0.5, BAR_H + 0.3, 1);
              _m.compose(_v2, cam.quaternion, _s);
              barsBack.setMatrixAt(bIdx, _m);
              // front fill: drains rightward, red→green with health
              _v2.copy(_v).addScaledVector(_right, -BAR_W / 2);
              _s.set(BAR_W * frac, BAR_H, 1);
              _m.compose(_v2, cam.quaternion, _s);
              barsFront.setMatrixAt(bIdx, _m);
              barsFront.setColorAt(bIdx, _c.setHSL(0.33 * frac, 0.75, 0.45));
              bIdx++;
            }
          }
        }
      }

      if (cones) {
        cones.count = n;
        cones.instanceMatrix.needsUpdate = true;
        if (cones.instanceColor) cones.instanceColor.needsUpdate = true;
      }
      for (const p of pools.values()) {
        p.mesh.count = p.idx;
        p.mesh.instanceMatrix.needsUpdate = true;
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
      if (rings) {
        rings.count = rIdx;
        rings.instanceMatrix.needsUpdate = true;
      }
      if (barsBack && barsFront) {
        barsBack.count = bIdx;
        barsFront.count = bIdx;
        barsBack.instanceMatrix.needsUpdate = true;
        barsFront.instanceMatrix.needsUpdate = true;
        if (barsFront.instanceColor) barsFront.instanceColor.needsUpdate = true;
      }
    },
  };
}
