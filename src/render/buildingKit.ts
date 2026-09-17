import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The building model kit (M18b): all 21 building kinds × 3 cultures, each one
 * merged, vertex-colored BufferGeometry built from primitives, drawn by
 * constructedMesh / scaffoldMesh / the placement ghost at instance scale 1.
 *
 * Design brief 2 rules baked in here:
 * - Real proportions: models are built at final world size against the
 *   gameplay footprint (1 cell = 6000/127 ≈ 47.24 wu), ~70–85% ground
 *   coverage, doors sized for 5-wu villagers, nothing under soldier height.
 * - Culture is structural, not a repaint: shared massing recipes take a
 *   culture-swapped roof (valen steep gable / norvik low sod-and-beam /
 *   ashari dome-and-vault) plus one motif each (timber cross-bracing /
 *   crossed gable-end beams / bronze dome finial), in the fixed palettes
 *   from src/content/cultures.ts.
 * - Value contrast lives in the vertex colors — lighter roof ridges, darker
 *   fascia under the eaves — because the renderer casts no shadows.
 * - One small near-white banner/trim element per building where the game's
 *   45%-toward-white owner tint reads; everything else in true colors. The
 *   bandit tent flies no banner on purpose: the wilds are nobody's culture.
 * - Deterministic (irregularity hashes from kind:culture), ground at y = 0,
 *   entrance facing +Z, hard triangle budgets stated above each recipe.
 */

export type BuildingKind =
  | 'townCenter'
  | 'house'
  | 'farm'
  | 'lumberCamp'
  | 'quarry'
  | 'market'
  | 'storehouse'
  | 'temple'
  | 'granary'
  | 'university'
  | 'guildhall'
  | 'keep'
  | 'palisade'
  | 'stoneWall'
  | 'barracks'
  | 'archeryRange'
  | 'stable'
  | 'wonder'
  | 'wallSegment'
  | 'wallTower'
  | 'tent';

export type BuildingCulture = 'valen' | 'norvik' | 'ashari';

export const BUILDING_KINDS: readonly BuildingKind[] = [
  'townCenter',
  'house',
  'farm',
  'lumberCamp',
  'quarry',
  'market',
  'storehouse',
  'temple',
  'granary',
  'university',
  'guildhall',
  'keep',
  'palisade',
  'stoneWall',
  'barracks',
  'archeryRange',
  'stable',
  'wonder',
  'wallSegment',
  'wallTower',
  'tent',
];

/** Wall ring segment length along X, wu — the town-ring spacing derives from this. */
export const WALL_SEG_LEN = 10.5;

/** Approximate overall size in wu (culture-independent envelope) — scaffold and ghost scale by it. */
export function buildingSize(kind: BuildingKind): { w: number; d: number; h: number } {
  return SIZES[kind];
}

const SIZES: Record<BuildingKind, { w: number; d: number; h: number }> = {
  townCenter: { w: 116, d: 116, h: 48 },
  house: { w: 33, d: 30, h: 23 },
  farm: { w: 78, d: 78, h: 16 },
  lumberCamp: { w: 80, d: 38, h: 17 },
  quarry: { w: 76, d: 76, h: 22 },
  market: { w: 76, d: 76, h: 16 },
  storehouse: { w: 66, d: 62, h: 30 },
  temple: { w: 62, d: 104, h: 55 },
  granary: { w: 70, d: 70, h: 27 },
  university: { w: 112, d: 112, h: 30 },
  guildhall: { w: 65, d: 60, h: 36 },
  keep: { w: 98, d: 98, h: 50 },
  palisade: { w: 80, d: 12, h: 16 },
  stoneWall: { w: 80, d: 10, h: 14 },
  barracks: { w: 108, d: 108, h: 30 },
  archeryRange: { w: 108, d: 60, h: 15 },
  stable: { w: 104, d: 64, h: 26 },
  wonder: { w: 142, d: 142, h: 96 },
  wallSegment: { w: WALL_SEG_LEN, d: 5.5, h: 12 },
  wallTower: { w: 13, d: 13, h: 24 },
  tent: { w: 22, d: 13, h: 9 },
};

// ---------------------------------------------------------------- palettes

/** Culture material set, derived from the fixed wall/roof/trim hexes in src/content/cultures.ts. */
interface Pal {
  wall: number;
  wallLo: number;
  roof: number;
  roofHi: number;
  roofLo: number;
  fascia: number;
  trim: number;
  trimLo: number;
  beam: number;
  beamLo: number;
  stone: number;
  stoneLo: number;
  pad: number;
  crop: number;
  cropLo: number;
}

function shade(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

function mkPal(wall: number, roof: number, trim: number, beam: number, stone: number, crop: number): Pal {
  return {
    wall,
    wallLo: shade(wall, 0.76),
    roof,
    roofHi: shade(roof, 1.24),
    roofLo: shade(roof, 0.62),
    fascia: shade(roof, 0.42),
    trim,
    trimLo: shade(trim, 0.7),
    beam,
    beamLo: shade(beam, 0.7),
    stone,
    stoneLo: shade(stone, 0.72),
    pad: shade(wall, 0.6),
    crop,
    cropLo: shade(crop, 0.72),
  };
}

const PALETTES: Record<BuildingCulture, Pal> = {
  valen: mkPal(0xd8c49a, 0x8a4a2f, 0xc9a227, 0x6b4a2f, 0xb0a488, 0xbf9c46),
  norvik: mkPal(0x8a7a5f, 0x4a5a3a, 0x3a3a3a, 0x4f4334, 0x767268, 0x9a8f4e),
  ashari: mkPal(0xe0d0a8, 0x5a7a9a, 0x8a6a3a, 0x9a7a4e, 0xcbb992, 0xb0985a),
};

// the tint zone: near-white cloth so the owner wash reads at full strength
const BANNER = 0xf2efe8;
const BANNER_LO = 0xd8d4c9;
// shared true colors
const DARK = 0x2b241d; // door and window openings
const DARK_LO = 0x1d1913;
const SOIL = 0x6f5a3c;
const UMBER = 0x554433; // the wilds' hide tents
const UMBER_LO = 0x3b3024;

// -------------------------------------------------------------- primitives

type Parts = THREE.BufferGeometry[];

/** Deterministic 0..1 stream from a seed string — the kit's only "randomness". */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Flood a part with a vertical top→bottom color gradient over its own bounds.
 * The default underside is the top color dimmed — baked shading, since
 * Lambert under two lights will not darken undersides enough on its own.
 */
function paint(g: THREE.BufferGeometry, top: number, lo?: number): THREE.BufferGeometry {
  const ct = new THREE.Color(top);
  const cb = lo === undefined ? new THREE.Color(top).multiplyScalar(0.78) : new THREE.Color(lo);
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

// primitive helpers: create, paint, collect — returned for transform chaining
function box(p: Parts, w: number, h: number, d: number, top: number, lo?: number): THREE.BufferGeometry {
  const g = paint(new THREE.BoxGeometry(w, h, d), top, lo);
  p.push(g);
  return g;
}
function cyl(
  p: Parts,
  rT: number,
  rB: number,
  h: number,
  seg: number,
  top: number,
  lo?: number,
  open = false,
): THREE.BufferGeometry {
  const g = paint(new THREE.CylinderGeometry(rT, rB, h, seg, 1, open), top, lo);
  p.push(g);
  return g;
}
function cone(
  p: Parts,
  r: number,
  h: number,
  seg: number,
  top: number,
  lo?: number,
  open = false,
): THREE.BufferGeometry {
  const g = paint(new THREE.ConeGeometry(r, h, seg, 1, open), top, lo);
  p.push(g);
  return g;
}
function ball(p: Parts, r: number, ws: number, hs: number, top: number, lo?: number): THREE.BufferGeometry {
  const g = paint(new THREE.SphereGeometry(r, ws, hs), top, lo);
  p.push(g);
  return g;
}

/** Triangular roof prism — ridge along X, base len×span centered at the origin, base y=0, ridge y=h. */
function prism(
  p: Parts,
  len: number,
  h: number,
  span: number,
  top: number,
  lo?: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, len, 3, 1);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI / 2);
  g.translate(0, 0.5, 0);
  g.scale(1, h / 1.5, span / Math.sqrt(3));
  paint(g, top, lo);
  p.push(g);
  return g;
}

// ------------------------------------------------------------ shared kit

/** Everything a recipe needs: the part list, the culture, its palette, its hash stream. */
interface Ctx {
  parts: Parts;
  c: BuildingCulture;
  p: Pal;
  r: () => number;
}

interface RoofOpts {
  /** Ridge direction; defaults to the long axis. */
  axis?: 'x' | 'z';
  /** Rise over span; defaults 0.42 valen, 0.14 norvik. */
  pitch?: number;
  /** Eave overhang. */
  ov?: number;
  cx?: number;
  cz?: number;
  /** Ashari treatment: central dome (default), barrel vault, or bare parapet deck. */
  style?: 'dome' | 'vault' | 'flat';
  domeR?: number;
}

// valen — steep terracotta gable with a light ridge cap and dark eave fascia
function gableOn(x: Ctx, w: number, d: number, baseY: number, o: RoofOpts): number {
  const { parts, p } = x;
  const cx = o.cx ?? 0;
  const cz = o.cz ?? 0;
  const axis = o.axis ?? (w >= d ? 'x' : 'z');
  const ov = o.ov ?? 2.4;
  const len = (axis === 'x' ? w : d) + ov * 2;
  const span = (axis === 'x' ? d : w) + ov * 2;
  const h = span * (o.pitch ?? 0.42);
  const g = prism(parts, len, h, span, p.roofHi, p.roofLo);
  if (axis === 'z') g.rotateY(Math.PI / 2);
  g.translate(cx, baseY, cz);
  const cap = box(
    parts,
    axis === 'x' ? len * 0.94 : 1.5,
    0.9,
    axis === 'x' ? 1.5 : len * 0.94,
    shade(p.roof, 1.4),
    p.roofHi,
  );
  cap.translate(cx, baseY + h + 0.2, cz);
  for (const s of [-1, 1]) {
    const f = box(parts, axis === 'x' ? len : 1.1, 1.2, axis === 'x' ? 1.1 : len, p.fascia, p.fascia);
    f.translate(
      cx + (axis === 'z' ? s * (span / 2) : 0),
      baseY + 0.3,
      cz + (axis === 'x' ? s * (span / 2) : 0),
    );
  }
  return baseY + h + 0.7;
}

// norvik — low moss-green sod roof, heavy eave beams, crossed gable-end beams (the motif)
function sodOn(x: Ctx, w: number, d: number, baseY: number, o: RoofOpts): number {
  const { parts, p } = x;
  const cx = o.cx ?? 0;
  const cz = o.cz ?? 0;
  const axis = o.axis ?? (w >= d ? 'x' : 'z');
  const ov = o.ov ?? 3.0;
  const len = (axis === 'x' ? w : d) + ov * 2;
  const span = (axis === 'x' ? d : w) + ov * 2;
  const h = span * (o.pitch ?? 0.14);
  const g = prism(parts, len, h, span, p.roofHi, p.roofLo);
  if (axis === 'z') g.rotateY(Math.PI / 2);
  g.translate(cx, baseY, cz);
  for (const s of [-1, 1]) {
    const f = box(parts, axis === 'x' ? len : 1.7, 1.5, axis === 'x' ? 1.7 : len, p.beam, p.beamLo);
    f.translate(
      cx + (axis === 'z' ? s * (span / 2) : 0),
      baseY + 0.4,
      cz + (axis === 'x' ? s * (span / 2) : 0),
    );
  }
  for (const e of [-1, 1]) {
    for (const a of [-1, 1]) {
      const bm = box(parts, 1.0, h + 7, 1.0, p.beam, p.beamLo);
      if (axis === 'x') {
        bm.rotateX(a * 0.55);
        bm.translate(cx + e * (len / 2 - 0.55), baseY + h * 0.45, cz);
      } else {
        bm.rotateZ(a * 0.55);
        bm.translate(cx, baseY + h * 0.45, cz + e * (len / 2 - 0.55));
      }
    }
  }
  return baseY + h * 0.9 + 3.2;
}

// ashari — parapet deck with a dome (or barrel vault) and the bronze finial motif
function domeOn(x: Ctx, w: number, d: number, baseY: number, o: RoofOpts): number {
  const { parts, p } = x;
  const cx = o.cx ?? 0;
  const cz = o.cz ?? 0;
  const style = o.style ?? 'dome';
  box(parts, w + 1.2, 1.3, d + 1.2, shade(p.wall, 0.92), p.wallLo).translate(cx, baseY + 0.6, cz);
  const pw = w + 2.2;
  const pd = d + 2.2;
  for (const s of [-1, 1]) {
    box(parts, pw, 2.4, 1.1, p.wall, p.wallLo).translate(cx, baseY + 1.9, cz + s * (pd / 2 - 0.55));
    box(parts, 1.1, 2.4, pd - 2.2, p.wall, p.wallLo).translate(cx + s * (pw / 2 - 0.55), baseY + 1.9, cz);
  }
  if (style === 'vault') {
    // half the barrel hides inside the hall — never let it poke through the ground
    const r = Math.min(Math.min(w, d) * 0.32, baseY + 0.9);
    const v = new THREE.CylinderGeometry(r, r, Math.max(w, d) * 0.82, 8, 1);
    if (w >= d) v.rotateZ(Math.PI / 2);
    else v.rotateX(Math.PI / 2);
    paint(v, p.roofHi, p.roofLo);
    v.translate(cx, baseY + 1.2, cz);
    parts.push(v);
    return baseY + 1.2 + r;
  }
  if (style === 'flat') return baseY + 3.1;
  const R = Math.min(o.domeR ?? Math.min(w, d) * 0.34, (baseY + 0.8) / 0.85);
  const big = R > 12;
  const dm = ball(parts, R, big ? 10 : 8, big ? 6 : 5, p.roofHi, p.roofLo);
  dm.scale(1, 0.85, 1);
  dm.translate(cx, baseY + 1.1, cz);
  return finialOn(x, cx, baseY + 1.1 + R * 0.85, cz, big ? 1.5 : 1);
}

/** Bronze spike-on-post dome finial — the ashari motif, reused on minarets and gates. */
function finialOn(x: Ctx, cx: number, y: number, cz: number, s = 1): number {
  cyl(x.parts, 0.3 * s, 0.42 * s, 2.0 * s, 5, x.p.trim, x.p.trimLo, true).translate(cx, y + 0.7 * s, cz);
  cone(x.parts, 0.55 * s, 2.0 * s, 4, x.p.trim, x.p.trimLo, true).translate(cx, y + 2.6 * s, cz);
  return y + 3.6 * s;
}

/** The culture roof dispatch — every massing recipe crowns itself through this. */
function roofOn(x: Ctx, w: number, d: number, baseY: number, o: RoofOpts = {}): number {
  if (x.c === 'valen') return gableOn(x, w, d, baseY, o);
  if (x.c === 'norvik') return sodOn(x, w, d, baseY, o);
  return domeOn(x, w, d, baseY, o);
}

/** Wall motif: valen timber cross-bracing; norvik wale beam + heavy door posts; ashari stays plaster. */
function motifOn(x: Ctx, w: number, d: number, wallH: number, cx = 0, cz = 0): void {
  const { parts, p } = x;
  const zf = cz + d / 2 + 0.25;
  if (x.c === 'valen') {
    for (const s of [-1, 1]) {
      box(parts, 1.0, wallH, 1.0, p.beam, p.beamLo).translate(
        cx + s * (w / 2 - 0.5),
        wallH / 2,
        cz + d / 2 - 0.2,
      );
      const br = box(parts, 0.8, wallH * 0.8, 0.45, p.beam, p.beamLo);
      br.rotateZ(s * 0.62);
      br.translate(cx + s * w * 0.22, wallH * 0.52, zf);
    }
    box(parts, w * 0.92, 0.8, 0.45, p.beam, p.beamLo).translate(cx, wallH - 0.7, zf);
  } else if (x.c === 'norvik') {
    box(parts, w * 0.96, 1.1, 0.5, p.beamLo, shade(p.beamLo, 0.8)).translate(cx, wallH * 0.55, zf);
    for (const s of [-1, 1]) {
      const post = box(parts, 1.3, wallH + 0.8, 1.3, p.beam, p.beamLo);
      post.translate(cx + s * (w / 2 - 0.65), (wallH + 0.8) / 2, cz + d / 2);
    }
  }
}

interface DoorOpts {
  w?: number;
  h?: number;
  cx?: number;
  banner?: boolean;
}

/** Dark doorway on a +Z face: opening, culture frame (ashari pointed arch), tintable cloth above. */
function doorway(x: Ctx, z: number, o: DoorOpts = {}): void {
  const { parts, p } = x;
  const dw = o.w ?? 5.5;
  const dh = o.h ?? 7.5;
  const cx = o.cx ?? 0;
  box(parts, dw, dh, 1.6, DARK, DARK_LO).translate(cx, dh / 2, z - 0.4);
  for (const s of [-1, 1]) {
    box(parts, 1.0, dh + 1.0, 1.2, p.beam, p.beamLo).translate(
      cx + s * (dw / 2 + 0.5),
      (dh + 1.0) / 2,
      z + 0.15,
    );
  }
  let bannerY = dh + 3.4;
  if (x.c === 'ashari') {
    const arch = cone(parts, dw * 0.75, dw * 0.55, 4, shade(p.wall, 0.85), p.wallLo);
    arch.rotateY(Math.PI / 4);
    arch.translate(cx, dh + dw * 0.27, z - 0.25);
    bannerY = dh + dw * 0.55 + 2.0;
  } else {
    box(parts, dw + 2.4, 1.1, 1.3, p.beam, p.beamLo).translate(cx, dh + 0.55, z + 0.15);
  }
  if (o.banner ?? true) {
    box(parts, dw * 0.8, 3.0, 0.5, BANNER, BANNER_LO).translate(cx, bannerY, z + 0.3);
    box(parts, dw * 0.95, 0.55, 0.7, p.trim, p.trimLo).translate(cx, bannerY + 1.75, z + 0.3);
  }
}

interface HallOpts extends RoofOpts {
  /** Door width, or false for a blind wall. */
  door?: number | false;
  doorH?: number;
  banner?: boolean;
  motif?: boolean;
  wall?: number;
  wallLo?: number;
}

/** The workhorse massing: rectangular walls + culture roof + motif + doorway. Returns roof-top y. */
function hallOn(x: Ctx, w: number, d: number, wallH: number, o: HallOpts = {}): number {
  const cx = o.cx ?? 0;
  const cz = o.cz ?? 0;
  box(x.parts, w, wallH, d, o.wall ?? x.p.wall, o.wallLo ?? x.p.wallLo).translate(cx, wallH / 2, cz);
  const top = roofOn(x, w, d, wallH, o);
  if (o.motif ?? true) motifOn(x, w, d, wallH, cx, cz);
  if (o.door !== false) {
    doorway(x, cz + d / 2, {
      w: o.door ?? 5.5,
      h: o.doorH ?? Math.min(7.5, wallH - 1.5),
      cx,
      banner: o.banner ?? true,
    });
  }
  return top;
}

/** Open-sided work shelter: four beam posts under a culture roof (ashari gets a flat awning deck). */
function shedOn(x: Ctx, w: number, d: number, h: number, o: RoofOpts = {}): number {
  const cx = o.cx ?? 0;
  const cz = o.cz ?? 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(x.parts, 1.4, h, 1.4, x.p.beam, x.p.beamLo).translate(
        cx + sx * (w / 2 - 0.7),
        h / 2,
        cz + sz * (d / 2 - 0.7),
      );
    }
  }
  return roofOn(x, w, d, h, { style: 'flat', ...o });
}

/** Packed-earth work yard — grounds a compound and honestly claims its footprint. */
function padOn(x: Ctx, w: number, d: number, t = 0.8, col?: number, cx = 0, cz = 0): void {
  const c = col ?? x.p.pad;
  box(x.parts, w, t, d, c, shade(c, 0.82)).translate(cx, t / 2, cz);
}

/** Banner pole: tapered staff, near-white flag (the tint element), trim finial. Returns tip y. */
function standardOn(x: Ctx, cx: number, cz: number, h: number, flagW = 5): number {
  cyl(x.parts, 0.35, 0.5, h, 5, x.p.beam, x.p.beamLo, true).translate(cx, h / 2, cz);
  box(x.parts, flagW, flagW * 0.62, 0.4, BANNER, BANNER_LO).translate(
    cx + flagW / 2 + 0.3,
    h - flagW * 0.33,
    cz,
  );
  cone(x.parts, 0.5, 1.4, 4, x.p.trim, x.p.trimLo, true).translate(cx, h + 0.7, cz);
  return h + 1.4;
}

/** A row of dark window openings across a +Z face. */
function windowRow(
  x: Ctx,
  n: number,
  w: number,
  h: number,
  y: number,
  z: number,
  spread: number,
  cx = 0,
): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    box(x.parts, w, h, 0.7, 0x342f28, 0x231f1a).translate(cx + t * spread, y, z);
  }
}

// ---------------------------------------------------------------- recipes

// house (1×1 cell) — humble and quiet: one small hall, door, cloth. Repeats in dozens.
// tris: valen 192 / norvik 204 / ashari 218 (≤600)
function houseGeo(x: Ctx): void {
  hallOn(x, 28, 24, 9.5, { door: 5, axis: 'x' });
}

// townCenter (3×3) — THE seat of power: great hall, two wings, porch, and the tall banner mast.
// tris: valen 438 / norvik 522 / ashari 588 (≤900)
function townCenterGeo(x: Ctx): void {
  padOn(x, 116, 116, 0.8);
  hallOn(x, 62, 46, 15, { cz: -14, door: 8, doorH: 9, banner: false, axis: 'x', domeR: 14 });
  for (const s of [-1, 1]) {
    hallOn(x, 24, 30, 10, { cx: s * 34, cz: -18, door: false, motif: false, axis: 'z', style: 'vault' });
  }
  // porch: four posts under a shallow sloped slab, spanning the entrance
  for (const sx of [-1, 1]) {
    for (const zi of [10, 20]) {
      box(x.parts, 1.3, 10, 1.3, x.p.beam, x.p.beamLo).translate(sx * 12, 5, zi);
    }
  }
  const slab = box(x.parts, 30, 1.2, 16, x.p.roofHi, x.p.roofLo);
  slab.rotateX(0.16);
  slab.translate(0, 11.2, 15);
  // twin door standards and the great mast
  for (const s of [-1, 1]) standardOn(x, s * 20, 26, 16, 4);
  standardOn(x, 34, 26, 46, 7);
}

// farm (2×2) — mostly FIELD: tilled pad, six crop furrows, corner shed, fence, scarecrow.
// tris: valen 324 / norvik 360 / ashari 332 (≤600)
function farmGeo(x: Ctx): void {
  padOn(x, 78, 78, 0.7, SOIL);
  for (let i = 0; i < 6; i++) {
    const row = box(x.parts, 64, 1.2, 4.4, x.p.crop, x.p.cropLo);
    row.rotateY((x.r() - 0.5) * 0.05);
    row.translate(-3, 1.1, -28 + i * 9.4);
  }
  hallOn(x, 18, 14, 7, { cx: 26, cz: 28, door: 4.5, banner: false, motif: false, axis: 'x', style: 'flat' });
  // front fence with a gap for the lane
  for (const fx of [-32, -22, -12, 14, 24, 34]) {
    box(x.parts, 1.0, 4.2, 1.0, x.p.beam, x.p.beamLo).translate(fx, 2.1, 37.5);
  }
  box(x.parts, 24, 0.8, 0.8, x.p.beam, x.p.beamLo).translate(-22, 3.6, 37.5);
  box(x.parts, 22, 0.8, 0.8, x.p.beam, x.p.beamLo).translate(24, 3.6, 37.5);
  // scarecrow: cross of beams under a light rag — the farm's tintable cloth
  box(x.parts, 0.9, 11, 0.9, x.p.beam, x.p.beamLo).translate(-24, 5.5, 20);
  box(x.parts, 7, 0.9, 0.9, x.p.beam, x.p.beamLo).translate(-24, 8.6, 20);
  box(x.parts, 4.2, 4.6, 0.7, BANNER, BANNER_LO).translate(-24, 7.4, 20.5);
}

// lumberCamp (2×1) — open-sided saw shelter, log pile, buck frame; work reads from the yard.
// tris: valen 302 / norvik 338 / ashari 314 (≤600)
function lumberCampGeo(x: Ctx): void {
  padOn(x, 80, 38, 0.6);
  shedOn(x, 30, 22, 9, { cx: -21, axis: 'x' });
  // log pile: 2+1 stack plus one leaner, bark-dark cylinders with pale cut ends
  const logCol = shade(x.p.beam, 1.15);
  const spots: [number, number, number][] = [
    [24, 2.5, -6],
    [24, 2.5, -0.6],
    [24, 6.2, -3.2],
  ];
  for (const [lx, ly, lz] of spots) {
    const lg = cyl(x.parts, 2.1, 2.1, 26, 6, logCol, x.p.beamLo);
    lg.rotateZ(Math.PI / 2);
    lg.rotateY((x.r() - 0.5) * 0.06);
    lg.translate(lx, ly, lz);
  }
  const leaner = cyl(x.parts, 1.7, 1.7, 22, 6, logCol, x.p.beamLo);
  leaner.rotateZ(Math.PI / 2);
  leaner.rotateY(0.5);
  leaner.translate(18, 1.8, 10);
  // saw-buck: two X-frames carrying a half-cut log
  for (const s of [-1, 1]) {
    for (const a of [-1, 1]) {
      const leg = box(x.parts, 0.9, 8, 0.9, x.p.beam, x.p.beamLo);
      leg.rotateZ(a * 0.5);
      leg.translate(-14 + s * 5, 3.6, 12);
    }
  }
  const cut = cyl(x.parts, 1.5, 1.5, 16, 6, logCol, x.p.beamLo);
  cut.rotateZ(Math.PI / 2);
  cut.translate(-14, 6.8, 12);
  standardOn(x, -36, 12, 13, 3.6);
}

// quarry (2×2) — the dark pit, a ramp down, cut blocks, and the hoist arm with hanging stone.
// tris: 212 for every culture (≤600)
function quarryGeo(x: Ctx): void {
  padOn(x, 76, 76, 0.9, x.p.stoneLo);
  box(x.parts, 32, 0.5, 28, 0x2f2a24, 0x231f1a).translate(-12, 0.95, -8);
  const ramp = box(x.parts, 11, 1.2, 22, shade(x.p.stone, 0.88), x.p.stoneLo);
  ramp.rotateX(-0.24);
  ramp.translate(-12, 3.3, 14);
  // cut blocks, hash-jittered so no two quarries stack alike
  for (let i = 0; i < 7; i++) {
    const s = 4.5 + x.r() * 3.5;
    const bx = 16 + x.r() * 14;
    const bz = -24 + x.r() * 48;
    const blk = box(x.parts, s, 3.2 + x.r() * 2.6, s * (0.8 + x.r() * 0.4), x.p.stone, x.p.stoneLo);
    blk.rotateY(x.r() * 0.6);
    blk.translate(bx, 2.5, bz);
  }
  box(x.parts, 7, 4, 6, x.p.stone, x.p.stoneLo).translate(-28, 2.8, 24);
  // hoist: mast, jib over the pit, tie-back, rope and a hanging block
  cyl(x.parts, 0.9, 1.1, 20, 5, x.p.beam, x.p.beamLo).translate(4, 10, 6);
  const jib = box(x.parts, 1.3, 1.3, 18, x.p.beam, x.p.beamLo);
  jib.translate(4, 19, -2);
  const stay = box(x.parts, 0.5, 12, 0.5, x.p.beamLo, shade(x.p.beamLo, 0.8));
  stay.rotateX(0.62);
  stay.translate(4, 15.5, 1.5);
  box(x.parts, 0.28, 8.5, 0.28, DARK, DARK_LO).translate(4, 13.5, -10);
  box(x.parts, 3.6, 3.2, 3.6, x.p.stone, x.p.stoneLo).translate(4, 7.6, -10);
  // pennant at the mast head — the quarry's tint element
  box(x.parts, 3.4, 2.2, 0.4, BANNER, BANNER_LO).translate(6.2, 19.2, 6);
}

// market (2×2) — four awning stalls around a lane, culture-roofed booth at back, well at front.
// tris: valen 468 / norvik 504 / ashari 554 (≤600)
function marketGeo(x: Ctx): void {
  padOn(x, 76, 76, 0.8);
  const awnCol = [BANNER, x.p.roof, x.p.trim, shade(x.p.wall, 1.08)];
  const awnLo = [BANNER_LO, x.p.roofLo, x.p.trimLo, x.p.wallLo];
  const spots: [number, number, number][] = [
    [-22, -14, 1],
    [22, -14, -1],
    [-22, 12, 1],
    [22, 12, -1],
  ];
  spots.forEach(([sx, sz, face], i) => {
    box(x.parts, 13, 3.4, 8, x.p.beam, x.p.beamLo).translate(sx, 1.7, sz);
    for (const s of [-1, 1]) {
      box(x.parts, 1.0, 9, 1.0, x.p.beam, x.p.beamLo).translate(sx + s * 6, 4.5, sz - face * 4.5);
    }
    const awn = box(x.parts, 15, 0.8, 11, awnCol[i], awnLo[i]);
    awn.rotateX(face * 0.24);
    awn.translate(sx, 8.6, sz);
    // goods: two crates per counter
    box(x.parts, 2.6, 2.2, 2.6, shade(x.p.beam, 1.2), x.p.beamLo).translate(sx - 3, 4.5, sz + face * 1.2);
    box(x.parts, 2.2, 1.8, 2.2, x.p.crop, x.p.cropLo).translate(sx + 2.5, 4.3, sz - face * 0.8);
  });
  hallOn(x, 16, 12, 6.5, { cz: -30, door: 4.5, banner: false, motif: false, axis: 'x', domeR: 4.6 });
  // the well: stone ring, two posts, tiny culture-colored cap
  cyl(x.parts, 3.4, 3.8, 2.8, 6, x.p.stone, x.p.stoneLo).translate(0, 1.4, 28);
  for (const s of [-1, 1]) box(x.parts, 0.8, 6, 0.8, x.p.beam, x.p.beamLo).translate(s * 3, 3, 28);
  prism(x.parts, 9, 2.4, 4, x.p.roofHi, x.p.roofLo).translate(0, 6, 28);
}

// storehouse (2×2) — fat and windowless, one wide loading door, barrels and crates outside.
// tris: valen 336 / norvik 348 / ashari 398 (≤600)
function storehouseGeo(x: Ctx): void {
  hallOn(x, 60, 52, 12, { door: 9, doorH: 8.5, axis: 'x' });
  for (let i = 0; i < 5; i++) {
    const bx = -24 + i * 6.5 + (x.r() - 0.5) * 2;
    cyl(x.parts, 2.1, 2.3, 5, 6, shade(x.p.beam, 1.25), x.p.beamLo).translate(
      bx,
      2.5,
      29.5 + (x.r() - 0.5) * 2,
    );
  }
  box(x.parts, 4.5, 4, 4.5, shade(x.p.beam, 1.15), x.p.beamLo).translate(22, 2, 29.5);
  box(x.parts, 3.4, 3, 3.4, shade(x.p.beam, 1.15), x.p.beamLo).translate(22, 5.5, 29.5);
}

// granary (2×2) — the store raised on staddle stones against vermin, ladder up to the door.
// tris: valen 360 / norvik 372 / ashari 426 (≤600)
function granaryGeo(x: Ctx): void {
  padOn(x, 70, 70, 0.6);
  // six pyramid staddles with square caps carry the floor
  for (const sx of [-16, 0, 16]) {
    for (const sz of [-11, 11]) {
      cone(x.parts, 2.6, 4.6, 4, x.p.stone, x.p.stoneLo).translate(sx, 2.9, sz);
      box(x.parts, 4.2, 1.1, 4.2, shade(x.p.stone, 1.1), x.p.stoneLo).translate(sx, 5.3, sz);
    }
  }
  box(x.parts, 50, 1.4, 40, x.p.beam, x.p.beamLo).translate(0, 6.4, 0);
  box(x.parts, 46, 8.5, 36, x.p.wall, x.p.wallLo).translate(0, 11.35, 0);
  roofOn(x, 46, 36, 15.6, { axis: 'x' });
  motifOn(x, 46, 36, 8.5, 0, 0);
  // raised door + cloth, and the ladder down to the yard
  box(x.parts, 4.5, 5.5, 1.2, DARK, DARK_LO).translate(0, 10.2, 18.4);
  box(x.parts, 3.8, 2.6, 0.5, BANNER, BANNER_LO).translate(0, 15, 18.6);
  for (const s of [-1, 1]) {
    const rail = box(x.parts, 0.6, 12.5, 0.6, x.p.beam, x.p.beamLo);
    rail.rotateX(0.42);
    rail.translate(s * 1.7, 5.8, 21.6);
  }
  for (let i = 0; i < 4; i++) {
    box(x.parts, 3.6, 0.5, 0.6, x.p.beam, x.p.beamLo).translate(0, 1.6 + i * 2.6, 24.3 - i * 1.18);
  }
}

// temple (2×3) — vertical aspiration, fully culture-forked: valen spired tower, norvik tiered
// stave hall, ashari great dome with a minaret. Nave runs along Z, doors at +Z, steps below.
// tris: valen 328 / norvik 408 / ashari 392 (≤600)
function templeGeo(x: Ctx): void {
  const { parts, p } = x;
  box(parts, 30, 1.6, 10, p.stone, p.stoneLo).translate(0, 0.8, 43);
  box(parts, 24, 3.2, 8, p.stone, p.stoneLo).translate(0, 1.6, 38);
  if (x.c === 'valen') {
    hallOn(x, 54, 76, 17, { cz: -14, axis: 'z', door: false, motif: false });
    for (const s of [-1, 1]) {
      for (const bz of [-38, -14, 8]) {
        const but = box(parts, 2.6, 13, 4.5, p.stone, p.stoneLo);
        but.rotateZ(s * 0.12);
        but.translate(s * 27.5, 6.5, bz);
      }
    }
    windowRow(x, 2, 2.4, 8, 10, 24.4, 34);
    box(parts, 20, 48, 20, p.wall, p.wallLo).translate(0, 24, 26);
    prism(parts, 22, 5, 22, p.roofHi, p.roofLo).translate(0, 48, 26);
    cone(parts, 10.5, 22, 8, p.roofHi, p.roofLo).translate(0, 64, 26);
    cone(parts, 1.1, 4.5, 4, p.trim, p.trimLo, true).translate(0, 77.3, 26);
    cyl(parts, 3.4, 3.4, 1.2, 8, p.trim, p.trimLo)
      .rotateX(Math.PI / 2)
      .translate(0, 27, 36.2);
    doorway(x, 36, { w: 7, h: 9 });
  } else if (x.c === 'norvik') {
    hallOn(x, 54, 76, 13, { cz: -14, axis: 'z', door: false, motif: false, pitch: 0.16 });
    box(parts, 32, 11, 52, p.wall, p.wallLo).translate(0, 19, -16);
    sodOn(x, 32, 52, 24.5, { cz: -16, axis: 'z', pitch: 0.16 });
    box(parts, 17, 9, 30, p.wall, p.wallLo).translate(0, 30, -18);
    sodOn(x, 17, 30, 34.5, { cz: -18, axis: 'z', pitch: 0.18 });
    for (const s of [-1, 1]) {
      box(parts, 1.6, 15, 1.6, p.beam, p.beamLo).translate(s * 10, 7.5, 25.5);
    }
    doorway(x, 24, { w: 7, h: 9 });
  } else {
    hallOn(x, 54, 76, 16, { cz: -14, axis: 'z', door: false, motif: false, style: 'flat' });
    cyl(parts, 16, 17.5, 6, 10, p.wall, p.wallLo).translate(0, 19, -20);
    const dome = ball(parts, 16, 10, 6, p.roofHi, p.roofLo);
    dome.scale(1, 0.85, 1);
    dome.translate(0, 22, -20);
    finialOn(x, 0, 35.6, -20, 1.6);
    cyl(parts, 2.9, 3.4, 36, 6, p.wall, p.wallLo).translate(21, 18, 20);
    cyl(parts, 4.2, 4.2, 1.6, 6, p.trim, p.trimLo).translate(21, 36.5, 20);
    cone(parts, 3.4, 4.5, 6, p.roofHi, p.roofLo).translate(21, 39.5, 20);
    finialOn(x, 21, 41.7, 20, 0.9);
    doorway(x, 24, { w: 7, h: 9 });
  }
}

// university (3×3) — a cloister: three ranges around an open court, tall windows, front gate.
// tris: valen 396 / norvik 504 / ashari 588 (≤600)
function universityGeo(x: Ctx): void {
  padOn(x, 112, 112, 0.7);
  hallOn(x, 96, 24, 14, { cz: -40, door: false, motif: false, axis: 'x', domeR: 9 });
  for (const s of [-1, 1]) {
    hallOn(x, 24, 62, 12, { cx: s * 40, cz: -3, door: false, motif: false, axis: 'z', style: 'vault' });
  }
  windowRow(x, 5, 2.4, 8, 8, -27.6, 72);
  for (const s of [-1, 1]) windowRow(x, 3, 2.2, 6.5, 7, 25.2, 40, s * 40);
  // low front wall with the gate: posts, lintel, cloth
  for (const s of [-1, 1]) {
    box(x.parts, 36, 5.5, 2.6, x.p.wall, x.p.wallLo).translate(s * 26, 2.75, 34);
    box(x.parts, 2.2, 10.5, 3.2, x.p.stone, x.p.stoneLo).translate(s * 7, 5.25, 34);
  }
  box(x.parts, 16.5, 2.2, 3.0, x.p.stone, x.p.stoneLo).translate(0, 11.2, 34);
  if (x.c === 'ashari') finialOn(x, 0, 12.3, 34, 0.9);
  box(x.parts, 10, 4.2, 0.6, BANNER, BANNER_LO).translate(0, 8.4, 35.6);
}

// guildhall (2×2) — the market's rich sibling: jettied upper floor, window row, hanging sign.
// tris: valen 288 / norvik 300 / ashari 350 (≤600)
function guildhallGeo(x: Ctx): void {
  box(x.parts, 56, 10, 48, shade(x.p.wall, 0.9), x.p.wallLo).translate(0, 5, 0);
  box(x.parts, 60, 1.8, 52, x.p.beam, x.p.beamLo).translate(0, 10.9, 0);
  box(x.parts, 60, 9, 52, x.p.wall, x.p.wallLo).translate(0, 16.3, 0);
  roofOn(x, 60, 52, 20.8, { axis: 'x' });
  motifOn(x, 56, 48, 10, 0, 0);
  windowRow(x, 4, 2.6, 4.5, 16.5, 26.4, 40);
  doorway(x, 24, { w: 7, h: 8.5 });
  // the guild sign: bracket arm and a light board swinging over the street
  box(x.parts, 0.8, 0.8, 5, x.p.trim, x.p.trimLo).translate(19, 14.5, 27.5);
  box(x.parts, 4.4, 3.6, 0.6, BANNER, BANNER_LO).translate(19, 11.6, 29);
}

// keep (3×3) — military mass: battered plinth, blind central block, four crenellated drum
// turrets with culture caps, gatehouse, arrow slits and the war banner over the gate.
// tris: valen 634 / norvik 602 / ashari 826 (≤900)
function keepGeo(x: Ctx): void {
  const { parts, p } = x;
  const body = x.c === 'norvik' ? p.wall : p.stone;
  const bodyLo = x.c === 'norvik' ? p.wallLo : p.stoneLo;
  box(parts, 96, 7, 96, shade(body, 0.85), bodyLo).translate(0, 3.5, 0);
  box(parts, 76, 35, 76, body, bodyLo).translate(0, 24.5, 0);
  box(parts, 80, 2.5, 80, shade(body, 1.08), bodyLo).translate(0, 43.25, 0);
  // merlon ring, three per side between the turrets
  for (const s of [-1, 1]) {
    for (const t of [-1, 0, 1]) {
      box(parts, 6, 3, 3, body, bodyLo).translate(t * 24, 46, s * 38.5);
      box(parts, 3, 3, 6, body, bodyLo).translate(s * 38.5, 46, t * 24);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cyl(parts, 8, 9, 44, 8, body, bodyLo).translate(sx * 38, 24, sz * 38);
      cyl(parts, 9.6, 9.6, 2.6, 8, shade(body, 1.08), bodyLo).translate(sx * 38, 47.3, sz * 38);
      if (x.c === 'valen') cone(parts, 9.2, 9, 8, p.roofHi, p.roofLo).translate(sx * 38, 53.1, sz * 38);
      else if (x.c === 'norvik') cone(parts, 8.6, 5, 4, p.roofHi, p.roofLo).translate(sx * 38, 51.1, sz * 38);
      else {
        const cap = ball(parts, 7.4, 8, 5, p.roofHi, p.roofLo);
        cap.scale(1, 0.8, 1);
        cap.translate(sx * 38, 48.6, sz * 38);
      }
    }
  }
  // gatehouse and the tall gate: dark arch, portcullis bars, banner high on the wall
  box(parts, 20, 17, 10, body, bodyLo).translate(0, 8.5, 43);
  box(parts, 9, 11, 2, DARK, DARK_LO).translate(0, 5.5, 47.5);
  for (const s of [-1, 1]) box(parts, 0.7, 11, 0.9, p.trim, p.trimLo).translate(s * 2.6, 5.5, 48);
  box(parts, 8, 12, 1.0, BANNER, BANNER_LO).translate(0, 30, 38.6);
  box(parts, 9.5, 1.1, 1.3, p.trim, p.trimLo).translate(0, 36.5, 38.7);
  windowRow(x, 3, 1.6, 5.5, 33, 38.2, 44);
  standardOn(x, 0, 0, 54, 6.5);
}

// palisade (2×1) — the buildable timber wall: a run of sharpened stakes, braced, with a
// gate of heavy posts and a light gate cloth. Norvik-kin by material, tinted per culture.
// tris: 300 for every culture (≤600)
function palisadeGeo(x: Ctx): void {
  const { parts, p } = x;
  const n = 16;
  const sw = 76 / n;
  for (let i = 0; i < n; i++) {
    if (i > 5 && i < 10) continue; // the gate opening
    const cx = -38 + (i + 0.5) * sw;
    const h = 13 + (i % 2) * 1.6 + (x.r() - 0.5) * 0.6;
    box(parts, sw, h, 3, p.beam, p.beamLo).translate(cx, h / 2, 0);
    const tip = cone(parts, sw * 0.66, 2.6, 4, p.beamLo, shade(p.beamLo, 0.8), true);
    tip.rotateY(Math.PI / 4);
    tip.translate(cx, h + 1.3, 0);
  }
  box(parts, 40, 1.2, 1.1, shade(p.beam, 1.15), p.beamLo).translate(-19.5, 9.5, -1.9);
  box(parts, 40, 1.2, 1.1, shade(p.beam, 1.15), p.beamLo).translate(19.5, 9.5, -1.9);
  for (const s of [-1, 1]) {
    box(parts, 2.6, 17, 3.4, p.beam, p.beamLo).translate(s * 8.5, 8.5, 0.4);
    const brace = box(parts, 1.4, 11, 1.4, p.beam, p.beamLo);
    brace.rotateX(-0.6);
    brace.translate(s * 24, 4.6, -3.4);
  }
  box(parts, 19.5, 2.2, 3.0, p.beam, p.beamLo).translate(0, 15.6, 0.4);
  box(parts, 13, 10.5, 1.4, DARK, DARK_LO).translate(0, 5.25, 0);
  box(parts, 9, 4.2, 0.6, BANNER, BANNER_LO).translate(0, 12.2, 1.6);
}

// stoneWall (2×1) — the buildable masonry wall: battered base, walk, merlons, end piers
// and an arched gate under a light cloth. Culture reads in the stone and the arch.
// tris: valen 216 / norvik 216 / ashari 226 (≤600)
function stoneWallGeo(x: Ctx): void {
  const { parts, p } = x;
  box(parts, 78, 3, 7, shade(p.stone, 0.85), p.stoneLo).translate(0, 1.5, 0);
  box(parts, 78, 8, 5.2, p.stone, p.stoneLo).translate(0, 7, 0);
  box(parts, 78, 1.2, 6, shade(p.stone, 1.1), p.stoneLo).translate(0, 11.6, 0);
  for (let i = 0; i < 10; i++) {
    if (i > 3 && i < 6) continue; // clear over the gate
    const cx = -39 + (i + 0.5) * 7.8;
    box(parts, 4.4, 2.4, 2.2, p.stone, p.stoneLo).translate(cx, 13.4, 1.2);
  }
  for (const s of [-1, 1]) box(parts, 7, 14.5, 7, p.stone, p.stoneLo).translate(s * 37, 7.25, 0);
  // the gate: dark opening through the full thickness, posts, culture arch, cloth
  box(parts, 11, 9.5, 7.4, DARK, DARK_LO).translate(0, 4.75, 0);
  for (const s of [-1, 1])
    box(parts, 1.6, 10.5, 6, shade(p.stone, 1.05), p.stoneLo).translate(s * 6.3, 5.25, 0);
  if (x.c === 'ashari') {
    const arch = cone(parts, 8, 5.5, 4, shade(p.stone, 1.05), p.stoneLo);
    arch.rotateY(Math.PI / 4);
    arch.translate(0, 12.2, 0);
    finialOn(x, 0, 14.9, 0, 0.8);
  } else {
    box(parts, 14.5, 1.8, 6.4, shade(p.stone, 1.05), p.stoneLo).translate(0, 11.2, 0);
  }
  box(parts, 8.5, 3.8, 0.6, BANNER, BANNER_LO).translate(0, 12.4, 3.2);
}

// barracks (3×3) — drill yard before the hall: weapon racks, a straw dummy, side fences.
// tris: valen 560 / norvik 572 / ashari 586 (≤600)
function barracksGeo(x: Ctx): void {
  padOn(x, 108, 108, 0.8);
  hallOn(x, 70, 34, 12, { cz: -32, door: 7, doorH: 8.5, axis: 'x', domeR: 10 });
  // two weapon racks: frame plus three leaning spears with steel heads
  for (const rx of [-30, -12]) {
    for (const s of [-1, 1]) box(x.parts, 1.0, 7, 1.0, x.p.beam, x.p.beamLo).translate(rx + s * 5, 3.5, 14);
    box(x.parts, 12, 1.0, 1.0, x.p.beam, x.p.beamLo).translate(rx, 6.6, 14);
    for (let i = 0; i < 3; i++) {
      const sp = box(x.parts, 0.5, 9, 0.5, shade(x.p.beam, 1.2), x.p.beamLo);
      sp.rotateX(0.22);
      sp.translate(rx - 3 + i * 3, 4.2, 13.2);
      cone(x.parts, 0.5, 1.4, 4, 0xb8bcc4, 0x878b94, true).translate(rx - 3 + i * 3, 9.4, 12.2);
    }
  }
  // the pell: post, crossbar, straw head, light practice tabard
  box(x.parts, 1.2, 9.5, 1.2, x.p.beam, x.p.beamLo).translate(22, 4.75, 10);
  box(x.parts, 7.5, 1.1, 1.1, x.p.beam, x.p.beamLo).translate(22, 7.6, 10);
  ball(x.parts, 1.6, 5, 4, x.p.crop, x.p.cropLo).translate(22, 10.2, 10);
  box(x.parts, 4.4, 4.2, 1.0, BANNER, BANNER_LO).translate(22, 5.4, 10.3);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      box(x.parts, 1.0, 4.5, 1.0, x.p.beam, x.p.beamLo).translate(s * 46, 2.25, 18 - i * 12);
    }
    box(x.parts, 1.0, 0.9, 26, x.p.beam, x.p.beamLo).translate(s * 46, 4.2, 6);
  }
  standardOn(x, 40, 34, 22, 5.5);
}

// archeryRange (3×2) — the shooting lane: shelter at one end, two straw butts with light
// target faces at the other, low rail between. Long axis X, pennant at the far end.
// tris: valen 330 / norvik 366 / ashari 342 (≤600)
function archeryRangeGeo(x: Ctx): void {
  padOn(x, 108, 58, 0.6);
  box(x.parts, 86, 0.5, 12, shade(x.p.pad, 1.18), x.p.pad).translate(2, 0.85, 0);
  shedOn(x, 20, 16, 8, { cx: -42, axis: 'z' });
  box(x.parts, 1.0, 3.4, 30, x.p.beam, x.p.beamLo).translate(-28, 1.7, 0);
  box(x.parts, 0.9, 0.9, 30, shade(x.p.beam, 1.15), x.p.beamLo).translate(-28, 3.8, 0);
  for (const s of [-1, 1]) {
    // butt: straw bale block, light target face (the tint element), trim peg, back prop
    box(x.parts, 4, 9.5, 9.5, x.p.crop, x.p.cropLo).translate(42, 4.75, s * 14);
    const face = cyl(x.parts, 3.6, 3.6, 1.2, 8, BANNER, BANNER_LO);
    face.rotateZ(Math.PI / 2);
    face.translate(39.2, 5.4, s * 14);
    const peg = cyl(x.parts, 1.1, 1.1, 0.9, 6, x.p.trim, x.p.trimLo);
    peg.rotateZ(Math.PI / 2);
    peg.translate(38.5, 5.4, s * 14);
    const prop = box(x.parts, 1.2, 10, 1.2, x.p.beam, x.p.beamLo);
    prop.rotateZ(-0.35);
    prop.translate(45.8, 4.6, s * 14);
  }
  standardOn(x, 50, 0, 13, 3.6);
}

// stable (3×2) — one long low hall, four dark stall mouths on the yard side, hay and
// trough in a fenced paddock. Ridge runs the length; entrance side faces +Z.
// tris: valen 348 / norvik 384 / ashari 392 (≤600)
function stableGeo(x: Ctx): void {
  hallOn(x, 96, 36, 9, { cz: -12, door: false, motif: false, axis: 'x', style: 'vault' });
  for (let i = 0; i < 4; i++) {
    const sx = -36 + i * 24;
    box(x.parts, 8, 6.5, 1.2, DARK, DARK_LO).translate(sx, 3.25, 6.2);
  }
  for (const sx of [-48, -24, 0, 24, 48]) {
    box(x.parts, 1.6, 8.5, 1.6, x.p.beam, x.p.beamLo).translate(sx, 4.25, 6.4);
  }
  box(x.parts, 5.5, 2.8, 0.5, BANNER, BANNER_LO).translate(-12, 8.7, 6.8);
  // paddock: rails, hay mounds, water trough
  for (const s of [-1, 1]) {
    box(x.parts, 1.1, 4.5, 1.1, x.p.beam, x.p.beamLo).translate(s * 46, 2.25, 30);
    box(x.parts, 1.1, 4.5, 1.1, x.p.beam, x.p.beamLo).translate(s * 46, 2.25, 18);
    box(x.parts, 1.0, 0.9, 13, x.p.beam, x.p.beamLo).translate(s * 46, 3.9, 24);
  }
  box(x.parts, 92, 0.9, 1.0, x.p.beam, x.p.beamLo).translate(0, 3.9, 30.5);
  for (const [hx, hr] of [
    [30, 4.4],
    [37, 3.2],
  ]) {
    const hay = ball(x.parts, hr, 6, 4, x.p.crop, x.p.cropLo);
    hay.scale(1, 0.72, 1);
    hay.translate(hx, hr * 0.7, 22);
  }
  box(x.parts, 9, 2.6, 3.6, x.p.beam, x.p.beamLo).translate(-30, 1.3, 22);
}

// wonder (4×4, ≤2000) — three genuinely different landmarks on one plinth size.
// tris: valen 670 / norvik 732 / ashari 936
function wonderGeo(x: Ctx): void {
  if (x.c === 'valen') wonderValen(x);
  else if (x.c === 'norvik') wonderNorvik(x);
  else wonderAshari(x);
}

// valen wonder — the cathedral: cross plan, steep crossing roofs, twin front towers,
// crossing spire to ~96 wu, buttresses, rose window, gold finials, twin door banners.
function wonderValen(x: Ctx): void {
  const { parts, p } = x;
  box(parts, 140, 1.6, 140, p.stone, p.stoneLo).translate(0, 0.8, 0);
  box(parts, 126, 3.4, 126, shade(p.stone, 1.06), p.stoneLo).translate(0, 1.7, 0);
  box(parts, 46, 26, 106, p.wall, p.wallLo).translate(0, 16, -6);
  box(parts, 96, 24, 34, p.wall, p.wallLo).translate(0, 15, -18);
  prism(parts, 112, 26, 52, p.roofHi, p.roofLo)
    .rotateY(Math.PI / 2)
    .translate(0, 29, -6);
  prism(parts, 100, 22, 40, p.roofHi, p.roofLo).translate(0, 27, -18);
  // crossing tower and spire
  box(parts, 26, 36, 26, p.wall, p.wallLo).translate(0, 44, -18);
  cone(parts, 15, 34, 8, p.roofHi, p.roofLo).translate(0, 79, -18);
  cone(parts, 1.5, 6, 4, p.trim, p.trimLo, true).translate(0, 96.5, -18);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cone(parts, 2.2, 7, 4, p.roofHi, p.roofLo).translate(sx * 11, 63, -18 + sz * 11);
    }
  }
  // twin front towers with gold-tipped cones
  for (const s of [-1, 1]) {
    box(parts, 15, 42, 15, p.wall, p.wallLo).translate(s * 21, 21, 42);
    cone(parts, 9.5, 16, 8, p.roofHi, p.roofLo).translate(s * 21, 50, 42);
    cone(parts, 1.0, 4, 4, p.trim, p.trimLo, true).translate(s * 21, 60, 42);
    windowRow(x, 1, 2.6, 9, 26, 49.9, 0, s * 21);
  }
  for (const s of [-1, 1]) {
    for (const bz of [-44, -24, 8, 28]) {
      const but = box(parts, 3, 18, 5, p.stone, p.stoneLo);
      but.rotateZ(s * 0.12);
      but.translate(s * 24, 10, bz);
      cone(parts, 1.7, 5, 4, p.stone, p.stoneLo).translate(s * 25.3, 21, bz);
    }
  }
  windowRow(x, 4, 2.6, 10, 14, 17.4, 72);
  // portico: five columns on the upper step under an architrave and sloped slab
  for (let i = 0; i < 5; i++) {
    cyl(parts, 0.9, 1.0, 9, 5, p.stone, p.stoneLo, true).translate(-14 + i * 7, 7.9, 55);
  }
  box(parts, 36, 1.8, 4, p.stone, p.stoneLo).translate(0, 13.3, 55);
  const porch = box(parts, 38, 1.1, 9, p.roofHi, p.roofLo);
  porch.rotateX(0.14);
  porch.translate(0, 14.8, 52.5);
  // gold cross at the nave's front gable apex
  box(parts, 0.9, 4.5, 0.9, p.trim, p.trimLo).translate(0, 57.5, 50);
  box(parts, 3, 0.9, 0.9, p.trim, p.trimLo).translate(0, 58.2, 50);
  const rose = cyl(parts, 5.5, 5.5, 1.2, 8, p.trim, p.trimLo);
  rose.rotateX(Math.PI / 2);
  rose.translate(0, 30, 47.2);
  box(parts, 12, 1.2, 8, p.stone, p.stoneLo).translate(0, 3.9, 49);
  doorway(x, 47.5, { w: 8, h: 11, banner: false });
  for (const s of [-1, 1]) {
    box(parts, 5, 14, 0.8, BANNER, BANNER_LO).translate(s * 10, 24, 47.8);
    box(parts, 6, 1.1, 1.0, p.trim, p.trimLo).translate(s * 10, 31.5, 47.8);
  }
}

// norvik wonder — the great carved hall: tiered sod roofs, four prow beams sweeping up,
// carved post porch, a row of round shields, iron-capped crossed beams to ~56 wu.
function wonderNorvik(x: Ctx): void {
  const { parts, p } = x;
  box(parts, 132, 2.2, 132, p.stone, p.stoneLo).translate(0, 1.1, 0);
  box(parts, 60, 18, 110, p.wall, p.wallLo).translate(0, 11.2, 0);
  sodOn(x, 60, 110, 29.2, { axis: 'z', pitch: 0.24, ov: 4 });
  box(parts, 34, 12, 82, p.wall, p.wallLo).translate(0, 33, 0);
  sodOn(x, 34, 82, 45, { axis: 'z', pitch: 0.24, ov: 3 });
  // prow beams: paired sweeps at both gable ends of the upper tier
  for (const e of [-1, 1]) {
    for (const lean of [0.42, 0.85]) {
      const prow = box(parts, 1.8, 16, 2.6, p.beam, p.beamLo);
      prow.rotateX(e * lean);
      prow.translate(0, 51, e * (41 + lean * 8));
    }
    cone(parts, 1.4, 4, 4, p.trim, p.trimLo).translate(0, 58.5, e * 44.5);
  }
  // carved porch: six great posts under a low roof slab before the doors
  for (const s of [-1, 1]) {
    for (const pz of [58, 64]) {
      box(parts, 2.2, 13, 2.2, p.beam, p.beamLo).translate(s * 12, 6.5, pz);
      cone(parts, 1.6, 2.6, 4, p.trim, p.trimLo).translate(s * 12, 14.3, pz);
    }
  }
  const slab = box(parts, 32, 1.4, 14, p.roofHi, p.roofLo);
  slab.rotateX(0.14);
  slab.translate(0, 14.6, 61);
  // shield row along the front wall: alternating light (tintable) and iron-dark rounds
  for (let i = 0; i < 6; i++) {
    const sc = i % 2 === 0 ? BANNER : shade(p.trim, 1.5);
    const scLo = i % 2 === 0 ? BANNER_LO : p.trim;
    const sh = cyl(parts, 2.6, 2.6, 0.8, 6, sc, scLo);
    sh.rotateX(Math.PI / 2);
    sh.translate(-20 + i * 8, 13, 55.6);
  }
  // carved flank posts marching down both eaves
  for (const s of [-1, 1]) {
    for (const pz of [-36, -18, 0, 18, 36]) {
      box(parts, 2.0, 15, 2.0, p.beam, p.beamLo).translate(s * 31.5, 7.5, pz);
    }
  }
  // smoke louver astride the upper ridge
  box(parts, 5, 2.5, 9, p.wall, p.wallLo).translate(0, 55.4, 0);
  prism(parts, 11, 2, 7, p.roofHi, p.roofLo)
    .rotateY(Math.PI / 2)
    .translate(0, 56.6, 0);
  box(parts, 24, 1.6, 10, p.stone, p.stoneLo).translate(0, 3, 58);
  doorway(x, 55, { w: 9, h: 10.5 });
}

// ashari wonder — the grand observatory: stepped platform, great drum and dome with the
// dark viewing slit, bronze frieze, four dome-capped minarets, pylon gate to ~78 wu.
function wonderAshari(x: Ctx): void {
  const { parts, p } = x;
  box(parts, 140, 2.0, 140, p.stone, p.stoneLo).translate(0, 1, 0);
  box(parts, 122, 2.6, 122, shade(p.stone, 1.06), p.stoneLo).translate(0, 2.3, 0);
  cyl(parts, 30, 33, 27, 12, p.wall, p.wallLo).translate(0, 17.1, -8);
  cyl(parts, 31, 31, 3, 12, p.trim, p.trimLo).translate(0, 30, -8);
  const dome = ball(parts, 28, 12, 7, p.roofHi, p.roofLo);
  dome.scale(1, 0.88, 1);
  dome.translate(0, 31.5, -8);
  // the viewing slit: a dark channel from apex down the +Z flank, bronze-rimmed
  const slit = box(parts, 4, 26, 3.5, 0x232733, 0x161a24);
  slit.rotateX(0.62);
  slit.translate(0, 47, 7);
  const rim = box(parts, 5.4, 27, 1.2, p.trim, p.trimLo);
  rim.rotateX(0.62);
  rim.translate(0, 46.2, 5.4);
  finialOn(x, 0, 56.2, -8, 2.2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cyl(parts, 3.6, 4.4, 48, 6, p.wall, p.wallLo).translate(sx * 52, 24, sz * 52);
      cyl(parts, 5.2, 5.2, 1.6, 6, p.trim, p.trimLo).translate(sx * 52, 48.8, sz * 52);
      const cap = ball(parts, 4.6, 6, 4, p.roofHi, p.roofLo);
      cap.scale(1, 0.85, 1);
      cap.translate(sx * 52, 50, sz * 52);
      finialOn(x, sx * 52, 53.9, sz * 52, 0.8);
    }
  }
  // the pylon gate: two piers, lintel, pointed arch, gate cloth and stairs
  for (const s of [-1, 1]) box(parts, 9, 20, 7, p.wall, p.wallLo).translate(s * 12, 10, 44);
  box(parts, 34, 4.5, 7.5, p.wall, p.wallLo).translate(0, 22.25, 44);
  const arch = cone(parts, 9, 6.5, 4, shade(p.wall, 0.85), p.wallLo);
  arch.rotateY(Math.PI / 4);
  arch.translate(0, 23, 44);
  finialOn(x, 0, 26.2, 44, 1.1);
  for (const s of [-1, 1]) {
    const pd = ball(parts, 4.2, 6, 4, p.roofHi, p.roofLo);
    pd.scale(1, 0.85, 1);
    pd.translate(s * 14.5, 24.6, 44);
    finialOn(x, s * 14.5, 28.2, 44, 0.7);
  }
  // glazed tile band where the great dome meets its drum
  cyl(parts, 28.8, 28.8, 2.2, 12, p.trim, p.trimLo).translate(0, 31.6, -8);
  box(parts, 14, 12, 0.8, BANNER, BANNER_LO).translate(0, 12, 47.9);
  box(parts, 15.5, 1.4, 1.1, p.trim, p.trimLo).translate(0, 18.7, 48);
  box(parts, 26, 1.5, 9, p.stone, p.stoneLo).translate(0, 4.3, 54);
}

// wallSegment — one town-ring piece, tiling seamlessly along ±X at exactly WALL_SEG_LEN:
// flat ends, symmetric merlon/stake rhythm. Norvik rings are sharpened timber; valen and
// ashari coursed masonry. The light walk coping / lashed rail is the ring's tint line.
// tris: valen 84 / norvik 108 / ashari 84 (≤120)
function wallSegmentGeo(x: Ctx): void {
  const { parts, p } = x;
  const L = WALL_SEG_LEN;
  if (x.c === 'norvik') {
    const n = 6;
    const sw = L / n;
    for (let i = 0; i < n; i++) {
      const cx = -L / 2 + (i + 0.5) * sw;
      const h = 9.6 + (i % 2) * 1.3;
      box(parts, sw, h, 2.6, p.beam, p.beamLo).translate(cx, h / 2, 0);
      const tip = cone(parts, sw * 0.66, 2.2, 4, p.beamLo, shade(p.beamLo, 0.8), true);
      tip.rotateY(Math.PI / 4);
      tip.translate(cx, h + 1.1, 0);
    }
    box(parts, L, 0.9, 0.8, BANNER, BANNER_LO).translate(0, 7.2, -1.6);
    return;
  }
  box(parts, L, 2.5, 5.2, shade(p.stone, 0.85), p.stoneLo).translate(0, 1.25, 0);
  box(parts, L, 7.5, 4.2, p.stone, p.stoneLo).translate(0, 6.25, 0);
  box(parts, L, 1.1, 4.8, shade(p.stone, 1.1), p.stoneLo).translate(0, 10.55, 0);
  box(parts, L, 0.5, 0.9, BANNER, BANNER_LO).translate(0, 11.35, -1.7);
  const period = L / 3;
  for (let i = 0; i < 3; i++) {
    box(parts, 1.9, 1.8, 1.4, p.stone, p.stoneLo).translate(-L / 2 + (i + 0.5) * period, 12, 1.4);
  }
}

// wallTower — the ring's built-spot marker: taller than the wall walk, culture cap
// (valen cone / norvik pyramid over timber / ashari dome), light flag at the tip.
// tris: valen 158 / norvik 150 / ashari 172 (≤250)
function wallTowerGeo(x: Ctx): void {
  const { parts, p } = x;
  const timber = x.c === 'norvik';
  const body = timber ? p.wall : p.stone;
  const bodyLo = timber ? p.wallLo : p.stoneLo;
  box(parts, 11, 3, 11, shade(body, 0.85), bodyLo).translate(0, 1.5, 0);
  box(parts, 9, 13.5, 9, body, bodyLo).translate(0, 9.25, 0);
  box(parts, 11, 2, 11, shade(body, 1.08), bodyLo).translate(0, 17, 0);
  if (timber) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(parts, 1.3, 15, 1.3, p.beam, p.beamLo).translate(sx * 4.5, 8.5, sz * 4.5);
      }
    }
    const cap = cone(parts, 7.6, 4.5, 4, p.roofHi, p.roofLo);
    cap.rotateY(Math.PI / 4);
    cap.translate(0, 20.25, 0);
  } else if (x.c === 'valen') {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(parts, 2, 1.8, 2, body, bodyLo).translate(sx * 4.5, 18.9, sz * 4.5);
      }
    }
    cone(parts, 6, 7, 8, p.roofHi, p.roofLo).translate(0, 21.5, 0);
  } else {
    const cap = ball(parts, 5.6, 8, 5, p.roofHi, p.roofLo);
    cap.scale(1, 0.8, 1);
    cap.translate(0, 18.2, 0);
    finialOn(x, 0, 22.7, 0, 0.8);
  }
  box(parts, 3.5, 6.5, 1.2, DARK, DARK_LO).translate(0, 3.25, 5.2);
  windowRow(x, 2, 1.3, 3, 12.5, 4.6, 5);
  cyl(parts, 0.3, 0.3, 6, 5, p.beam, p.beamLo, true).translate(0, 24.5, 0);
  box(parts, 3.4, 2.2, 0.35, BANNER, BANNER_LO).translate(2, 26.2, 0);
}

// tent — bandit camps: one rough hide ridge tent, patched, with a cold firepit. Deliberately
// off-palette dirty umber, identical for all three cultures, and it flies no banner.
// tris: 110 for every culture (≤150)
function tentGeo(x: Ctx): void {
  const { parts } = x;
  prism(parts, 14, 8.2, 11.5, UMBER, UMBER_LO);
  const flap = box(parts, 4.2, 5.4, 1.0, DARK, DARK_LO);
  flap.rotateX(0.12);
  flap.translate(0, 2.6, 4.6);
  const pole = cyl(parts, 0.35, 0.35, 17.5, 4, shade(UMBER, 1.3), UMBER_LO, true);
  pole.rotateZ(Math.PI / 2);
  pole.translate(0, 7.9, 0);
  for (const s of [-1, 1]) {
    const guy = cyl(parts, 0.18, 0.18, 6.5, 3, shade(UMBER, 1.2), UMBER_LO, true);
    guy.rotateZ(s * 0.6);
    guy.translate(s * 8.6, 2.8, 0);
  }
  const patch = box(parts, 3.4, 0.4, 3.0, 0x6a5a45, 0x4e4234);
  patch.rotateZ(-0.96);
  patch.translate(-3.6, 5.2, -1.5);
  cyl(parts, 2.4, 2.8, 0.9, 6, 0x3a3026, 0x28211a).translate(-9.5, 0.45, 4.5);
  ball(parts, 1.0, 5, 4, 0x4e4438, 0x362f26).translate(-9.5, 1.0, 4.5);
}

// ---------------------------------------------------------------- factory

const BUILDERS: Record<BuildingKind, (x: Ctx) => void> = {
  townCenter: townCenterGeo,
  house: houseGeo,
  farm: farmGeo,
  lumberCamp: lumberCampGeo,
  quarry: quarryGeo,
  market: marketGeo,
  storehouse: storehouseGeo,
  temple: templeGeo,
  granary: granaryGeo,
  university: universityGeo,
  guildhall: guildhallGeo,
  keep: keepGeo,
  palisade: palisadeGeo,
  stoneWall: stoneWallGeo,
  barracks: barracksGeo,
  archeryRange: archeryRangeGeo,
  stable: stableGeo,
  wonder: wonderGeo,
  wallSegment: wallSegmentGeo,
  wallTower: wallTowerGeo,
  tent: tentGeo,
};

const geoCache = new Map<string, THREE.BufferGeometry>();

/** One merged, vertex-colored, normal-computed BufferGeometry. Deterministic; cached per kind:culture. */
export function buildingGeo(kind: BuildingKind, culture: BuildingCulture): THREE.BufferGeometry {
  const cul: BuildingCulture = kind === 'tent' ? 'valen' : culture; // the wilds ignore culture
  const key = `${kind}:${cul}`;
  let g = geoCache.get(key);
  if (!g) {
    const x: Ctx = { parts: [], c: cul, p: PALETTES[cul], r: rng(key) };
    BUILDERS[kind](x);
    const merged = mergeGeometries(x.parts, false);
    if (!merged) throw new Error(`buildingKit: merge failed for ${key}`);
    merged.computeVertexNormals();
    geoCache.set(key, merged);
    g = merged;
  }
  return g;
}
