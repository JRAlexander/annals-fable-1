import type { AgeDef, AgeId } from './schema';

export const AGE_ORDER: readonly AgeId[] = ['founding', 'flowering', 'highKingdom', 'golden'];

export const AGES: Record<AgeId, AgeDef> = {
  founding: {
    id: 'founding',
    name: 'The Founding',
    index: 0,
    advanceCost: {},
    requires: { buildingsFromCurrentAge: 0 },
    advanceTime: 0,
  },
  flowering: {
    id: 'flowering',
    name: 'The Flowering',
    index: 1,
    advanceCost: { food: 500, gold: 200 },
    requires: { buildingsFromCurrentAge: 2 },
    advanceTime: 300,
  },
  highKingdom: {
    id: 'highKingdom',
    name: 'The High Kingdom',
    index: 2,
    advanceCost: { food: 800, wood: 400, gold: 400 },
    requires: { buildingsFromCurrentAge: 2 },
    advanceTime: 400,
  },
  golden: {
    id: 'golden',
    name: 'The Golden Age',
    index: 3,
    advanceCost: { food: 1200, stone: 600, gold: 800 },
    requires: { buildingsFromCurrentAge: 2 },
    advanceTime: 500,
  },
};

export function ageIndex(id: AgeId): number {
  return AGES[id].index;
}

/** The age after `id`, or null at the end of history. */
export function nextAge(id: AgeId): AgeId | null {
  return AGE_ORDER[AGES[id].index + 1] ?? null;
}
