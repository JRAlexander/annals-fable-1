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
 * A settlement SITE is pure geography: where a town may stand and how much
 * room it has. Everything that lives there — population, buildings, walls —
 * is sim state seeded at init (M9 removed the ANNALS decorative layer).
 */
export interface SettlementSite {
  id: number;
  name: string;
  i: number;
  j: number;
  x: number;
  z: number;
  tier: SettlementTier;
  radius: number;
  isHarbor: boolean;
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
  /** Per-cell movement cost — armies path over this from M4. */
  navCost: Float32Array;
  /** Bandit camp sites (static geography; live camp state is in GameState). */
  camps: import('./camps').CampSite[];
}
