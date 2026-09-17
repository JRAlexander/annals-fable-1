import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS } from '../content/buildings';
import { CULTURES } from '../content/cultures';
import { ringSpot } from '../sim/placement';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { type BuildingCulture, type BuildingKind, buildingGeo, buildingSize } from './buildingKit';
import { cultureOf } from './constructedMesh';

/**
 * Construction sites (M10): every queued building shows a wooden scaffold
 * frame with the building itself rising inside it as `progress` climbs.
 * Player-placed jobs stand at their chosen spot; AI/auto jobs at the exact
 * ring slot the finished building will take (the sim's own ringSpot math, so
 * the scaffold and the finished building can never disagree).
 *
 * Layout recomputes only when the queues change; the per-frame path just
 * rewrites the rising buildings' y-scale from live progress.
 */

interface Site {
  key: string;
  kind: BuildingKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  tint: THREE.Color;
  /** Which settlement + queue index this site tracks, for live progress. */
  settlement: number;
  queueIdx: number;
}

const RISE_FLOOR = 0.06; // freshly broken ground still shows a stub

/** The frame is authored 10 wu wide × 12 tall — per-site scale fits it to the building. */
const FRAME_W = 10;
const FRAME_H = 12;

function paint(g: THREE.BufferGeometry, col: number): THREE.BufferGeometry {
  const c = new THREE.Color(col);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

export interface ScaffoldsHandle {
  sync(state: GameState, fog?: { exploredAt(x: number, z: number): boolean; version: number }): void;
}

export function createScaffolds(scene: THREE.Scene, world: WorldData): ScaffoldsHandle {
  // the frame: four posts and top rails, honest carpentry
  const framePieces: THREE.BufferGeometry[] = [];
  const wood = 0x8a6a3f;
  for (const [px, pz] of [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ]) {
    const post = new THREE.BoxGeometry(0.6, 12, 0.6);
    post.translate(px, 6, pz);
    framePieces.push(paint(post, wood));
  }
  for (const rot of [0, Math.PI / 2]) {
    for (const side of [-5, 5]) {
      const rail = new THREE.BoxGeometry(10.6, 0.5, 0.6);
      rail.rotateY(rot);
      rail.translate(rot === 0 ? 0 : side, 11.7, rot === 0 ? side : 0);
      framePieces.push(paint(rail, wood));
    }
  }
  const frameGeo = mergeGeometries(framePieces, false);
  frameGeo.computeVertexNormals();

  let group: THREE.Group | null = null;
  const rising = new Map<string, THREE.InstancedMesh>();
  let frames: THREE.InstancedMesh | null = null;
  let sites: Site[] = [];
  let lastSig = '';
  let lastTick = -1;

  const tintOf = new Map<string, THREE.Color>();
  const cultureTint = (culture: string | null): THREE.Color => {
    const key = culture ?? '';
    let c = tintOf.get(key);
    if (!c) {
      c = new THREE.Color(CULTURES[key]?.architecture.palette.trim ?? 0xffffff)
        .lerp(new THREE.Color(0xffffff), 0.45)
        .lerp(new THREE.Color(0x555555), 0.3); // dimmed: reads unfinished
      tintOf.set(key, c);
    }
    return c;
  };

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();

  const rebuild = (state: GameState, fog?: { exploredAt(x: number, z: number): boolean }) => {
    if (group) scene.remove(group);
    group = new THREE.Group();
    group.name = 'scaffolds';
    rising.clear();
    sites = [];

    for (const s of state.settlements) {
      if (s.buildQueue.length === 0) continue;
      const site = world.settlements[s.id];
      if (s.ownerRealm !== 0 && fog && !fog.exploredAt(site.x, site.z)) continue;
      const culture = cultureOf(state, s.ownerRealm);
      const tint = cultureTint(state.realms[s.ownerRealm]?.culture ?? null);

      // at-less jobs land on the next ring spots after everything standing —
      // exactly the k the sim's construction system will assign (M12)
      let atless = 0;
      s.buildQueue.forEach((job, qi) => {
        const kind = job.building as BuildingKind;
        let x: number;
        let z: number;
        let y: number;
        let rot: number;
        if (job.at) {
          x = job.at.x;
          z = job.at.z;
          y = terrainHeight(world.heightmap, x, z);
          rot = (x + z) % Math.PI;
        } else {
          const p = ringSpot(world, s.id, s.placed.length + atless++);
          x = p.x;
          z = p.z;
          y = p.y;
          rot = Math.atan2(site.x - x, site.z - z);
        }
        sites.push({
          key: `${kind}:${culture}`,
          kind,
          x,
          y,
          z,
          rot,
          tint,
          settlement: s.id,
          queueIdx: qi,
        });
      });
    }

    // one rising mesh per kind:culture, one frame mesh for all
    const byKey = new Map<string, Site[]>();
    for (const st of sites) {
      const list = byKey.get(st.key) ?? [];
      list.push(st);
      byKey.set(st.key, list);
    }
    for (const [key, list] of byKey) {
      const [kind, culture] = key.split(':') as [BuildingKind, BuildingCulture];
      const im = new THREE.InstancedMesh(
        buildingGeo(kind, culture),
        new THREE.MeshLambertMaterial({ vertexColors: true }),
        list.length,
      );
      im.name = `scaffold-${key}`;
      im.frustumCulled = false;
      im.raycast = () => {};
      list.forEach((st, i) => {
        im.setColorAt(i, st.tint);
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      rising.set(key, im);
      group.add(im);
    }
    frames = new THREE.InstancedMesh(
      frameGeo,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      Math.max(1, sites.length),
    );
    frames.name = 'scaffold-frames';
    frames.frustumCulled = false;
    frames.raycast = () => {};
    sites.forEach((st, i) => {
      const sz = buildingSize(st.kind);
      _v.set(st.x, st.y, st.z);
      _e.set(0, st.rot, 0);
      _q.setFromEuler(_e);
      // the frame hugs the building it raises
      _s.set((sz.w / FRAME_W) * 1.05, (sz.h / FRAME_H) * 1.05, (sz.d / FRAME_W) * 1.05);
      _m.compose(_v, _q, _s);
      frames?.setMatrixAt(i, _m);
    });
    frames.count = sites.length;
    frames.instanceMatrix.needsUpdate = true;
    group.add(frames);
    scene.add(group);
  };

  return {
    sync(state, fog) {
      const parts: string[] = [];
      for (const s of state.settlements) {
        if (s.buildQueue.length === 0) continue;
        parts.push(
          `${s.id}:${s.ownerRealm}:${s.buildQueue
            .map((j) => `${j.building}@${j.at ? `${Math.round(j.at.x)},${Math.round(j.at.z)}` : 'ring'}`)
            .join('|')}`,
        );
      }
      const sig = `${parts.join(';')}~${fog?.version ?? -1}`;
      if (sig !== lastSig) {
        lastSig = sig;
        rebuild(state, fog);
        lastTick = -1; // force a progress pass
      }
      if (state.tick === lastTick || sites.length === 0) return;
      lastTick = state.tick;

      // the rising buildings: y-scale from live progress (head job only moves)
      const perKeyIdx = new Map<string, number>();
      for (const st of sites) {
        const im = rising.get(st.key);
        if (!im) continue;
        const i = perKeyIdx.get(st.key) ?? 0;
        perKeyIdx.set(st.key, i + 1);
        const job = state.settlements[st.settlement]?.buildQueue[st.queueIdx];
        const buildTime = BUILDINGS[job?.building ?? '']?.buildTime ?? 1;
        const frac = Math.max(RISE_FLOOR, Math.min(1, (job?.progress ?? 0) / buildTime));
        _v.set(st.x, st.y, st.z);
        _e.set(0, st.rot, 0);
        _q.setFromEuler(_e);
        _s.set(1, frac, 1);
        _m.compose(_v, _q, _s);
        im.setMatrixAt(i, _m);
        im.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
