import { describe, expect, it } from 'vitest';
import { Biome, GRID, SEA_LEVEL } from '../src/worldgen/types';
import { generateWorld } from '../src/worldgen/world';

describe('worldgen determinism', () => {
  it('same seed produces an identical world', () => {
    const a = generateWorld(1234);
    const b = generateWorld(1234);
    expect(Array.from(a.heightmap)).toEqual(Array.from(b.heightmap));
    expect(Array.from(a.biome)).toEqual(Array.from(b.biome));
    expect(a.rivers).toEqual(b.rivers);
    expect(a.roads).toEqual(b.roads);
    expect(a.settlements).toEqual(b.settlements);
  });

  it('different seeds produce different worlds', () => {
    const a = generateWorld(1);
    const b = generateWorld(2);
    expect(Array.from(a.heightmap)).not.toEqual(Array.from(b.heightmap));
  });
});

describe('worldgen invariants', () => {
  const seeds = [1, 42, 1234, 99999];
  for (const seed of seeds) {
    it(`seed ${seed}: world is well-formed`, () => {
      const w = generateWorld(seed);
      expect(w.heightmap.length).toBe(GRID * GRID);
      for (const h of w.heightmap) {
        expect(h).toBeGreaterThanOrEqual(-0.1); // lake-carving may dip below 0 slightly
        expect(h).toBeLessThanOrEqual(1);
      }
      expect(w.settlements.length).toBeGreaterThanOrEqual(3);
      expect(w.settlements.filter((s) => s.tier === 'capital')).toHaveLength(1);
      expect(w.capital.tier).toBe('capital');
      expect(w.rivers.length).toBeGreaterThanOrEqual(1);
      expect(w.roads.length).toBeGreaterThanOrEqual(w.settlements.length - 1);
      for (const s of w.settlements) {
        expect(s.name.length).toBeGreaterThan(2);
        // sited on land
        expect(w.heightmap[s.j * GRID + s.i]).toBeGreaterThan(SEA_LEVEL);
      }
      // nav grid: land cells finite, water impassable
      for (let k = 0; k < GRID * GRID; k++) {
        if (w.biome[k] === Biome.Water) {
          if (w.navCost[k] !== 0.5) expect(w.navCost[k]).toBe(Number.POSITIVE_INFINITY);
        } else {
          expect(Number.isFinite(w.navCost[k])).toBe(true);
        }
      }
    });
  }
});
