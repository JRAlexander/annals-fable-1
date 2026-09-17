import { describe, expect, it } from 'vitest';
import {
  BUILDING_KINDS,
  type BuildingCulture,
  type BuildingKind,
  buildingGeo,
  buildingSize,
  WALL_SEG_LEN,
} from '../src/render/buildingKit';

/**
 * The building kit's mechanical contract (M18b): 21 kinds × 3 cultures, each
 * a merged vertex-colored geometry standing on the ground, within its brief
 * footprint and triangle budget (docs/design/ASSET-BRIEF-2-BUILDINGS-TERRAIN.md).
 * Culture distinctiveness is judged by eye in the preview.
 */

const CULTURES: readonly BuildingCulture[] = ['valen', 'norvik', 'ashari'];
const CELL = 6000 / 127; // wu per map cell

// brief budgets (hard) and footprints in cells (w × d); walls/tent are exempt from coverage
const SPEC: Record<BuildingKind, { tris: number; fp?: [number, number] }> = {
  townCenter: { tris: 900, fp: [3, 3] },
  house: { tris: 600, fp: [1, 1] },
  farm: { tris: 600, fp: [2, 2] },
  lumberCamp: { tris: 600, fp: [2, 1] },
  quarry: { tris: 600, fp: [2, 2] },
  market: { tris: 600, fp: [2, 2] },
  storehouse: { tris: 600, fp: [2, 2] },
  temple: { tris: 600, fp: [2, 3] },
  granary: { tris: 600, fp: [2, 2] },
  university: { tris: 600, fp: [3, 3] },
  guildhall: { tris: 600, fp: [2, 2] },
  keep: { tris: 900, fp: [3, 3] },
  palisade: { tris: 600 },
  stoneWall: { tris: 600 },
  barracks: { tris: 600, fp: [3, 3] },
  archeryRange: { tris: 600, fp: [3, 2] },
  stable: { tris: 600, fp: [3, 2] },
  wonder: { tris: 2000, fp: [4, 4] },
  wallSegment: { tris: 120 },
  wallTower: { tris: 250 },
  tent: { tris: 150 },
};

describe('buildingKit', () => {
  it('covers all twenty-one kinds', () => {
    expect([...BUILDING_KINDS].sort()).toEqual(Object.keys(SPEC).sort());
  });

  for (const kind of Object.keys(SPEC) as BuildingKind[]) {
    const spec = SPEC[kind];
    for (const culture of CULTURES) {
      it(`${kind} (${culture}): merged, painted, grounded, within budget`, () => {
        const geo = buildingGeo(kind, culture);
        expect(geo.attributes.position).toBeDefined();
        expect(geo.attributes.color).toBeDefined();
        expect(geo.attributes.normal).toBeDefined();

        const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        expect(tris, `${kind}/${culture} triangle budget`).toBeLessThanOrEqual(spec.tris);

        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        expect(bb).not.toBeNull();
        if (!bb) return;
        expect(bb.min.y, `${kind}/${culture} on the ground`).toBeGreaterThanOrEqual(-0.5);
        expect(bb.min.y, `${kind}/${culture} not floating`).toBeLessThanOrEqual(1.5);

        if (spec.fp) {
          // 55–102% coverage of the footprint on each axis, either orientation
          const ex = bb.max.x - bb.min.x;
          const ez = bb.max.z - bb.min.z;
          const fw = spec.fp[0] * CELL;
          const fd = spec.fp[1] * CELL;
          const [a, b] = ex >= ez ? [ex, ez] : [ez, ex];
          const [fa, fb] = fw >= fd ? [fw, fd] : [fd, fw];
          expect(a, `${kind}/${culture} major axis vs ${fa.toFixed(0)}wu`).toBeGreaterThanOrEqual(fa * 0.55);
          expect(a, `${kind}/${culture} major axis overflow`).toBeLessThanOrEqual(fa * 1.02);
          expect(b, `${kind}/${culture} minor axis vs ${fb.toFixed(0)}wu`).toBeGreaterThanOrEqual(fb * 0.5);
          expect(b, `${kind}/${culture} minor axis overflow`).toBeLessThanOrEqual(fb * 1.02);
        }
      });
    }
  }

  it('wall segments tile along X at WALL_SEG_LEN', () => {
    for (const culture of CULTURES) {
      const geo = buildingGeo('wallSegment', culture);
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) throw new Error('no bounding box');
      expect(bb.max.x - bb.min.x).toBeCloseTo(WALL_SEG_LEN, 1);
    }
    expect(WALL_SEG_LEN).toBeGreaterThanOrEqual(8);
    expect(WALL_SEG_LEN).toBeLessThanOrEqual(14);
  });

  it('buildingSize tracks the built geometry', () => {
    for (const kind of BUILDING_KINDS) {
      const sz = buildingSize(kind);
      const geo = buildingGeo(kind, 'valen');
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) throw new Error('no bounding box');
      expect(sz.h, `${kind} height estimate`).toBeGreaterThanOrEqual(bb.max.y * 0.6);
      expect(sz.h, `${kind} height estimate`).toBeLessThanOrEqual(bb.max.y * 1.6 + 1);
      expect(sz.w).toBeGreaterThan(0);
      expect(sz.d).toBeGreaterThan(0);
    }
  });

  it('the tent belongs to nobody', () => {
    const a = buildingGeo('tent', 'valen');
    const b = buildingGeo('tent', 'norvik');
    expect(a.attributes.position.array).toEqual(b.attributes.position.array);
  });
});
