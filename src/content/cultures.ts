import { commonNames } from './names';
import type { CultureDef, CultureId } from './schema';

/**
 * The three playable cultures. Bonuses are Modifier data resolved by
 * sim/modifiers.ts; unique units/techs are ordinary content rows gated by
 * their `culture` field; `architecture` is consumed by the renderer only.
 */
export const CULTURES: Record<CultureId, CultureDef> = {
  valen: {
    id: 'valen',
    name: 'Valen',
    bonuses: [
      { stat: 'gatherRate', op: 'mul', value: 1.15, resource: 'food' },
      { stat: 'popGrowth', op: 'mul', value: 1.1 },
    ],
    uniqueUnit: 'paladin',
    uniqueTechs: ['stewardship', 'chivalry'],
    architecture: {
      palette: { wall: 0xd8c49a, roof: 0x8a4a2f, trim: 0xc9a227 },
      roofStyle: 'gable',
    },
    nameBank: commonNames,
  },
  norvik: {
    id: 'norvik',
    name: 'Norvik',
    bonuses: [
      { stat: 'unitAttack', op: 'add', value: 1, unitTag: 'infantry' },
      { stat: 'unitSpeed', op: 'mul', value: 1.15, unitTag: 'infantry' },
      { stat: 'gatherRate', op: 'mul', value: 1.1, resource: 'wood' },
    ],
    uniqueUnit: 'huscarl',
    uniqueTechs: ['shieldwall', 'longships'],
    architecture: {
      palette: { wall: 0x8a7a5f, roof: 0x4a5a3a, trim: 0x3a3a3a },
      roofStyle: 'flat',
    },
    nameBank: commonNames,
  },
  ashari: {
    id: 'ashari',
    name: 'Ashari',
    bonuses: [
      { stat: 'researchSpeed', op: 'mul', value: 1.25 },
      { stat: 'gatherRate', op: 'mul', value: 1.1, resource: 'gold' },
    ],
    uniqueUnit: 'camelRider',
    uniqueTechs: ['astronomy', 'spiceRoutes'],
    architecture: {
      palette: { wall: 0xe0d0a8, roof: 0x5a7a9a, trim: 0x8a6a3a },
      roofStyle: 'dome',
    },
    nameBank: commonNames,
  },
};

export const CULTURE_IDS: readonly CultureId[] = Object.keys(CULTURES);
