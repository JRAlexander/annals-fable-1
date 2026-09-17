import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The unit model kit (M18a): every soldier, civilian and monster as one
 * merged, vertex-colored BufferGeometry, built from primitives and drawn
 * by the instanced pools in armiesMesh / villagersMesh / caravansMesh.
 *
 * Design brief 1 rules baked in here:
 * - Two-zone painting: cloth, shield faces and banners near-white so the
 *   owner tint (setColorAt multiplies vertex colors) reads at full
 *   strength; steel, wood, leather and skin in mid-value true colors that
 *   stay recognizable under every tint.
 * - Value contrast lives in the vertex colors — each part gets a vertical
 *   light-top/dark-under gradient, because the renderer casts no shadows.
 * - Silhouette first: each kind's tell (pike, bow arc, hump, lance…) is
 *   oversized to survive the 8-pixel war camera.
 * - Deterministic, feet at y = 0, facing +Z, hard triangle budgets
 *   (actual count stated above each builder).
 */

export type UnitKind =
  | 'militia'
  | 'spearman'
  | 'swordsman'
  | 'archer'
  | 'skirmisher'
  | 'lightCavalry'
  | 'knight'
  | 'paladin'
  | 'huscarl'
  | 'camelRider'
  | 'ram'
  | 'dragon'
  | 'villager'
  | 'caravan';

export const UNIT_KINDS: readonly UnitKind[] = [
  'militia',
  'spearman',
  'swordsman',
  'archer',
  'skirmisher',
  'lightCavalry',
  'knight',
  'paladin',
  'huscarl',
  'camelRider',
  'ram',
  'dragon',
  'villager',
  'caravan',
];

// fixed-zone material palette — mid-value, recognizable under every owner tint
const STEEL = 0xb8bcc4;
const STEEL_LO = 0x878b94;
const IRON = 0x7a7e86;
const IRON_LO = 0x5a5e66;
const WOOD = 0x8a6a3f;
const WOOD_LO = 0x66492a;
const LEATHER = 0x6b4f35;
const LEATHER_LO = 0x4e3a27;
const SKIN = 0xd8a97e;
const SKIN_LO = 0xb0805a;
const CLOTH = 0x4a4640;
const CLOTH_LO = 0x36332e;
// tint zone — near-white, so setColorAt's multiply shows the owner at full strength
const TINT = 0xffffff;
const TINT_LO = 0xdcdcdc;
// culture accents
const VALEN_GOLD = 0xc9a227;
const VALEN_GOLD_LO = 0x9a7a1a;
const NORVIK_IRON = 0x3a3a3a;
const NORVIK_IRON_LO = 0x2a2a2a;
const ASHARI_BLUE = 0x5a7a9a;
const ASHARI_BLUE_LO = 0x435c76;

type Parts = THREE.BufferGeometry[];

/**
 * Flood a part with a vertical top→bottom color gradient (over its own
 * bounds, so paint-then-transform and transform-then-paint agree). The
 * default underside is the top color dimmed — baked shading, since Lambert
 * under two lights will not darken undersides enough on its own.
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
function ball(p: Parts, r: number, top: number, lo?: number): THREE.BufferGeometry {
  const g = paint(new THREE.SphereGeometry(r, 6, 4), top, lo);
  p.push(g);
  return g;
}

function finish(parts: Parts): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('unitKit: merge failed');
  g.computeVertexNormals();
  return g;
}

interface Pose {
  /** Forward raise, radians — hand swings toward +Z. */
  fwd?: number;
  /** Outward raise, radians — hand swings away from the body. */
  out?: number;
}

interface BodyOpts {
  /** Uniform scale: soldiers 1, villagers smaller. */
  s?: number;
  /** Torso width/depth multiplier: broad huscarls, slight archers. */
  bulk?: number;
  /** Leg-spread multiplier — a wide stance reads as a heavy. */
  stance?: number;
  tunic: number;
  tunicLo?: number;
  sleeve?: number;
  sleeveLo?: number;
  legs?: number;
  /** Tunic skirt below the belt (militia, villagers). */
  skirt?: boolean;
  armL?: Pose;
  armR?: Pose;
  /** Forward stoop, radians, hinged at the hips (villagers). */
  lean?: number;
}

/**
 * The shared infantry body — 72 tris (84 with skirt): two legs, torso, two
 * posable arms, head. Every foot soldier is this frame plus gear, so the
 * line reads as one army. At s=1 the bare head tops out at y=8.4; headgear
 * takes it to the brief's ~9.
 */
function humanoid(parts: Parts, o: BodyOpts): { hand: (side: number, pose: Pose) => THREE.Vector3 } {
  const s = o.s ?? 1;
  const bulk = o.bulk ?? 1;
  const lean = o.lean ?? 0;
  const hipY = 3.5 * s;
  const leanAt = (g: THREE.BufferGeometry) => {
    if (lean === 0) return;
    g.translate(0, -hipY, 0);
    g.rotateX(lean);
    g.translate(0, hipY, 0);
  };
  const lx = 0.62 * (o.stance ?? 1) * s;
  for (const side of [-1, 1]) {
    box(parts, 0.92 * s, 3.7 * s, 1.0 * s, o.legs ?? CLOTH, undefined).translate(side * lx, 1.85 * s, 0);
  }
  const tw = 2.2 * bulk * s;
  const torso = box(parts, tw, 3.3 * s, 1.5 * bulk * s, o.tunic, o.tunicLo);
  torso.translate(0, 5.15 * s, 0);
  leanAt(torso);
  if (o.skirt) {
    box(parts, tw + 0.25 * s, 1.4 * s, (1.5 * bulk + 0.25) * s, o.tunic, o.tunicLo).translate(0, 3.1 * s, 0);
  }
  const head = box(parts, 1.45 * s, 1.5 * s, 1.45 * s, SKIN, SKIN_LO);
  head.translate(0, 7.65 * s, 0);
  leanAt(head);
  const shoulderX = tw / 2 + 0.11 * s;
  const shoulderY = 6.5 * s;
  for (const side of [-1, 1]) {
    const pose = (side < 0 ? o.armL : o.armR) ?? {};
    const g = box(parts, 0.72 * s, 2.9 * s, 0.8 * s, o.sleeve ?? o.tunic, o.sleeveLo ?? o.tunicLo);
    g.translate(0, -1.25 * s, 0);
    g.rotateX(-(pose.fwd ?? 0));
    g.rotateZ((pose.out ?? 0) * side);
    g.translate(side * shoulderX, shoulderY, 0);
  }
  return {
    hand: (side, pose) => {
      const f = pose.fwd ?? 0;
      const oo = (pose.out ?? 0) * side;
      return new THREE.Vector3(Math.cos(f) * Math.sin(oo), -Math.cos(f) * Math.cos(oo), Math.sin(f))
        .multiplyScalar(2.5 * s)
        .add(new THREE.Vector3(side * shoulderX, shoulderY, 0));
    },
  };
}

interface MountOpts {
  /** Knight-class mass; slim otherwise. */
  heavy?: boolean;
  coat: number;
  coatLo?: number;
  /** Tint drape over the barrel; 'full' also covers neck and rump (paladin). */
  caparison?: 'body' | 'full';
  /** Flourishes — skipped where a caparison would cover them. */
  mane?: boolean;
  tail?: boolean;
  ears?: boolean;
}

/**
 * The shared horse — barrel, four legs, forward-leaning neck, down-tilted
 * head, plus optional ears/mane/tail and the tintable caparison. Both
 * cavalry lines ride this frame so mounted mass reads as kin across the
 * field. Returns the saddle height.
 */
function horse(parts: Parts, o: MountOpts): { seatY: number } {
  const heavy = o.heavy ?? false;
  const bw = heavy ? 2.7 : 2.2;
  const bh = heavy ? 2.3 : 2.0;
  const bl = heavy ? 5.4 : 5.0;
  const by = heavy ? 3.95 : 3.85;
  box(parts, bw, bh, bl, o.coat, o.coatLo).translate(0, by, -0.2);
  const legX = heavy ? 0.9 : 0.75;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(parts, 0.62, 2.9, 0.72, o.coat, o.coatLo).translate(sx * legX, 1.45, -0.2 + sz * 1.85);
    }
  }
  const neck = box(parts, 1.0, 2.4, 1.2, o.coat, o.coatLo);
  neck.rotateX(0.5);
  neck.translate(0, 5.3, 2.1);
  const head = box(parts, 0.72, 1.5, 0.9, o.coat, o.coatLo);
  head.rotateX(2.15);
  head.translate(0, 6.1, 3.0);
  if (o.ears ?? true) {
    for (const side of [-1, 1]) {
      cone(parts, 0.16, 0.5, 4, o.coatLo ?? o.coat).translate(side * 0.25, 6.85, 2.6);
    }
  }
  if (o.mane ?? true) {
    const mane = box(parts, 0.3, 2.2, 0.9, CLOTH, CLOTH_LO);
    mane.rotateX(0.5);
    mane.translate(0, 5.75, 1.75);
  }
  if (o.tail ?? true) {
    const tail = box(parts, 0.4, 1.9, 0.55, CLOTH, CLOTH_LO);
    tail.rotateX(-0.5);
    tail.translate(0, 3.5, -2.85);
  }
  if (o.caparison) {
    box(parts, bw + 0.5, bh + 1.1, bl + 0.4, TINT, TINT_LO).translate(0, by - 0.25, -0.2);
    if (o.caparison === 'full') {
      const drape = box(parts, 1.35, 2.5, 1.5, TINT, TINT_LO);
      drape.rotateX(0.5);
      drape.translate(0, 5.3, 2.1);
      box(parts, bw + 0.2, 1.5, 1.6, TINT, TINT_LO).translate(0, 4.3, -2.6);
    }
  }
  return { seatY: by + bh / 2 + (o.caparison ? 0.35 : 0.2) };
}

interface RiderOpts {
  s?: number;
  tunic: number;
  tunicLo?: number;
  sleeve?: number;
  sleeveLo?: number;
  /** Where the shins hug the mount's flanks. */
  legX?: number;
  armL?: Pose;
  armR?: Pose;
  /** Forward lean, radians, hinged at the seat (light cavalry crouch). */
  lean?: number;
}

/**
 * The shared rider — 72 tris: straddling legs, torso, head, posable arms.
 * Returns the head center (post-lean) so builders can seat helmets on it.
 */
function rider(parts: Parts, seatY: number, seatZ: number, o: RiderOpts): { headPos: THREE.Vector3 } {
  const s = o.s ?? 1;
  const lean = o.lean ?? 0;
  const leanAt = (g: THREE.BufferGeometry) => {
    if (lean === 0) return;
    g.translate(0, -seatY, -seatZ);
    g.rotateX(lean);
    g.translate(0, seatY, seatZ);
  };
  for (const side of [-1, 1]) {
    box(parts, 0.6, 2.1, 0.9, CLOTH, CLOTH_LO).translate(side * (o.legX ?? 1.35), seatY - 0.85, seatZ + 0.3);
  }
  const torso = box(parts, 2.0 * s, 2.7 * s, 1.3 * s, o.tunic, o.tunicLo);
  torso.translate(0, seatY + 1.35 * s, seatZ);
  leanAt(torso);
  const head = box(parts, 1.35 * s, 1.4 * s, 1.35 * s, SKIN, SKIN_LO);
  head.translate(0, seatY + 3.3 * s, seatZ);
  leanAt(head);
  const headPos = new THREE.Vector3(0, seatY + 3.3 * s, seatZ);
  if (lean !== 0) {
    headPos.sub(new THREE.Vector3(0, seatY, seatZ));
    headPos.applyAxisAngle(new THREE.Vector3(1, 0, 0), lean);
    headPos.add(new THREE.Vector3(0, seatY, seatZ));
  }
  const shoulderX = 1.1 * s;
  const shoulderY = seatY + 2.55 * s;
  for (const side of [-1, 1]) {
    const pose = (side < 0 ? o.armL : o.armR) ?? { fwd: 0.75 };
    const g = box(parts, 0.66 * s, 2.3 * s, 0.75 * s, o.sleeve ?? o.tunic, o.sleeveLo ?? o.tunicLo);
    g.translate(0, -1.0 * s, 0);
    g.rotateX(-(pose.fwd ?? 0));
    g.rotateZ((pose.out ?? 0) * side);
    g.translate(side * shoulderX, shoulderY, seatZ);
    leanAt(g);
  }
  return { headPos };
}

// ---------------------------------------------------------------- infantry

// militia — 96 tris: the rabble baseline. Tunic, bare head, bare arms, and
// the tell is a raised stick where everyone else carries real steel.
function militiaGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  humanoid(parts, {
    tunic: TINT,
    tunicLo: TINT_LO,
    sleeve: SKIN,
    sleeveLo: SKIN_LO,
    skirt: true,
    armR: { fwd: 0.5 },
  });
  const club = box(parts, 0.5, 2.9, 0.5, WOOD, WOOD_LO);
  club.rotateZ(0.15);
  club.translate(1.45, 5.4, 1.3);
  return finish(parts);
}

// spearman — 121 tris: the pike IS the unit — a 13.3-wu vertical line (the
// brief's 1.5×-body-height exception) beside a round tint shield.
function spearmanGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  humanoid(parts, {
    tunic: TINT,
    tunicLo: TINT_LO,
    armL: { fwd: 0.3 },
    armR: { fwd: 0.2 },
  });
  cone(parts, 0.85, 0.8, 5, IRON, IRON_LO).translate(0, 8.65, 0);
  cyl(parts, 0.13, 0.13, 12.1, 5, WOOD, WOOD_LO, true).translate(1.5, 6.35, 0.35);
  cone(parts, 0.28, 0.9, 5, STEEL, STEEL_LO, true).translate(1.5, 12.85, 0.35);
  const shield = cyl(parts, 1.15, 1.15, 0.24, 6, TINT, TINT_LO);
  shield.rotateZ(Math.PI / 2);
  shield.translate(-1.7, 5.3, 0.45);
  return finish(parts);
}

// swordsman — 138 tris: the armored brawler. Wide stance, steel torso under
// a tint tabard, a kite-shield slab of tint, short broad sword raised.
function swordsmanGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  humanoid(parts, {
    tunic: STEEL,
    tunicLo: STEEL_LO,
    sleeve: IRON,
    sleeveLo: IRON_LO,
    stance: 1.35,
    armL: { fwd: 0.35 },
    armR: { fwd: 0.8 },
  });
  box(parts, 1.6, 2.6, 0.25, TINT, TINT_LO).translate(0, 5.0, 0.85);
  cone(parts, 1.0, 0.9, 5, IRON, IRON_LO).translate(0, 8.5, 0);
  box(parts, 1.35, 2.6, 0.32, TINT, TINT_LO).translate(-1.1, 4.9, 0.9);
  const taper = cone(parts, 0.95, 1.2, 4, TINT_LO, 0xb8b8b8);
  taper.rotateX(Math.PI);
  taper.rotateY(Math.PI / 4);
  taper.translate(-1.1, 3.0, 0.9);
  const blade = box(parts, 0.5, 2.6, 0.2, STEEL, STEEL_LO);
  blade.rotateX(-0.2);
  blade.translate(1.35, 6.0, 1.85);
  box(parts, 0.8, 0.22, 0.35, IRON, IRON_LO).translate(1.35, 4.85, 1.95);
  return finish(parts);
}

// ------------------------------------------------------------------ ranged

// archer — 148 tris: the bow arc held sideways — a 4.5-wu wooden D with a
// hair-thin string — plus a quiver spike over the shoulder. Hood, not
// helmet; slighter build than the melee line.
function archerGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  humanoid(parts, {
    tunic: TINT,
    tunicLo: TINT_LO,
    bulk: 0.9,
    sleeve: LEATHER,
    sleeveLo: LEATHER_LO,
    armL: { fwd: 0.7 },
    armR: { fwd: 0.2 },
  });
  cone(parts, 1.1, 1.3, 5, TINT, TINT_LO).translate(0, 8.0, 0);
  box(parts, 0.24, 2.3, 0.45, WOOD, WOOD_LO).translate(-1.5, 5.6, 1.45);
  const upper = box(parts, 0.22, 2.1, 0.4, WOOD, WOOD_LO);
  upper.rotateX(-0.55);
  upper.translate(-1.5, 6.95, 1.2);
  const lower = box(parts, 0.22, 2.1, 0.4, WOOD, WOOD_LO);
  lower.rotateX(0.55);
  lower.translate(-1.5, 4.25, 1.2);
  box(parts, 0.07, 4.6, 0.07, CLOTH, CLOTH_LO).translate(-1.5, 5.6, 0.68);
  const quiver = cyl(parts, 0.42, 0.42, 2.2, 5, LEATHER, LEATHER_LO, true);
  quiver.rotateX(0.25);
  quiver.translate(0.85, 7.0, -0.8);
  const fletch = cone(parts, 0.4, 0.7, 4, 0xcfc39a, 0xa89a72);
  fletch.rotateX(0.25);
  fletch.translate(0.85, 8.1, -1.08);
  return finish(parts);
}

// skirmisher — 112 tris: arm thrown high with a near-vertical javelin and a
// bundle of spares in the off hand. No arc anywhere — the anti-archer read.
function skirmisherGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  humanoid(parts, {
    tunic: TINT,
    tunicLo: TINT_LO,
    sleeve: SKIN,
    sleeveLo: SKIN_LO,
    armL: { fwd: 0.3 },
    armR: { fwd: 2.5 },
  });
  box(parts, 1.55, 0.28, 1.55, TINT, TINT_LO).translate(0, 7.85, 0);
  const shaft = cyl(parts, 0.11, 0.11, 3.3, 5, WOOD, WOOD_LO, true);
  shaft.rotateX(-0.22);
  shaft.translate(1.45, 6.95, 1.27);
  const tip = cone(parts, 0.2, 0.55, 4, STEEL, STEEL_LO, true);
  tip.rotateX(-0.22);
  tip.translate(1.45, 8.6, 1.63);
  cyl(parts, 0.24, 0.24, 3.8, 5, WOOD, WOOD_LO, true).translate(-1.55, 5.2, 0.35);
  cone(parts, 0.28, 0.5, 4, STEEL, STEEL_LO, true).translate(-1.55, 7.35, 0.35);
  return finish(parts);
}

// ---------------------------------------------------------------- uniques

// huscarl (norvik) — 145 tris: broad, squat, bearded; two-handed axe held
// high on the diagonal, round tint shield slung on the BACK so friend-or-foe
// reads from behind too. Norvik iron on helm and shield boss.
function huscarlGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  humanoid(parts, {
    s: 0.95,
    bulk: 1.22,
    stance: 1.2,
    tunic: TINT,
    tunicLo: TINT_LO,
    sleeve: IRON,
    sleeveLo: IRON_LO,
    armL: { fwd: 2.45, out: 0.28 },
    armR: { fwd: 2.6, out: 0.15 },
  });
  cone(parts, 0.95, 0.8, 5, NORVIK_IRON, NORVIK_IRON_LO).translate(0, 8.2, 0);
  box(parts, 0.85, 0.75, 0.3, 0x9a6a3a, 0x744e28).translate(0, 6.6, 0.78);
  const shaft = cyl(parts, 0.14, 0.14, 3.6, 5, WOOD, WOOD_LO, true);
  shaft.rotateZ(1.25);
  shaft.translate(0, 8.15, 1.3);
  box(parts, 0.4, 1.15, 0.9, STEEL, STEEL_LO).translate(1.45, 8.3, 1.3);
  const shield = cyl(parts, 1.35, 1.35, 0.22, 6, TINT, TINT_LO);
  shield.rotateX(Math.PI / 2);
  shield.translate(0, 5.2, -1.1);
  const boss = cone(parts, 0.34, 0.35, 5, NORVIK_IRON, NORVIK_IRON_LO, true);
  boss.rotateX(-Math.PI / 2);
  boss.translate(0, 5.2, -1.35);
  return finish(parts);
}

// camelRider (ashari) — 228 tris: instantly not-a-horse — the hump and the
// long upright neck. Robed rider perched high on an ashari-blue saddle cloth.
function camelRiderGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  const sand = 0xc0996b;
  const sandLo = 0x97754e;
  box(parts, 2.1, 1.9, 4.4, sand, sandLo).translate(0, 4.1, -0.4);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(parts, 0.55, 3.2, 0.65, sand, sandLo).translate(sx * 0.72, 1.6, -0.4 + sz * 1.6);
    }
  }
  const hump = ball(parts, 1.15, sand, sandLo);
  hump.scale(1.0, 0.85, 1.25);
  hump.translate(0, 5.3, -0.5);
  const neck = box(parts, 0.85, 2.6, 0.95, sand, sandLo);
  neck.rotateX(0.35);
  neck.translate(0, 5.9, 1.9);
  box(parts, 0.6, 0.75, 1.3, sand, sandLo).translate(0, 7.35, 2.85);
  const tail = box(parts, 0.3, 1.2, 0.35, sandLo, sandLo);
  tail.rotateX(-0.4);
  tail.translate(0, 3.9, -2.7);
  box(parts, 2.3, 0.9, 2.0, ASHARI_BLUE, ASHARI_BLUE_LO).translate(0, 5.85, -0.5);
  const r = rider(parts, 6.3, -0.5, {
    s: 0.88,
    tunic: TINT,
    tunicLo: TINT_LO,
    legX: 1.15,
    armL: { fwd: 0.75 },
    armR: { fwd: 0.75 },
  });
  box(parts, 1.5, 0.45, 1.5, TINT, TINT_LO).translate(0, r.headPos.y + 0.55, r.headPos.z);
  return finish(parts);
}

// ----------------------------------------------------------------- cavalry

// lightCavalry — 218 tris: a slim horse and a rider crouched over the neck,
// no lance — speed reads from the lean and the lack of mass.
function lightCavalryGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  const m = horse(parts, { coat: 0x7a5a3a, coatLo: 0x59402a });
  box(parts, 2.4, 0.35, 2.2, TINT, TINT_LO).translate(0, m.seatY - 0.15, 0.1);
  const r = rider(parts, m.seatY, 0.1, {
    tunic: TINT,
    tunicLo: TINT_LO,
    lean: 0.35,
    legX: 1.25,
    armL: { fwd: 0.95 },
    armR: { fwd: 0.95 },
  });
  cone(parts, 0.8, 0.7, 5, IRON, IRON_LO).translate(0, r.headPos.y + 0.85, r.headPos.z);
  return finish(parts);
}

// knight — 235 tris: the heavy. Massive horse under a hanging tint
// caparison, great helm, couched lance running the length of the model,
// tint shield on the near side.
function knightGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  const m = horse(parts, { heavy: true, coat: 0x59402a, coatLo: 0x42301f, caparison: 'body', tail: false });
  const r = rider(parts, m.seatY, 0.1, {
    tunic: STEEL,
    tunicLo: STEEL_LO,
    sleeve: IRON,
    sleeveLo: IRON_LO,
    legX: 1.5,
    armL: { fwd: 0.7 },
    armR: { fwd: 0.35 },
  });
  box(parts, 1.5, 1.25, 1.5, IRON, IRON_LO).translate(0, r.headPos.y + 0.25, r.headPos.z);
  const lance = cyl(parts, 0.16, 0.16, 6.0, 5, WOOD, WOOD_LO, true);
  lance.rotateX(Math.PI / 2);
  lance.translate(1.5, m.seatY + 1.0, 0.7);
  const tip = cone(parts, 0.28, 0.6, 5, STEEL, STEEL_LO, true);
  tip.rotateX(Math.PI / 2);
  tip.translate(1.5, m.seatY + 1.0, 3.85);
  box(parts, 0.35, 2.0, 1.4, TINT, TINT_LO).translate(-1.62, m.seatY + 0.9, 0.6);
  return finish(parts);
}

// paladin (valen) — 247 tris: the knight carried further — full head-to-tail
// caparison, banner pennant flying from the lance butt, valen-gold crest and
// pennant edge.
function paladinGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  const m = horse(parts, {
    heavy: true,
    coat: 0x59402a,
    coatLo: 0x42301f,
    caparison: 'full',
    mane: false,
    tail: false,
    ears: false,
  });
  const r = rider(parts, m.seatY, 0.1, {
    tunic: STEEL,
    tunicLo: STEEL_LO,
    sleeve: IRON,
    sleeveLo: IRON_LO,
    legX: 1.5,
    armL: { fwd: 0.7 },
    armR: { fwd: 0.35 },
  });
  box(parts, 1.5, 1.25, 1.5, IRON, IRON_LO).translate(0, r.headPos.y + 0.25, r.headPos.z);
  const crest = cone(parts, 0.35, 0.6, 4, VALEN_GOLD, VALEN_GOLD_LO, true);
  crest.translate(0, r.headPos.y + 0.93, r.headPos.z);
  const lance = cyl(parts, 0.16, 0.16, 6.0, 5, WOOD, WOOD_LO, true);
  lance.rotateX(Math.PI / 2);
  lance.translate(1.5, m.seatY + 1.0, 0.7);
  const tip = cone(parts, 0.28, 0.6, 5, STEEL, STEEL_LO, true);
  tip.rotateX(Math.PI / 2);
  tip.translate(1.5, m.seatY + 1.0, 3.85);
  box(parts, 0.12, 1.5, 1.2, TINT, TINT_LO).translate(1.5, m.seatY + 1.95, -1.5);
  box(parts, 0.12, 0.35, 1.2, VALEN_GOLD, VALEN_GOLD_LO).translate(1.5, m.seatY + 2.85, -1.5);
  return finish(parts);
}

// ------------------------------------------------------------------- siege

// ram — 200 tris: long, low, wheeled — a gabled log roof over a swinging
// log whose iron head pokes out front. Wood everywhere; one tint pennant
// so ownership reads.
function ramGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  for (const side of [-1, 1]) {
    const panel = box(parts, 3.6, 0.4, 8.4, WOOD, WOOD_LO);
    panel.rotateZ(-side * 0.55);
    panel.translate(side * 1.28, 4.45, 0);
  }
  for (const side of [-1, 1]) {
    box(parts, 0.35, 2.2, 8.0, WOOD_LO, 0x4e3a22).translate(side * 2.35, 2.9, 0);
  }
  for (const side of [-1, 1]) {
    box(parts, 4.4, 1.6, 0.35, WOOD_LO, 0x4e3a22).translate(0, 3.6, side * 4.0);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = cyl(parts, 1.2, 1.2, 0.5, 5, LEATHER, LEATHER_LO);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(sx * 2.65, 1.2, sz * 2.6);
    }
  }
  const log = cyl(parts, 0.55, 0.55, 8.0, 6, WOOD, WOOD_LO, true);
  log.rotateX(Math.PI / 2);
  log.translate(0, 2.6, 0.5);
  const head = cone(parts, 0.75, 1.1, 6, IRON, IRON_LO);
  head.rotateX(Math.PI / 2);
  head.translate(0, 2.6, 4.95);
  box(parts, 0.16, 1.2, 0.16, WOOD_LO, 0x4e3a22).translate(0, 5.35, 3.6);
  box(parts, 0.8, 0.45, 0.12, TINT, TINT_LO).translate(0.55, 5.65, 3.6);
  return finish(parts);
}

// ----------------------------------------------------------------- monster

// dragon — 668 tris, the one showpiece: serpent neck of shrinking spheres,
// wings mid-beat spanning ±8 wu, spiked spine, tapering tail with a spade.
// Painted in its true colors (wild-owned, never tinted in practice): ember
// scales above, pale belly below, dark membranes.
function dragonGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  const scaleHi = 0xd84418;
  const belly = 0xe2bd93;
  const boneHi = 0x9a3210;
  const boneLo = 0x6e2408;
  const memHi = 0x5c332c;
  const memLo = 0x40211c;
  // body: an elongated sphere, ember above fading to pale below
  const body = ball(parts, 1.6, scaleHi, belly);
  body.scale(1.15, 1.0, 1.9);
  body.translate(0, 5.4, -0.6);
  // serpent neck: five shrinking spheres on an S-curve up to the head
  const neckSpec: [number, number, number][] = [
    [1.05, 6.2, 1.7],
    [0.95, 7.1, 2.25],
    [0.85, 8.0, 2.5],
    [0.75, 8.8, 2.55],
    [0.68, 9.4, 2.85],
  ];
  for (const [nr, ny, nz] of neckSpec) {
    ball(parts, nr, scaleHi, belly).translate(0, ny, nz);
  }
  // head: skull, snout, open jaw, swept-back horns
  box(parts, 1.1, 0.95, 1.5, scaleHi, belly).translate(0, 9.6, 3.4);
  box(parts, 0.7, 0.5, 1.15, scaleHi, belly).translate(0, 9.5, 4.45);
  const jaw = box(parts, 0.75, 0.22, 1.1, belly, memLo);
  jaw.rotateX(0.5);
  jaw.translate(0, 9.05, 4.2);
  for (const side of [-1, 1]) {
    const horn = cone(parts, 0.2, 1.0, 4, 0xd8c9a8, 0xa89678, true);
    horn.rotateX(-1.05);
    horn.translate(side * 0.42, 10.05, 2.95);
  }
  // wings mid-beat: two bone segments arcing out, membrane panels trailing
  for (const side of [-1, 1]) {
    const bone1 = cyl(parts, 0.22, 0.15, 3.0, 5, boneHi, boneLo, true);
    bone1.rotateZ(-side * 1.1);
    bone1.translate(side * 2.84, 6.78, 0.3);
    const bone2 = cyl(parts, 0.15, 0.09, 3.8, 5, boneHi, boneLo, true);
    bone2.rotateZ(-side * 1.75);
    bone2.translate(side * 6.04, 7.12, 0.3);
    const claw = cone(parts, 0.12, 0.6, 4, 0xd8c9a8, 0xa89678, true);
    claw.rotateX(1.9);
    claw.translate(side * 4.2, 7.4, 0.85);
    const panelSpec: [number, number, number, number, number, number][] = [
      [2.8, 3.2, 0.45, 2.7, 6.55, -1.1],
      [2.2, 2.9, 0.2, 4.6, 7.1, -0.9],
      [1.9, 2.4, -0.15, 6.2, 7.05, -0.7],
      [1.4, 1.8, -0.25, 7.2, 6.8, -0.45],
    ];
    for (const [pw, pd, pa, px, py, pz] of panelSpec) {
      const panel = box(parts, pw, 0.12, pd, memHi, memLo);
      panel.rotateZ(side * pa);
      panel.translate(side * px, py, pz);
    }
  }
  // spiked spine, nape to tail
  const spikeSpec: [number, number][] = [
    [7.1, 0.9],
    [7.25, 0.1],
    [7.2, -0.7],
    [7.0, -1.5],
    [6.6, -2.4],
    [5.5, -3.3],
    [4.8, -4.6],
  ];
  for (const [sy, sz] of spikeSpec) {
    cone(parts, 0.3, 0.9, 4, 0x7a2410, 0x581a08, true).translate(0, sy, sz);
  }
  // haunches, legs, feet
  for (const side of [-1, 1]) {
    const haunch = ball(parts, 0.95, scaleHi, belly);
    haunch.scale(0.8, 1.0, 1.15);
    haunch.translate(side * 1.4, 4.35, -1.9);
    box(parts, 0.72, 3.5, 0.95, scaleHi, belly).translate(side * 1.45, 1.75, -2.0);
    box(parts, 0.62, 3.9, 0.8, scaleHi, belly).translate(side * 1.15, 1.95, 1.2);
    box(parts, 0.85, 0.45, 1.2, 0xd8c9a8, 0xa89678).translate(side * 1.45, 0.225, -1.55);
    box(parts, 0.8, 0.45, 1.1, 0xd8c9a8, 0xa89678).translate(side * 1.15, 0.225, 1.6);
  }
  // tail: five tapering segments curving down and back, ending in a spade
  const tailSpec: [number, number, number, number, number][] = [
    [1.2, 1.1, -0.3, 4.7, -3.3],
    [0.95, 0.9, -0.45, 4.1, -4.6],
    [0.75, 0.7, -0.55, 3.4, -5.8],
    [0.55, 0.5, -0.6, 2.7, -6.9],
    [0.4, 0.35, -0.6, 2.1, -7.9],
  ];
  for (const [tw, th, ta, ty, tz] of tailSpec) {
    const seg = box(parts, tw, th, 1.6, scaleHi, belly);
    seg.rotateX(ta);
    seg.translate(0, ty, tz);
  }
  const spade = cone(parts, 0.55, 1.2, 4, 0x7a2410, 0x581a08);
  spade.rotateX(-2.2);
  spade.translate(0, 1.7, -8.6);
  return finish(parts);
}

// --------------------------------------------------------------- civilians

// villager — 96 tris: visibly smaller and humbler than any soldier — a
// stooped figure under a wicker basket. The basket stays light so the
// cargo-color lerp in villagersMesh reads.
function villagerGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  humanoid(parts, {
    s: 0.58,
    tunic: TINT,
    tunicLo: TINT_LO,
    sleeve: SKIN,
    sleeveLo: SKIN_LO,
    skirt: true,
    lean: 0.3,
    armL: { fwd: 0.25 },
    armR: { fwd: 0.25 },
  });
  const basket = box(parts, 1.05, 1.25, 0.75, 0xd8c090, 0xa88e5e);
  basket.rotateX(0.3);
  basket.translate(0, 3.65, -0.55);
  return finish(parts);
}

// caravan — 196 tris: the covered wagon — near-white canvas hoop (tinted
// amber and lightened by caravansMesh when laden), solid wheels, an ox in
// the traces. Long axis along +Z, the direction of travel.
function caravanGeo(): THREE.BufferGeometry {
  const parts: Parts = [];
  box(parts, 2.6, 0.5, 3.2, WOOD, WOOD_LO).translate(0, 1.35, -0.9);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = cyl(parts, 0.95, 0.95, 0.4, 5, LEATHER, LEATHER_LO);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(sx * 1.5, 0.95, -0.85 + sz * 0.9);
    }
  }
  const canvas = cyl(parts, 1.55, 1.55, 3.0, 6, TINT, TINT_LO, true);
  canvas.rotateZ(Math.PI / 2);
  canvas.rotateY(Math.PI / 2);
  canvas.translate(0, 1.7, -0.9);
  box(parts, 2.6, 1.4, 0.2, CLOTH, CLOTH_LO).translate(0, 2.3, -2.25);
  box(parts, 2.2, 0.5, 0.3, WOOD_LO, 0x4e3a22).translate(0, 1.85, 0.6);
  // the ox: barrel, head, leg slabs, up-curved horns, and the wagon tongue
  box(parts, 1.5, 1.35, 1.8, 0x8a7055, 0x64503a).translate(0, 1.55, 1.5);
  box(parts, 0.75, 0.8, 0.9, 0x8a7055, 0x64503a).translate(0, 1.8, 2.7);
  box(parts, 1.35, 0.9, 0.45, 0x64503a, 0x4a3a29).translate(0, 0.45, 0.9);
  box(parts, 1.35, 0.9, 0.45, 0x64503a, 0x4a3a29).translate(0, 0.45, 2.2);
  for (const side of [-1, 1]) {
    const hornG = cone(parts, 0.14, 0.5, 4, 0xd8c9a8, 0xa89678, true);
    hornG.rotateZ(-side * 0.8);
    hornG.translate(side * 0.48, 2.35, 2.8);
  }
  box(parts, 0.16, 0.16, 1.6, WOOD_LO, 0x4e3a22).translate(0, 1.1, 0.7);
  return finish(parts);
}

const BUILDERS: Record<UnitKind, () => THREE.BufferGeometry> = {
  militia: militiaGeo,
  spearman: spearmanGeo,
  swordsman: swordsmanGeo,
  archer: archerGeo,
  skirmisher: skirmisherGeo,
  lightCavalry: lightCavalryGeo,
  knight: knightGeo,
  paladin: paladinGeo,
  huscarl: huscarlGeo,
  camelRider: camelRiderGeo,
  ram: ramGeo,
  dragon: dragonGeo,
  villager: villagerGeo,
  caravan: caravanGeo,
};

const geoCache = new Map<UnitKind, THREE.BufferGeometry>();
const heightCache = new Map<UnitKind, number>();

/** One merged, vertex-colored, normal-computed BufferGeometry per kind. Deterministic and cached. */
export function unitGeo(kind: UnitKind): THREE.BufferGeometry {
  let g = geoCache.get(kind);
  if (!g) {
    g = BUILDERS[kind]();
    g.computeBoundingBox();
    geoCache.set(kind, g);
    heightCache.set(kind, g.boundingBox!.max.y);
  }
  return g;
}

/** Model height in world units (top of the mesh, for hp-bar anchoring above the head). */
export function unitHeight(kind: UnitKind): number {
  unitGeo(kind);
  return heightCache.get(kind)!;
}
