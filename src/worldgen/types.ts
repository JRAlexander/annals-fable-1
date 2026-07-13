/** World span in metres (centered on 0). */
export const WORLD_SIZE = 6000;
/** Heightmap grid resolution (ANNALS shipped 96; bumped for finer terrain). */
export const GRID = 128;
/** Max terrain height in metres. */
export const MAX_HEIGHT = 520;
/** Normalized sea level in heightmap units. */
export const SEA_LEVEL = 0.3;
/** Grid-space distance constants in the ported code were tuned for a 96 grid. */
export const CELL_SCALE = GRID / 96;

export const Biome = {
  Meadow: 0,
  Farmland: 1,
  Deciduous: 2,
  Pine: 3,
  Rock: 4,
  Marsh: 5,
  Water: 6,
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];

export type SettlementTier = 'capital' | 'town' | 'village';

/**
 * Decorative buildings scattered at worldgen time so M0 has a lived-in world.
 * From M2 on, player/AI-constructed buildings (sim state) replace this layer.
 */
export const DECOR_ARCHS = [
  'house',
  'longhouse',
  'shop',
  'smithy',
  'mill',
  'granary',
  'tavern',
  'temple',
  'warehouse',
  'tower',
  'wall',
  'keep',
] as const;
export type DecorArch = (typeof DECOR_ARCHS)[number];

export interface DecorBuilding {
  arch: DecorArch;
  tier: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  w: number;
}

export interface SettlementSite {
  id: number;
  name: string;
  i: number;
  j: number;
  x: number;
  z: number;
  tier: SettlementTier;
  pop: number;
  radius: number;
  walls: number;
  isHarbor: boolean;
  buildings: DecorBuilding[];
}

export interface Road {
  a: number;
  b: number;
  /** Grid cells [i, j] along the route. */
  path: [number, number][];
  bridges: [number, number][];
}

export interface WorldData {
  seed: number;
  /** Prevailing wind in radians (used by the sim's weather from M1). */
  windDir: number;
  /** -1 = landlocked; 0..3 = which edge is sea (+x, -x, +z, -z). */
  coastEdge: number;
  heightmap: Float32Array;
  moist: Float32Array;
  biome: Uint8Array;
  riverDist: Float32Array;
  isRiver: Uint8Array;
  rivers: [number, number][][];
  settlements: SettlementSite[];
  capital: SettlementSite;
  roads: Road[];
  /** Per-cell movement cost (derived; unused until RTS pathfinding lands). */
  navCost: Float32Array;
}
