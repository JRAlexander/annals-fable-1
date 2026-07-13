import type { BuildingDef, BuildingId } from './schema';

/**
 * M2 building set: the founding-age economy buildings. The military/research
 * buildings (barracks, ranges, temple, university, walls, keep) arrive with
 * their milestones per docs/PLAN.md — content stays frozen until then.
 *
 * Production `workers` = extra worker slots the building adds to its job;
 * gather rates stay in content/economy.ts.
 */
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  house: {
    id: 'house',
    name: 'House',
    cost: { wood: 30 },
    buildTime: 60, // ticks (6 days)
    hp: 200,
    requiresAge: 'founding',
    functions: [{ kind: 'housing', capacity: 20 }],
    footprint: { w: 1, d: 1 },
  },
  farm: {
    id: 'farm',
    name: 'Farm',
    cost: { wood: 40 },
    buildTime: 80,
    hp: 150,
    requiresAge: 'founding',
    functions: [{ kind: 'production', resource: 'food', workers: 25, ratePerWorker: 0.02 }],
    footprint: { w: 2, d: 2 },
  },
  lumberCamp: {
    id: 'lumberCamp',
    name: 'Lumber Camp',
    cost: { wood: 35 },
    buildTime: 60,
    hp: 150,
    requiresAge: 'founding',
    functions: [{ kind: 'production', resource: 'wood', workers: 20, ratePerWorker: 0.012 }],
    footprint: { w: 2, d: 1 },
  },
  quarry: {
    id: 'quarry',
    name: 'Quarry',
    cost: { wood: 50 },
    buildTime: 100,
    hp: 200,
    requiresAge: 'founding',
    functions: [{ kind: 'production', resource: 'stone', workers: 20, ratePerWorker: 0.008 }],
    footprint: { w: 2, d: 2 },
  },
  market: {
    id: 'market',
    name: 'Market',
    cost: { wood: 60, gold: 20 },
    buildTime: 90,
    hp: 180,
    requiresAge: 'founding',
    functions: [{ kind: 'production', resource: 'gold', workers: 15, ratePerWorker: 0.01 }],
    footprint: { w: 2, d: 2 },
  },
  storehouse: {
    id: 'storehouse',
    name: 'Storehouse',
    cost: { wood: 80 },
    buildTime: 100,
    hp: 250,
    requiresAge: 'founding',
    functions: [{ kind: 'storage', capacity: 500 }],
    footprint: { w: 2, d: 2 },
  },
};

export const BUILDING_IDS: readonly BuildingId[] = Object.keys(BUILDINGS);
