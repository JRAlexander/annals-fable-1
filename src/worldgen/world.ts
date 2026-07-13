import { makeStreams } from '../core/rng';
import { classifyBiomes } from './biomes';
import { carveRivers } from './hydrology';
import { buildNavGrid } from './navgrid';
import { buildRoads } from './roads';
import { scatterBuildings, siteSettlements } from './sites';
import { buildTerrain } from './terrain';
import type { WorldData } from './types';

/**
 * The full deterministic worldgen pipeline (ported from ANNALS):
 * terrain → rivers → biomes → settlement siting → roads → building scatter.
 * Same seed, same world — the seed is the save.
 */
export function generateWorld(seed: number): WorldData {
  const rng = makeStreams(seed).world;

  // drawn before terrain to keep the stream aligned with ANNALS, so a seed
  // produces a recognizably similar realm in both; the sim uses it for weather
  const windDir = rng() * 6.283;

  const { heightmap, coastEdge } = buildTerrain(seed, rng);
  const { rivers, riverDist, isRiver } = carveRivers(heightmap, rng);
  const { biome, moist } = classifyBiomes(seed, heightmap, riverDist);

  const fields = { heightmap, biome, riverDist, coastEdge };
  const settlements = siteSettlements(fields, rng);
  const roads = buildRoads(heightmap, biome, settlements, rng);
  for (const s of settlements) scatterBuildings(fields, s, rng);
  const navCost = buildNavGrid(heightmap, biome, roads);

  const capital = settlements.find((s) => s.tier === 'capital') ?? settlements[0];
  return {
    seed,
    windDir,
    coastEdge,
    heightmap,
    moist,
    biome,
    riverDist,
    isRiver,
    rivers,
    settlements,
    capital,
    roads,
    navCost,
  };
}
