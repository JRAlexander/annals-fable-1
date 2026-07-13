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
  temple: {
    id: 'temple',
    name: 'Temple',
    cost: { wood: 80, stone: 100 },
    buildTime: 140,
    hp: 300,
    requiresAge: 'flowering',
    functions: [],
    effects: [
      { stat: 'popGrowth', op: 'mul', value: 1.15 },
      { stat: 'unrest', op: 'add', value: -1 }, // inert until threats land (M6)
    ],
    footprint: { w: 2, d: 3 },
  },
  granary: {
    id: 'granary',
    name: 'Granary',
    cost: { wood: 100 },
    buildTime: 110,
    hp: 220,
    requiresAge: 'flowering',
    functions: [{ kind: 'storage', capacity: 400 }],
    effects: [{ stat: 'gatherRate', op: 'mul', value: 1.1, resource: 'food' }],
    footprint: { w: 2, d: 2 },
  },
  university: {
    id: 'university',
    name: 'University',
    cost: { wood: 150, stone: 120, gold: 100 },
    buildTime: 200,
    hp: 300,
    requiresAge: 'highKingdom',
    functions: [{ kind: 'research', techs: 'all' }],
    effects: [{ stat: 'researchSpeed', op: 'mul', value: 1.25 }],
    footprint: { w: 3, d: 3 },
  },
  guildhall: {
    id: 'guildhall',
    name: 'Guildhall',
    cost: { wood: 120, gold: 80 },
    buildTime: 160,
    hp: 280,
    requiresAge: 'highKingdom',
    requiresTechs: ['caravans'],
    functions: [{ kind: 'production', resource: 'gold', workers: 20, ratePerWorker: 0.01 }],
    footprint: { w: 2, d: 2 },
  },
  keep: {
    id: 'keep',
    name: 'Keep',
    cost: { stone: 300, gold: 150 },
    buildTime: 300,
    hp: 1200,
    requiresAge: 'golden',
    requiresTechs: ['architecture'],
    functions: [{ kind: 'defense', garrison: 20, attack: 8 }],
    footprint: { w: 3, d: 3 },
  },
};

export const BUILDING_IDS: readonly BuildingId[] = Object.keys(BUILDINGS);
