import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { WORLD_SIZE } from '../worldgen/types';
import { buildRoadsMesh } from './roadsMesh';
import { buildTerrainMesh } from './terrainMesh';
import { buildTrees } from './treesMesh';
import { buildSky, buildWater } from './waterSky';

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Draw one frame. The app loop owns frame timing, not the renderer. */
  render: () => void;
  dispose: () => void;
}

/** Assemble the static scene: terrain, water, sky, roads, trees. Buildings are live (constructedMesh). */
export function createScene(world: WorldData, canvas: HTMLCanvasElement): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();

  const sky = buildSky();
  sky.mesh.name = 'sky'; // the RTS picker must never "click the heavens"
  scene.add(sky.mesh);

  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.copy(sky.uniforms.sunPos.value).multiplyScalar(WORLD_SIZE);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd4ee, 0x8a7a5f, 1.1));

  scene.add(buildTerrainMesh(world));
  scene.add(buildWater(world));
  scene.add(buildRoadsMesh(world));
  scene.add(buildTrees(world));

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, WORLD_SIZE * 8);
  const cap = world.capital;
  const capY = terrainHeight(world.heightmap, cap.x, cap.z);
  camera.position.set(cap.x + 700, capY + 900, cap.z + 700);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(cap.x, capY, cap.z);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 60;
  controls.maxDistance = WORLD_SIZE * 1.6;
  controls.update();

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  return {
    renderer,
    scene,
    camera,
    controls,
    render: () => {
      controls.update();
      renderer.render(scene, camera);
    },
    dispose: () => {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}
