/**
 * The typed spine for all game content. Cultures, techs, buildings, and units
 * are DATA conforming to these interfaces — their effects are expressed as
 * Modifier records resolved by sim/modifiers.ts, never as bespoke code.
 */

export type ResourceId = 'food' | 'wood' | 'stone' | 'gold';
export type Cost = Partial<Record<ResourceId, number>>;

export type AgeId = 'founding' | 'flowering' | 'highKingdom' | 'golden';
export type UnitTag = 'infantry' | 'cavalry' | 'ranged' | 'siege';

export type CultureId = string;
export type TechId = string;
export type BuildingId = string;
export type UnitId = string;

export type Stat =
  | 'gatherRate'
  | 'buildSpeed'
  | 'researchSpeed'
  | 'trainSpeed'
  | 'unitHp'
  | 'unitAttack'
  | 'unitArmor'
  | 'unitSpeed'
  | 'housingCap'
  | 'wallHp'
  | 'tradeIncome'
  | 'popGrowth'
  | 'unrest';

export interface Modifier {
  stat: Stat;
  op: 'add' | 'mul';
  value: number;
  /** Optional scoping — omitted means the modifier applies to everything with that stat. */
  resource?: ResourceId;
  unitTag?: UnitTag;
  buildingId?: BuildingId;
}

export interface NameBank {
  place1: readonly string[];
  place2: readonly string[];
  givenM: readonly string[];
  givenF: readonly string[];
}

export interface CultureDef {
  id: CultureId;
  name: string;
  bonuses: Modifier[];
  uniqueUnit: UnitId;
  uniqueBuilding?: BuildingId;
  uniqueTechs: TechId[];
  /** Consumed by render only. */
  architecture: {
    palette: { wall: number; roof: number; trim: number };
    roofStyle: 'gable' | 'dome' | 'flat';
  };
  nameBank: NameBank;
}

export interface AgeDef {
  id: AgeId;
  name: string;
  index: number;
  advanceCost: Cost;
  requires: { buildingsFromCurrentAge: number };
}

export interface TechDef {
  id: TechId;
  name: string;
  age: AgeId;
  cost: Cost;
  /** Research duration in ticks. */
  researchTime: number;
  researchedAt: BuildingId;
  prereqs: TechId[];
  effects: Modifier[];
  unlocks?: { units?: UnitId[]; buildings?: BuildingId[] };
}

export type BuildingFunction =
  | { kind: 'housing'; capacity: number }
  | { kind: 'production'; resource: ResourceId; workers: number; ratePerWorker: number }
  | { kind: 'training'; units: UnitId[] }
  | { kind: 'research'; techs: 'military' | 'economy' | 'all' }
  | { kind: 'storage'; capacity: number }
  | { kind: 'defense'; garrison: number; attack: number };

export interface BuildingDef {
  id: BuildingId;
  name: string;
  cost: Cost;
  /** Ticks of work to complete. */
  buildTime: number;
  hp: number;
  requiresAge: AgeId;
  requiresTechs?: TechId[];
  functions: BuildingFunction[];
  /** Needed the moment RTS free placement lands (M7+). */
  footprint: { w: number; d: number };
}

export interface UnitDef {
  id: UnitId;
  name: string;
  tags: UnitTag[];
  cost: Cost;
  trainTime: number;
  popCost: number;
  hp: number;
  attack: number;
  /** 0 = melee. */
  range: number;
  armor: { melee: number; pierce: number };
  /** Tiles per tick — army march speed now, per-unit movement in RTS mode. */
  speed: number;
  /** AoE-style counters as data. */
  attackBonuses?: { tag: UnitTag; mult: number }[];
}
