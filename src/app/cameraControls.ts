import * as THREE from 'three';
import type { SceneHandle } from '../render/scene';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { WORLD_SIZE } from '../worldgen/types';

/**
 * RTS camera movement (M11): WASD and screen-edge panning, plus programmatic
 * jumps (minimap clicks, alert toasts, control-group double-taps). Panning
 * translates `controls.target` and `camera.position` by the SAME vector, so
 * OrbitControls' damping — which acts only on its spherical rotate/dolly
 * deltas — never fights the move.
 */

const EDGE_PX = 14;
/** Pan velocity as a fraction of the camera's orbit distance, per second. */
const PAN_FACTOR = 0.9;
const BOUNDS = WORLD_SIZE / 2 - 100;

export interface CameraControlsHandle {
  update(dtMs: number): void;
  jumpTo(x: number, z: number): void;
  dispose(): void;
}

const isFormControl = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName);

export function createCameraControls(scene: SceneHandle, world: WorldData): CameraControlsHandle {
  const held = new Set<string>();
  let lastX = -1;
  let lastY = -1;
  let overCanvas = false;

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (isFormControl(ev.target)) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(ev.code)) held.add(ev.code);
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    held.delete(ev.code);
  };
  const onBlur = () => held.clear();
  const onPointerMove = (ev: PointerEvent) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    // panels intercept the target — only the world view arms edge-scrolling
    overCanvas = ev.target === scene.renderer.domElement;
  };
  const onMouseLeave = () => {
    overCanvas = false;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointermove', onPointerMove);
  document.documentElement.addEventListener('mouseleave', onMouseLeave);

  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _delta = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  const applyDelta = (dx: number, dy: number, dz: number) => {
    const { controls, camera } = scene;
    controls.target.x += dx;
    controls.target.y += dy;
    controls.target.z += dz;
    camera.position.x += dx;
    camera.position.y += dy;
    camera.position.z += dz;
    // keep the eye inside the world
    const cx = Math.max(-BOUNDS, Math.min(BOUNDS, controls.target.x));
    const cz = Math.max(-BOUNDS, Math.min(BOUNDS, controls.target.z));
    camera.position.x += cx - controls.target.x;
    camera.position.z += cz - controls.target.z;
    controls.target.x = cx;
    controls.target.z = cz;
    // ...and the focus on the ground
    const gy = terrainHeight(world.heightmap, controls.target.x, controls.target.z);
    camera.position.y += gy - controls.target.y;
    controls.target.y = gy;
  };

  return {
    update(dtMs) {
      let dx = 0;
      let dy = 0;
      if (held.has('KeyA')) dx -= 1;
      if (held.has('KeyD')) dx += 1;
      if (held.has('KeyW')) dy += 1;
      if (held.has('KeyS')) dy -= 1;
      if (overCanvas && lastX >= 0) {
        if (lastX < EDGE_PX) dx -= 1;
        if (lastX > window.innerWidth - EDGE_PX) dx += 1;
        if (lastY < EDGE_PX) dy += 1;
        if (lastY > window.innerHeight - EDGE_PX) dy -= 1;
      }
      if (dx === 0 && dy === 0) return;

      const { controls, camera } = scene;
      _fwd.subVectors(controls.target, camera.position);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
      _fwd.normalize();
      // fwd × up: facing -z that's (1,0,0) — screen-right
      _right.crossVectors(_fwd, UP).normalize();
      const speed = PAN_FACTOR * camera.position.distanceTo(controls.target) * (dtMs / 1000);
      _delta
        .set(0, 0, 0)
        .addScaledVector(_right, dx * speed)
        .addScaledVector(_fwd, dy * speed);
      applyDelta(_delta.x, 0, _delta.z);
    },

    jumpTo(x, z) {
      const { controls } = scene;
      const tx = Math.max(-BOUNDS, Math.min(BOUNDS, x));
      const tz = Math.max(-BOUNDS, Math.min(BOUNDS, z));
      applyDelta(tx - controls.target.x, 0, tz - controls.target.z);
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('mouseleave', onMouseLeave);
    },
  };
}
