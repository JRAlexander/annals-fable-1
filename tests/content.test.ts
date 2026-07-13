import { describe, expect, it } from 'vitest';
import { AGE_ORDER, AGES, nextAge } from '../src/content/ages';
import { BUILDINGS } from '../src/content/buildings';
import { TECHS } from '../src/content/techs';
import { validateContent } from '../src/content/validate';

describe('content validation', () => {
  it('shipped content is consistent', () => {
    expect(validateContent()).toEqual([]);
  });

  it('every age is reachable: 4 contiguous ages with a terminal golden', () => {
    expect(AGE_ORDER).toHaveLength(4);
    expect(nextAge('golden')).toBeNull();
    expect(AGES.founding.index).toBe(0);
  });

  it('every tech is researchable in its own age at some building', () => {
    for (const t of Object.values(TECHS)) {
      const b = BUILDINGS[t.researchedAt];
      expect(b, t.id).toBeDefined();
      expect(AGES[b.requiresAge].index).toBeLessThanOrEqual(AGES[t.age].index);
    }
  });

  it('tech ids and building ids are self-consistent record keys', () => {
    for (const [k, v] of Object.entries(TECHS)) expect(v.id).toBe(k);
    for (const [k, v] of Object.entries(BUILDINGS)) expect(v.id).toBe(k);
  });
});
