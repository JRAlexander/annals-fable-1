import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { biomeColor, type PaletteBiome, ROAD, rockGeo, treeGeo, WATER } from '../src/render/terrainPalette';

/**
 * The terrain palette's mechanical contract (M18b): finite, distinct,
 * well-shaded swatches and dressing kits within budget
 * (docs/design/ASSET-BRIEF-2-BUILDINGS-TERRAIN.md Part B). Harmony is judged
 * by eye in the preview.
 */

const BIOMES: readonly PaletteBiome[] = ['Meadow', 'Farmland', 'Deciduous', 'Pine', 'Rock', 'Marsh', 'Water'];

const lightness = (c: THREE.Color) => {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.l;
};

describe('terrainPalette', () => {
  it('every biome returns finite colors across the height range', () => {
    for (const b of BIOMES) {
      for (const h of [0, 0.3, 0.65, 1]) {
        const c = biomeColor(b, h);
        expect(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)).toBe(true);
        expect(Math.max(c.r, c.g, c.b)).toBeLessThanOrEqual(1.001);
        expect(Math.min(c.r, c.g, c.b)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rock pales toward snow at the peaks', () => {
    expect(lightness(biomeColor('Rock', 1))).toBeGreaterThan(0.6);
    expect(lightness(biomeColor('Rock', 1))).toBeGreaterThan(lightness(biomeColor('Rock', 0.45)));
  });

  it('farmland reads tilled against meadow', () => {
    const m = biomeColor('Meadow', 0.35);
    const f = biomeColor('Farmland', 0.35);
    const dist = Math.hypot(m.r - f.r, m.g - f.g, m.b - f.b);
    expect(dist).toBeGreaterThan(0.05);
  });

  it('the forests run darker than open ground', () => {
    const meadow = lightness(biomeColor('Meadow', 0.4));
    expect(lightness(biomeColor('Deciduous', 0.4))).toBeLessThan(meadow);
    expect(lightness(biomeColor('Pine', 0.4))).toBeLessThan(meadow);
  });

  it('water and road constants are sane', () => {
    expect(WATER.opacity).toBeGreaterThan(0.4);
    expect(WATER.opacity).toBeLessThanOrEqual(1);
    expect(WATER.sea).toBeGreaterThanOrEqual(0);
    expect(WATER.river).toBeGreaterThanOrEqual(0);
    expect(ROAD.width).toBeGreaterThanOrEqual(2);
    expect(ROAD.width).toBeLessThanOrEqual(5);
  });

  for (const [name, geo, budget] of [
    ['deciduous tree', treeGeo('deciduous'), 80],
    ['pine tree', treeGeo('pine'), 80],
    ['rock outcrop', rockGeo(), 60],
  ] as const) {
    it(`${name}: painted, grounded, within budget`, () => {
      expect(geo.attributes.color).toBeDefined();
      expect(geo.attributes.normal).toBeDefined();
      const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      expect(tris).toBeLessThanOrEqual(budget);
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      if (!bb) throw new Error('no bounding box');
      expect(bb.min.y).toBeGreaterThanOrEqual(-0.2);
    });
  }
});
