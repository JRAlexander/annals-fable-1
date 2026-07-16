import { terrainHeight } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { MAX_HEIGHT, SEA_LEVEL } from '../worldgen/types';

const GOLDEN_ANGLE = 2.399963;

/**
 * Where the k-th auto-placed building of a settlement stands: a golden-angle
 * ring outside the town, walking outward off any water. Pure geometry —
 * identical on every client and every replay. Since M12 the SIM owns this
 * (completed buildings always get a real position — villagers walk to them);
 * the render layers consume the same function so nothing can drift.
 */
export function ringSpot(
  world: WorldData,
  siteIdx: number,
  k: number,
): { x: number; z: number; y: number; rot: number } {
  const site = world.settlements[siteIdx];
  const radius = site.radius * 1.12;
  const angle = site.id * 1.7 + k * GOLDEN_ANGLE;
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = site.x + Math.cos(angle) * (radius + attempt * 24);
    const z = site.z + Math.sin(angle) * (radius + attempt * 24);
    const y = terrainHeight(world.heightmap, x, z);
    if (y > SEA_LEVEL * MAX_HEIGHT + 2) return { x, z, y, rot: angle + Math.PI / 2 };
  }
  const y = terrainHeight(world.heightmap, site.x, site.z);
  return { x: site.x, z: site.z, y, rot: 0 };
}
