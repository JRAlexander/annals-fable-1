/**
 * The typed spine for all game content. Cultures, techs, buildings, and units
 * are DATA conforming to these interfaces — their effects are expressed as
 * Modifier records resolved by sim/modifiers.ts, never as bespoke code.
 */

export type ResourceId = 'food' | 'wood' | 'stone' | 'gold';
export type Cost = Partial<Record<ResourceId, number>>;

export type AgeId = 'founding' | 'flowering' | 'highKingdom' | 'golden';
export type UnitTag = 'infantry' | 'cavalry' | 'ranged' | 'siege' | 'monster';

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
  | 'storageCap'
  | 'popGrowth';

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
  /** Cost to ENTER this age, paid when the advance starts. */
  advanceCost: Cost;
  /** Distinct completed building types required from the PREVIOUS age. */
  requires: { buildingsFromCurrentAge: number };
  /** Ticks the advance occupies the realm's research slot. */
  advanceTime: number;
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
  /** Set on unique techs: only this culture may research it. */
  culture?: CultureId;
}

export type BuildingFunction =
  | { kind: 'housing'; capacity: number }
  /** Villagers work AT this building (M12): each instance offers `slots` places. */
  | { kind: 'workplace'; resource: ResourceId; slots: number }
  /** Villagers deposit these resources here — trip distance IS the gather rate. */
  | { kind: 'dropoff'; resources: ResourceId[] }
  | { kind: 'training'; units: UnitId[] }
  | { kind: 'storage'; capacity: number }
  /** Fortification: each instance adds `hp` to the settlement's siege fort pool. */
  | { kind: 'fort'; hp: number };

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
  /** Passive effects from PRESENCE — applied once per building type per scope, not per instance. */
  effects?: Modifier[];
  /** Needed the moment RTS free placement lands (M7+). */
  footprint: { w: number; d: number };
  /**
   * Seeded at settlement init and never player-buildable: hidden from the
   * build menu, rejected by command gates, excluded from age-advance counts.
   */
  seedOnly?: true;
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
  /** `unitArmor` modifiers add to BOTH values. */
  armor: { melee: number; pierce: number };
  /** Tiles per tick — army march speed now, per-unit movement in RTS mode. */
  speed: number;
  /** AoE-style counters as data. */
  attackBonuses?: { tag: UnitTag; mult: number }[];
  requiresAge: AgeId;
  requiresTechs?: TechId[];
  /** Multiplier vs fortifications (camps now, walls/keeps later). */
  siegeMult?: number;
  /** Set on unique units: only this culture may train it. */
  culture?: CultureId;
}
