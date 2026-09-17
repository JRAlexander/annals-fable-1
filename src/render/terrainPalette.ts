import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Terrain & dressing palette (design brief 2, part B): the seven-swatch
 * warm-chronicle biome palette, water and road constants, and the tree /
 * rock dressing kit for the forest and mountain cells.
 *
 * Brief rules baked in:
 * - Vertex color only — value contrast is painted, never lit (no shadows).
 * - Deterministic: irregularity is hash-derived, never Math.random().
 * - Heights arrive normalized 0..1 against MAX_HEIGHT (520 wu); sea sits
 *   at 0.3 (156 wu). Land shades along a shaped relief curve — flat
 *   through the lowlands, swelling toward ridgelines — replacing the old
 *   linear +0.12 lift.
 * - Midtones keep clear of the overlay colors: player gold 0xc9a227 stays
 *   far more saturated than Farmland, rival red 0x9a3a30 has no terrain
 *   neighbor at all.
 */

export type PaletteBiome = 'Meadow' | 'Farmland' | 'Deciduous' | 'Pine' | 'Rock' | 'Marsh' | 'Water';

/** Sea level in normalized height (156 / 520 wu). */
const SEA_N = 0.3;

/**
 * Land swatch anchors, shoreline → ridgeline. Meadow dries toward hay
 * upslope; Farmland reads tilled gold against it; the two forest floors
 * stay dark so the canopies pop; Rock cools as it climbs; Marsh stays
 * murky and low-chroma.
 */
const SWATCH: Record<Exclude<PaletteBiome, 'Water'>, { lo: THREE.Color; hi: THREE.Color }> = {
  Meadow: { lo: new THREE.Color(0x759447), hi: new THREE.Color(0xa4a763) },
  Farmland: { lo: new THREE.Color(0x9f8148), hi: new THREE.Color(0xb99e63) },
  Deciduous: { lo: new THREE.Color(0x3d5c2d), hi: new THREE.Color(0x527040) },
  Pine: { lo: new THREE.Color(0x2f4b3a), hi: new THREE.Color(0x41604e) },
  Rock: { lo: new THREE.Color(0x776d60), hi: new THREE.Color(0x8f9299) },
  Marsh: { lo: new THREE.Color(0x4c5940), hi: new THREE.Color(0x5e6a4b) },
};
const SNOW = new THREE.Color(0xecf0f4);
const SEABED_DEEP = new THREE.Color(0x223f4a);
const SEABED_SHORE = new THREE.Color(0x6d8d7a);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Smoothstep relief: flat near the shore, swelling toward the peaks. */
const relief = (t: number): number => t * t * (3 - 2 * t);

/** Per-vertex terrain color for a biome at normalized height h (0..1). Writes into and returns `out` when given. */
export function biomeColor(biome: PaletteBiome, h: number, out?: THREE.Color): THREE.Color {
  const c = out ?? new THREE.Color();
  const hn = clamp01(h);
  if (biome === 'Water') {
    // seabed: basin ink → shelf sand-green, so the shallows glow through the sea plane
    return c.copy(SEABED_DEEP).lerp(SEABED_SHORE, clamp01(hn / SEA_N) ** 1.35);
  }
  const s = SWATCH[biome];
  const t = clamp01((hn - SEA_N) / (1 - SEA_N));
  c.copy(s.lo).lerp(s.hi, relief(t));
  // snowline: Rock pales out above ~0.7, full cap by 0.95
  if (biome === 'Rock') c.lerp(SNOW, relief(clamp01((hn - 0.7) / 0.25)));
  // peak light swells cubically; land dragged under the waterline damps dark
  c.offsetHSL(0, 0, 0.09 * t ** 3 - 0.05 * clamp01(1 - hn / SEA_N));
  return c;
}

/** Sea/river planes: ink-teal chronicle water, not pool blue. Rivers run a shade lighter so the 6–13 wu ribbons read. */
export const WATER = { sea: 0x2e5b66, river: 0x407380, opacity: 0.8 };

/** Road ribbon: pale dust, lighter and greyer than every land midtone so caravan routes read at default zoom. Applied by the game as ±width/2. */
export const ROAD = { color: 0xbfa77e, width: 4.6 };

/**
 * Flood a part with a vertical top→under color gradient over its own
 * bounds — baked shading, since Lambert under the two game lights will
 * not darken undersides enough on its own.
 */
function paint(g: THREE.BufferGeometry, top: number, lo: number): THREE.BufferGeometry {
  const ct = new THREE.Color(top);
  const cb = new THREE.Color(lo);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const span = Math.max(bb.max.y - bb.min.y, 1e-6);
  const pos = g.attributes.position;
  const a = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - bb.min.y) / span;
    a[i * 3] = cb.r + (ct.r - cb.r) * t;
    a[i * 3 + 1] = cb.g + (ct.g - cb.g) * t;
    a[i * 3 + 2] = cb.b + (ct.b - cb.b) * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Deterministic 0..1 stream — the kit's only source of irregularity. */
function hash01(n: number): number {
  let x = (n * 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

// canopy greens — a step lighter than the forest-floor swatches they stand on
const BARK = 0x5c4732;
const BARK_LO = 0x3e3020;
const DECID_CANOPY: [number, number][] = [
  [0x5d7c3a, 0x44602c],
  [0x557436, 0x3e5928],
  [0x668545, 0x4c6531],
];
const PINE_SKIRT: [number, number][] = [
  [0x4a7050, 0x33513c],
  [0x517a55, 0x3a583f],
  [0x588158, 0x415f44],
  [0x608a5c, 0x486648],
];

/**
 * Forest dressing, replacing the cone-on-cylinder lollipops. Trunk at
 * origin, ground y = 0; the game instances with per-tree scale/rotation.
 * deciduous = 76 tris (open trunk 10 + spheres 30/20/16);
 * pine = 38 tris (open trunk 10 + four open 7-seg skirts 28).
 */
export function treeGeo(kind: 'deciduous' | 'pine'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'deciduous') {
    const trunk = paint(new THREE.CylinderGeometry(0.5, 0.78, 5.2, 5, 1, true), BARK, BARK_LO);
    trunk.translate(0, 2.6, 0);
    parts.push(trunk);
    // 2–3 canopy masses, hash-slung off the trunk axis
    const a = hash01(11) * Math.PI * 2;
    const main = paint(new THREE.SphereGeometry(2.9, 5, 4), DECID_CANOPY[0][0], DECID_CANOPY[0][1]);
    main.scale(1, 0.82, 1);
    main.translate(0.3, 6.1, -0.2);
    const side = paint(new THREE.SphereGeometry(2.05, 5, 3), DECID_CANOPY[1][0], DECID_CANOPY[1][1]);
    side.translate(Math.cos(a) * 1.9, 5.0, Math.sin(a) * 1.9);
    const crown = paint(new THREE.SphereGeometry(1.5, 4, 3), DECID_CANOPY[2][0], DECID_CANOPY[2][1]);
    crown.translate(-Math.cos(a) * 1.1, 7.9, -Math.sin(a) * 1.1);
    parts.push(main, side, crown);
    return merge(parts);
  }
  const trunk = paint(new THREE.CylinderGeometry(0.4, 0.62, 4.6, 5, 1, true), BARK, BARK_LO);
  trunk.translate(0, 2.3, 0);
  parts.push(trunk);
  // layered skirts, widest low, lightening toward the tip
  const layers: [number, number, number][] = [
    [3.0, 2.8, 2.0],
    [2.4, 2.6, 3.5],
    [1.8, 2.4, 5.0],
    [1.15, 2.5, 6.3],
  ];
  layers.forEach(([r, len, base], i) => {
    const rr = r * (0.94 + 0.12 * hash01(20 + i));
    const skirt = paint(new THREE.ConeGeometry(rr, len, 7, 1, true), PINE_SKIRT[i][0], PINE_SKIRT[i][1]);
    skirt.translate((hash01(30 + i) - 0.5) * 0.3, base + len / 2, (hash01(40 + i) - 0.5) * 0.3);
    parts.push(skirt);
  });
  return merge(parts);
}

/**
 * Rock-biome outcrop cluster, texture for the slopes between grass and
 * snow. 54 tris (four tilted boxes 48 + one open 6-seg pinnacle 6);
 * every part grounded with its lowest corner just under y = 0.
 */
export function rockGeo(): THREE.BufferGeometry {
  const greys: [number, number][] = [
    [0x8e857a, 0x625a4e],
    [0x817a70, 0x584f43],
    [0x968f86, 0x6a6156],
  ];
  const slabs: [number, number, number, number, number, number][] = [
    // w, h, d, x, z, tilt
    [3.4, 2.8, 2.6, 0, 0, 0.16],
    [2.3, 1.9, 2.1, 2.3, 0.6, -0.22],
    [1.7, 1.3, 1.8, -2.1, 0.9, 0.2],
    [1.05, 0.85, 1.15, 0.6, 2.2, -0.14],
  ];
  const parts = slabs.map(([w, h, d, x, z, tilt], i) => {
    const g = paint(new THREE.BoxGeometry(w, h, d), ...greys[i % 3]);
    g.rotateZ(tilt);
    g.rotateX((hash01(50 + i) - 0.5) * 0.3);
    g.rotateY(hash01(60 + i) * Math.PI);
    g.computeBoundingBox();
    g.translate(x, -0.06 - g.boundingBox!.min.y, z);
    return g;
  });
  const spike = paint(new THREE.ConeGeometry(1.05, 1.7, 6, 1, true), greys[2][0], greys[2][1]);
  spike.rotateY(hash01(70) * Math.PI);
  spike.translate(-1.2, 0.85 - 0.06, -1.5);
  parts.push(spike);
  return merge(parts);
}
