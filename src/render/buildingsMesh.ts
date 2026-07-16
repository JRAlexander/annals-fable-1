import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The low-poly building kit (inherited from ANNALS, now presentation-only):
 * each archetype is a merged, vertex-colored body+roof geometry. Consumed by
 * constructedMesh (sim buildings) and the placement ghost — the worldgen
 * decorative scatter that once used it is gone (M9).
 */
export const DECOR_ARCHS = [
  'house',
  'longhouse',
  'shop',
  'smithy',
  'mill',
  'granary',
  'tavern',
  'temple',
  'warehouse',
  'tower',
  'wall',
  'keep',
] as const;
export type DecorArch = (typeof DECOR_ARCHS)[number];

export function paint(g: THREE.BufferGeometry, col: number): THREE.BufferGeometry {
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

export function archGeo(arch: DecorArch): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, y: number, col: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, y + h / 2, 0);
    parts.push(paint(g, col));
  };
  const roof = (w: number, d: number, h: number, y: number, col: number) => {
    const g = new THREE.ConeGeometry(Math.max(w, d) * 0.72, h, 4);
    g.rotateY(Math.PI / 4);
    g.translate(0, y + h / 2, 0);
    parts.push(paint(g, col));
  };
  const wall = 0xcbb58f;
  const wall2 = 0xb99f74;
  const stone = 0x9a9384;
  const dark = 0x6b5a45;
  const roofc = 0x7a4a35;
  const roofd = 0x5a3a2a;
  switch (arch) {
    case 'house':
      box(7, 6, 8, 0, wall);
      roof(9, 10, 5, 6, roofc);
      break;
    case 'longhouse':
      box(7, 5, 15, 0, wall);
      roof(9, 17, 4, 5, roofc);
      break;
    case 'shop':
      box(7, 7, 8, 0, wall2);
      roof(9, 10, 4, 7, roofd);
      box(2, 1.4, 1, 3, 0x8a5a2a);
      break;
    case 'smithy':
      box(8, 6, 9, 0, stone);
      roof(10, 11, 3.5, 6, roofd);
      box(1.6, 4, 1.6, 6, dark);
      break;
    case 'mill':
      box(7, 9, 8, 0, wall);
      roof(9, 10, 5, 9, roofc);
      box(0.6, 7, 7, 4, dark);
      break;
    case 'granary':
      box(9, 8, 11, 0, wall2);
      roof(11, 13, 5, 8, roofc);
      break;
    case 'tavern':
      box(10, 7, 10, 0, wall);
      roof(12, 12, 5, 7, roofc);
      box(1.5, 1, 1, 4, 0x8a5a2a);
      break;
    case 'temple':
      box(11, 12, 16, 0, stone);
      roof(13, 18, 7, 12, 0x8a7a5a);
      box(3, 7, 3, 12, stone);
      break;
    case 'warehouse':
      box(12, 7, 14, 0, dark);
      roof(14, 16, 4, 7, roofd);
      break;
    case 'tower':
      box(6, 16, 6, 0, stone);
      roof(7, 7, 6, 16, roofd);
      break;
    case 'wall':
      box(9, 7, 2.5, 0, stone);
      break;
    case 'keep':
      box(16, 20, 16, 0, stone);
      box(5, 26, 5, 0, stone);
      roof(7, 7, 7, 26, 0x6a3a2a);
      break;
    default:
      box(6, 5, 6, 0, wall);
  }
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}
