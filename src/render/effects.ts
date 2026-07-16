import * as THREE from 'three';
import type { GameState } from '../sim/state';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { SOLDIER_COLOR } from './armiesMesh';
import type { TickCombatEvents } from './unitTracker';

/**
 * Battle effects (M10): arrows in flight, the fallen toppling where they die,
 * swing flashes on melee strikes. Pure presentation — spawned from the unit
 * tracker's per-tick diff, never touching sim state. Fixed-capacity instanced
 * pools with oldest-eviction; lifetimes advance with `dtMs × speed/5` so the
 * show keeps pace at 12× and freezes as a tableau on pause.
 */

const ARROW_CAP = 192;
const DEATH_CAP = 128;
const FLASH_CAP = 128;
const ARROW_SPEED = 260; // world units per 1×-second
const DEATH_MS = 900;
const FLASH_MS = 280;

interface Arrow {
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  arc: number;
  dur: number;
  age: number;
}
interface Death {
  x: number;
  y: number;
  z: number;
  color: number;
  axis: number; // topple direction, radians
  age: number;
}
interface Flash {
  x: number;
  y: number;
  z: number;
  age: number;
}

export interface EffectsHandle {
  spawnFromDiff(
    ev: TickCombatEvents,
    state: GameState,
    fog: { visibleAt(x: number, z: number): boolean },
    speed: number,
  ): void;
  update(dtMs: number, speed: number): void;
  /** Cumulative spawn totals — for verification scripts. */
  counts(): { arrows: number; deaths: number; flashes: number };
}

export function createEffects(scene: THREE.Scene, world: WorldData): EffectsHandle {
  const arrowGeo = new THREE.BoxGeometry(0.5, 0.5, 6.5);
  const arrowMesh = new THREE.InstancedMesh(
    arrowGeo,
    new THREE.MeshBasicMaterial({ color: 0xe8dcb8 }),
    ARROW_CAP,
  );
  const deathGeo = new THREE.BoxGeometry(3.2, 9, 3.2);
  deathGeo.translate(0, 4.5, 0);
  const deathMesh = new THREE.InstancedMesh(
    deathGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    DEATH_CAP,
  );
  const flashGeo = new THREE.RingGeometry(1.5, 3, 10);
  flashGeo.rotateX(-Math.PI / 2);
  const flashMesh = new THREE.InstancedMesh(
    flashGeo,
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    FLASH_CAP,
  );
  for (const m of [arrowMesh, deathMesh, flashMesh]) {
    m.frustumCulled = false;
    m.raycast = () => {};
    m.count = 0;
    scene.add(m);
  }
  arrowMesh.name = 'fx-arrows';
  deathMesh.name = 'fx-deaths';
  flashMesh.name = 'fx-flashes';

  const arrows: Arrow[] = [];
  const deaths: Death[] = [];
  const flashes: Flash[] = [];
  const totals = { arrows: 0, deaths: 0, flashes: 0 };

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _c = new THREE.Color();
  const _c2 = new THREE.Color(0x1a1a1a);
  const _dir = new THREE.Vector3();
  const _axis = new THREE.Vector3();
  const FORWARD = new THREE.Vector3(0, 0, 1);

  const groundY = (x: number, z: number) => terrainHeight(world.heightmap, x, z);

  const arrowPos = (a: Arrow, t: number, out: THREE.Vector3) => {
    out.set(
      a.sx + (a.ex - a.sx) * t,
      a.sy + (a.ey - a.sy) * t + 4 * a.arc * t * (1 - t),
      a.sz + (a.ez - a.sz) * t,
    );
  };

  return {
    counts: () => ({ ...totals }),

    spawnFromDiff(ev, _state, fog, speed) {
      for (const s of ev.swings) {
        if (!fog.visibleAt(s.x, s.z)) continue;
        if (s.ranged) {
          const dist = Math.hypot(s.tx - s.x, s.tz - s.z);
          if (dist < 1) continue;
          if (arrows.length >= ARROW_CAP) arrows.shift();
          arrows.push({
            sx: s.x,
            sy: groundY(s.x, s.z) + 7,
            sz: s.z,
            ex: s.tx,
            ey: groundY(s.tx, s.tz) + 5,
            ez: s.tz,
            arc: Math.min(18, dist * 0.18),
            dur: (dist / ARROW_SPEED) * 1000,
            age: 0,
          });
          totals.arrows++;
        } else {
          if (speed >= 60) continue; // at 12× melee flashes are pure strobe
          if (flashes.length >= FLASH_CAP) flashes.shift();
          flashes.push({ x: s.x, y: groundY(s.x, s.z) + 1.2, z: s.z, age: 0 });
          totals.flashes++;
        }
      }
      for (const d of ev.deaths) {
        if (!fog.visibleAt(d.x, d.z)) continue;
        if (deaths.length >= DEATH_CAP) deaths.shift();
        deaths.push({
          x: d.x,
          y: groundY(d.x, d.z),
          z: d.z,
          color:
            d.owner === 0 ? SOLDIER_COLOR.player : d.owner < 0 ? SOLDIER_COLOR.wild : SOLDIER_COLOR.rival,
          axis: (d.x * 0.37 + d.z * 0.73) % 6.283, // deterministic topple direction
          age: 0,
        });
        totals.deaths++;
      }
    },

    update(dtMs, speed) {
      // 5 t/s is 1× — effects pace with the sim and freeze as a tableau on pause
      const dt = dtMs * (speed / 5);

      let i = 0;
      for (let k = arrows.length - 1; k >= 0; k--) {
        const a = arrows[k];
        a.age += dt;
        if (a.age >= a.dur) {
          arrows.splice(k, 1);
        }
      }
      for (const a of arrows) {
        const t = a.age / a.dur;
        arrowPos(a, t, _v);
        arrowPos(a, Math.min(1, t + 0.02), _dir);
        _dir.sub(_v).normalize();
        _q.setFromUnitVectors(FORWARD, _dir);
        _s.set(1, 1, 1);
        _m.compose(_v, _q, _s);
        arrowMesh.setMatrixAt(i++, _m);
      }
      arrowMesh.count = i;
      arrowMesh.instanceMatrix.needsUpdate = true;

      i = 0;
      for (let k = deaths.length - 1; k >= 0; k--) {
        deaths[k].age += dt;
        if (deaths[k].age >= DEATH_MS) deaths.splice(k, 1);
      }
      for (const d of deaths) {
        const t = d.age / DEATH_MS;
        const topple = Math.min(1, t / 0.6);
        const sink = t > 0.6 ? ((t - 0.6) / 0.4) * 6 : 0;
        _axis.set(Math.cos(d.axis), 0, Math.sin(d.axis));
        _q.setFromAxisAngle(_axis, topple * (Math.PI / 2));
        _v.set(d.x, d.y - sink, d.z);
        _s.set(1, 1, 1);
        _m.compose(_v, _q, _s);
        deathMesh.setMatrixAt(i, _m);
        deathMesh.setColorAt(i, _c.set(d.color).lerp(_c2, t));
        i++;
      }
      deathMesh.count = i;
      deathMesh.instanceMatrix.needsUpdate = true;
      if (deathMesh.instanceColor) deathMesh.instanceColor.needsUpdate = true;

      i = 0;
      for (let k = flashes.length - 1; k >= 0; k--) {
        flashes[k].age += dt;
        if (flashes[k].age >= FLASH_MS) flashes.splice(k, 1);
      }
      for (const f of flashes) {
        const t = f.age / FLASH_MS;
        const sc = 1 + t * 1.2;
        _v.set(f.x, f.y, f.z);
        _q.identity();
        _s.set(sc, 1, sc);
        _m.compose(_v, _q, _s);
        flashMesh.setMatrixAt(i, _m);
        // additive blending: fading to black IS fading out
        flashMesh.setColorAt(i, _c.setScalar(1 - t));
        i++;
      }
      flashMesh.count = i;
      flashMesh.instanceMatrix.needsUpdate = true;
      if (flashMesh.instanceColor) flashMesh.instanceColor.needsUpdate = true;
    },
  };
}
