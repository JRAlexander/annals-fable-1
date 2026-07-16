import * as THREE from 'three';
import { Fog } from '../app/visibility';
import type { SceneHandle } from '../render/scene';
import { biomeColor } from '../render/terrainMesh';
import type { GameState } from '../sim/state';
import { hidx } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { GRID, MAX_HEIGHT, WORLD_SIZE } from '../worldgen/types';

/**
 * The minimap (M11): a layered 2D canvas — terrain painted once, the fog
 * mask repainted only when it changes, and blips/frustum/pings drawn fresh
 * each frame. Click or drag anywhere to jump the camera there; alerts pulse
 * a red ping at the trouble.
 */

const SIZE = 200;
const PING_MS = 2400;
const PING_PULSE_MS = 800;

export interface MinimapHandle {
  update(state: GameState): void;
  ping(x: number, z: number): void;
  dispose(): void;
}

export function createMinimap(
  el: HTMLElement,
  world: WorldData,
  deps: {
    scene: SceneHandle;
    /** LIVE fog mask reference — never copied. */
    fogMask: Uint8Array;
    fogVersion: () => number;
    visibleAt: (x: number, z: number) => boolean;
    exploredAt: (x: number, z: number) => boolean;
    onJump: (x: number, z: number) => void;
  },
): MinimapHandle {
  const canvas = el.querySelector('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('minimap: no 2d context');

  const px = (x: number) => (x / WORLD_SIZE + 0.5) * SIZE;
  const worldX = (p: number) => (p / SIZE - 0.5) * WORLD_SIZE;

  // terrain layer: painted once — the world never changes shape
  const terrain = document.createElement('canvas');
  terrain.width = GRID;
  terrain.height = GRID;
  {
    const tctx = terrain.getContext('2d');
    if (tctx) {
      const img = tctx.createImageData(GRID, GRID);
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          const k = hidx(i, j);
          const c = biomeColor(world.biome[k], world.heightmap[k] * MAX_HEIGHT);
          const o = k * 4;
          img.data[o] = c.r * 255;
          img.data[o + 1] = c.g * 255;
          img.data[o + 2] = c.b * 255;
          img.data[o + 3] = 255;
        }
      }
      tctx.putImageData(img, 0, 0);
    }
  }

  // fog layer: repainted only when the mask version bumps
  const fogCanvas = document.createElement('canvas');
  fogCanvas.width = GRID;
  fogCanvas.height = GRID;
  let paintedFogVersion = -1;
  const repaintFog = () => {
    const fctx = fogCanvas.getContext('2d');
    if (!fctx) return;
    const img = fctx.createImageData(GRID, GRID);
    for (let k = 0; k < GRID * GRID; k++) {
      const o = k * 4;
      img.data[o] = 7;
      img.data[o + 1] = 9;
      img.data[o + 2] = 12;
      img.data[o + 3] = deps.fogMask[k] === Fog.Unexplored ? 255 : deps.fogMask[k] === Fog.Explored ? 115 : 0;
    }
    fctx.putImageData(img, 0, 0);
  };

  const pings: { x: number; z: number; born: number }[] = [];

  // click or drag = jump the camera there
  let panning = false;
  const jumpFromEvent = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    deps.onJump(
      worldX(((ev.clientX - r.left) / r.width) * SIZE),
      worldX(((ev.clientY - r.top) / r.height) * SIZE),
    );
  };
  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    panning = true;
    canvas.setPointerCapture(ev.pointerId);
    jumpFromEvent(ev);
  };
  const onPointerMove = (ev: PointerEvent) => {
    if (panning) jumpFromEvent(ev);
  };
  const onPointerUp = (ev: PointerEvent) => {
    panning = false;
    canvas.releasePointerCapture(ev.pointerId);
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _ndc = new THREE.Vector2();
  const _hit = new THREE.Vector3();
  const CORNERS: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  return {
    ping(x, z) {
      if (pings.length >= 8) pings.shift();
      pings.push({ x, z, born: performance.now() });
    },

    update(state) {
      if (deps.fogVersion() !== paintedFogVersion) {
        paintedFogVersion = deps.fogVersion();
        repaintFog();
      }
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(terrain, 0, 0, SIZE, SIZE);
      ctx.drawImage(fogCanvas, 0, 0, SIZE, SIZE);

      // settlements: gold for the realm, ember for everyone else once seen
      for (const s of state.settlements) {
        const site = world.settlements[s.id];
        const mine = s.ownerRealm === 0;
        if (!mine && !deps.exploredAt(site.x, site.z)) continue;
        const size = site.tier === 'capital' ? 7 : 5;
        ctx.fillStyle = mine ? '#c9a227' : '#b0563e';
        ctx.fillRect(px(site.x) - size / 2, px(site.z) - size / 2, size, size);
        if (site.tier === 'capital' && mine) {
          ctx.strokeStyle = '#e9dcc3';
          ctx.lineWidth = 1;
          ctx.strokeRect(px(site.x) - size / 2, px(site.z) - size / 2, size, size);
        }
      }
      // bandit camps, while they stand
      ctx.fillStyle = '#8a4a3a';
      for (const camp of state.camps) {
        if (camp.cleared) continue;
        const c = world.camps[camp.id];
        if (!deps.exploredAt(c.x, c.z)) continue;
        ctx.fillRect(px(c.x) - 2, px(c.z) - 2, 4, 4);
      }
      // armies: bright gold for yours; hostile dots only inside your sight
      for (const a of state.armies) {
        const mine = a.ownerRealm === 0;
        if (!mine && !deps.visibleAt(a.x, a.z)) continue;
        ctx.fillStyle = mine ? '#ffd75e' : '#e04f3f';
        ctx.beginPath();
        ctx.arc(px(a.x), px(a.z), 2, 0, 6.283);
        ctx.fill();
      }

      // the camera's footprint on the ground
      const { camera, controls } = deps.scene;
      plane.constant = -controls.target.y;
      ctx.strokeStyle = 'rgba(233, 220, 195, 0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      CORNERS.forEach(([nx, ny], i) => {
        _ndc.set(nx, ny);
        raycaster.setFromCamera(_ndc, camera);
        if (!raycaster.ray.intersectPlane(plane, _hit)) {
          // a sky-pointing corner: take a far point along the ray instead
          _hit.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, WORLD_SIZE * 2);
        }
        const cx = px(_hit.x);
        const cz = px(_hit.z);
        if (i === 0) ctx.moveTo(cx, cz);
        else ctx.lineTo(cx, cz);
      });
      ctx.closePath();
      ctx.stroke();

      // alert pings: expanding rings, three pulses then gone
      const now = performance.now();
      for (let k = pings.length - 1; k >= 0; k--) {
        if (now - pings[k].born > PING_MS) pings.splice(k, 1);
      }
      for (const p of pings) {
        const t = ((now - p.born) % PING_PULSE_MS) / PING_PULSE_MS;
        ctx.strokeStyle = `rgba(224, 79, 63, ${1 - t})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px(p.x), px(p.z), 4 + t * 10, 0, 6.283);
        ctx.stroke();
      }
    },

    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    },
  };
}
