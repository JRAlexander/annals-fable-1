import { describe, expect, it } from 'vitest';
import { UNIT_KINDS, type UnitKind, unitGeo, unitHeight } from '../src/render/unitKit';

/**
 * The unit kit's hard contract (M18a): every kind builds one merged,
 * vertex-colored, deterministic geometry that stands on the ground within
 * its brief envelope and triangle budget (docs/design/ASSET-BRIEF-1-UNITS.md).
 * Silhouette quality is judged by eye; these are the mechanical guarantees.
 */

// per-kind ceilings: brief budgets are hard; height/radius allow the brief's
// stated exceptions (pike 1.5× body, dragon wingspan ±8) plus a little slack
const LIMITS: Record<UnitKind, { tris: number; height: number; radius: number }> = {
  militia: { tris: 150, height: 11, radius: 4 },
  spearman: { tris: 150, height: 15, radius: 4 },
  swordsman: { tris: 150, height: 11, radius: 4 },
  archer: { tris: 150, height: 11.5, radius: 4.5 },
  skirmisher: { tris: 150, height: 13.5, radius: 4.5 },
  lightCavalry: { tris: 250, height: 11, radius: 6 },
  knight: { tris: 250, height: 12.5, radius: 6.5 },
  paladin: { tris: 250, height: 14, radius: 6.5 },
  huscarl: { tris: 150, height: 13, radius: 4.5 },
  camelRider: { tris: 250, height: 13, radius: 6.5 },
  ram: { tris: 200, height: 8, radius: 7 },
  dragon: { tris: 1200, height: 15, radius: 9.5 },
  villager: { tris: 100, height: 6.5, radius: 3 },
  caravan: { tris: 200, height: 6.5, radius: 4.5 },
};

describe('unitKit', () => {
  it('covers all fourteen kinds', () => {
    expect([...UNIT_KINDS].sort()).toEqual(Object.keys(LIMITS).sort());
  });

  for (const kind of Object.keys(LIMITS) as UnitKind[]) {
    const lim = LIMITS[kind];
    it(`${kind}: merged, painted, grounded, within budget`, () => {
      const geo = unitGeo(kind);
      expect(geo.attributes.position).toBeDefined();
      expect(geo.attributes.color).toBeDefined();
      expect(geo.attributes.normal).toBeDefined();

      const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      expect(tris, `${kind} triangle budget`).toBeLessThanOrEqual(lim.tris);

      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      expect(bb).not.toBeNull();
      if (!bb) return;
      expect(bb.min.y, `${kind} feet on the ground`).toBeGreaterThanOrEqual(-0.2);
      expect(bb.min.y, `${kind} not floating`).toBeLessThanOrEqual(1.5);
      expect(bb.max.y, `${kind} height`).toBeLessThanOrEqual(lim.height);
      const radius = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z));
      expect(radius, `${kind} footprint`).toBeLessThanOrEqual(lim.radius);

      // the hp bar hangs off this — it must sit at the model's crown
      expect(Math.abs(unitHeight(kind) - bb.max.y), `${kind} unitHeight`).toBeLessThanOrEqual(1.5);
    });
  }

  it('is deterministic across builds', () => {
    for (const kind of UNIT_KINDS) {
      const a = unitGeo(kind).attributes.position.array as Float32Array;
      const b = unitGeo(kind).attributes.position.array as Float32Array;
      expect(a.length).toBe(b.length);
      expect(
        a.every((v, i) => v === b[i]),
        `${kind} positions identical`,
      ).toBe(true);
    }
  });
});
