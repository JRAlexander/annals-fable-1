import {
  CARRY_CAPACITY,
  GATHER_TICKS,
  IDLE_HOME_RADIUS,
  JOB_RESOURCE,
  RESOURCE_SEARCH_CELLS,
  VILLAGER_JOBS,
  VILLAGER_SPEED,
  VILLAGER_TRAIN_TICKS,
  type VillagerJob,
} from '../../content/economy';
import { FLEE_RADIUS } from '../../content/rts';
import { cellPos, hidx, worldToCell } from '../../worldgen/coords';
import type { WorldData } from '../../worldgen/types';
import { Biome, GRID } from '../../worldgen/types';
import { dropoffsOf, workplaceSlots, workplacesOf } from '../buildings';
import { hostileToRealm, totalUnits } from '../combat';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import type { GameState, SimSettlement, Villager } from '../state';

/**
 * The villager economy (M12): every resource in the stockpile was carried
 * there by someone. Villagers walk to a workplace (farm/market building, or
 * a forest/rock cell), dwell to fill a load, and haul it to the nearest
 * accepting dropoff — the round-trip time IS the gather rate, so a lumber
 * camp at the treeline genuinely out-earns hauling to the town center.
 *
 * Entirely rng-free: fixed iteration order, deterministic targeting, and a
 * per-world cache of the static resource-cell scan.
 */

const JOB_BIOMES: Partial<Record<VillagerJob, readonly number[]>> = {
  wood: [Biome.Deciduous, Biome.Pine],
  stone: [Biome.Rock],
};

/** Nearest matching biome cell per (settlement, job) — static geography, cached per world. */
const cellCache = new WeakMap<WorldData, Map<string, { x: number; z: number } | null>>();

function resourceCell(world: WorldData, siteIdx: number, job: VillagerJob): { x: number; z: number } | null {
  let cache = cellCache.get(world);
  if (!cache) {
    cache = new Map();
    cellCache.set(world, cache);
  }
  const key = `${siteIdx}:${job}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const biomes = JOB_BIOMES[job];
  const site = world.settlements[siteIdx];
  let found: { x: number; z: number } | null = null;
  if (biomes) {
    const c = worldToCell(site.x, site.z);
    // ring scan by Chebyshev distance, fixed order — nearest wins deterministically
    outer: for (let r = 1; r <= RESOURCE_SEARCH_CELLS; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = c.i + di;
          const j = c.j + dj;
          if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
          if (!biomes.includes(world.biome[hidx(i, j)])) continue;
          // same-side test: the straight line home must not cross open water
          const p = cellPos(i, j);
          let wet = false;
          for (let t = 1; t <= 4; t++) {
            const sx = site.x + ((p.x - site.x) * t) / 5;
            const sz = site.z + ((p.z - site.z) * t) / 5;
            const sc = worldToCell(sx, sz);
            if (!Number.isFinite(world.navCost[hidx(sc.i, sc.j)])) {
              wet = true;
              break;
            }
          }
          if (!wet) {
            found = { x: p.x, z: p.z };
            break outer;
          }
          if (!found) found = { x: p.x, z: p.z }; // fallback: nearest even across water
        }
      }
    }
  }
  cache.set(key, found);
  return found;
}

/** Deterministic scatter so co-workers don't stand in one point. */
const jitter = (id: number, axis: number) => (((id * 37 + axis * 17) % 5) - 2) * 6;

/** The workplace position for the k-th villager on a job (round-robin over buildings). */
function workTarget(
  state: GameState,
  s: SimSettlement,
  job: VillagerJob,
  k: number,
  id: number,
): { x: number; z: number } | null {
  if (job === 'wood' || job === 'stone') {
    const cell = resourceCell(state.world, s.id, job);
    return cell ? { x: cell.x + jitter(id, 0), z: cell.z + jitter(id, 1) } : null;
  }
  const places = workplacesOf(s, JOB_RESOURCE[job]);
  if (places.length === 0) return null;
  const pb = places[k % places.length];
  return { x: pb.x + jitter(id, 0), z: pb.z + jitter(id, 1) };
}

/** Nearest dropoff accepting the resource; the town center always qualifies. */
function dropTarget(state: GameState, s: SimSettlement, job: VillagerJob, fromX: number, fromZ: number) {
  const drops = dropoffsOf(s, JOB_RESOURCE[job]);
  let best = { x: state.world.settlements[s.id].x, z: state.world.settlements[s.id].z };
  let bestD = Number.POSITIVE_INFINITY;
  for (const d of drops) {
    const dist = (d.x - fromX) * (d.x - fromX) + (d.z - fromZ) * (d.z - fromZ);
    if (dist < bestD) {
      bestD = dist;
      best = { x: d.x, z: d.z };
    }
  }
  return best;
}

/** One straight-line step; refuses to wade into open water (axis slides first). */
function step(world: WorldData, v: Villager): void {
  const dx = v.tx - v.x;
  const dz = v.tz - v.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= VILLAGER_SPEED) {
    v.x = v.tx;
    v.z = v.tz;
    return;
  }
  const nx = v.x + (dx / dist) * VILLAGER_SPEED;
  const nz = v.z + (dz / dist) * VILLAGER_SPEED;
  const dry = (x: number, z: number) => {
    const c = worldToCell(x, z);
    return Number.isFinite(world.navCost[hidx(c.i, c.j)]);
  };
  if (dry(nx, nz)) {
    v.x = nx;
    v.z = nz;
  } else if (dry(nx, v.z)) {
    v.x = nx;
  } else if (dry(v.x, nz)) {
    v.z = nz;
  }
  // else: stand this tick — the river wins
}

export function villagersSystem(state: GameState, out: SimEvent[]): void {
  // every villager remembers where it stood — the renderer interpolates
  for (const v of state.villagers) {
    v.prevX = v.x;
    v.prevZ = v.z;
  }

  // flee (M13): towns with a hostile army in sight call everyone home
  const threatened = new Set<number>();
  for (const s of state.settlements) {
    const site = state.world.settlements[s.id];
    for (const a of state.armies) {
      if (totalUnits(a.units) <= 0 || !hostileToRealm(state, s.ownerRealm, a)) continue;
      if (Math.hypot(a.x - site.x, a.z - site.z) <= FLEE_RADIUS) {
        threatened.add(s.id);
        break;
      }
    }
  }

  for (const s of state.settlements) {
    const site = state.world.settlements[s.id];

    // --- the training yard: one villager at a time steps off the queue ---
    if (s.villagerQueue.remaining > 0) {
      s.villagerQueue.progress += 1;
      if (s.villagerQueue.progress >= VILLAGER_TRAIN_TICKS) {
        s.villagerQueue.progress = 0;
        s.villagerQueue.remaining -= 1;
        state.villagers.push({
          id: state.nextVillagerId++,
          settlement: s.id,
          job: 'idle',
          phase: 'toWork',
          x: site.x,
          z: site.z,
          prevX: site.x,
          prevZ: site.z,
          tx: site.x,
          tz: site.z,
          carry: 0,
          timer: 0,
        });
        out.push({ kind: 'villagersTrained', settlement: s.id, count: 1 });
      }
    }

    // --- reconcile jobs to targets (fixed job order; ids break ties) ---
    const mine = state.villagers.filter((v) => v.settlement === s.id);
    for (const job of VILLAGER_JOBS) {
      const capacity =
        job === 'wood' || job === 'stone' ? Number.POSITIVE_INFINITY : workplaceSlots(s, JOB_RESOURCE[job]);
      const want = Math.min(s.jobTargets[job], capacity);
      const workers = mine.filter((v) => v.job === job);
      if (workers.length > want) {
        // the surplus hands its baskets over and goes home (highest id first)
        for (const v of workers.sort((a, b) => b.id - a.id).slice(0, workers.length - want)) {
          if (v.carry > 0) {
            state.realms[s.ownerRealm].stock[JOB_RESOURCE[job]] += v.carry;
            v.carry = 0;
          }
          v.job = 'idle';
          v.phase = 'toWork';
          v.timer = 0;
        }
      } else if (workers.length < want) {
        const idle = mine.filter((v) => v.job === 'idle').sort((a, b) => a.id - b.id);
        let need = want - workers.length;
        let k = workers.length;
        for (const v of idle) {
          if (need <= 0) break;
          const t = workTarget(state, s, job, k, v.id);
          if (!t) break; // no workplace stands — the rest stay idle
          v.job = job;
          v.phase = 'toWork';
          v.tx = t.x;
          v.tz = t.z;
          v.timer = 0;
          k++;
          need--;
        }
      }
    }
  }

  // --- the working day: walk, dwell, haul, deposit (villager array order) ---
  for (const v of state.villagers) {
    const s = state.settlements[v.settlement];
    if (!s) continue;
    const site = state.world.settlements[v.settlement];

    // flee override (M13): drop the day's work and make for the town center.
    // Framed as a haul home, so the ordinary toDropoff arrival deposits any
    // carry and re-derives the workplace once the danger has passed.
    if (v.job !== 'idle' && threatened.has(v.settlement)) {
      v.phase = 'toDropoff';
      v.tx = site.x;
      v.tz = site.z;
      v.timer = 0;
    }

    if (v.job === 'idle') {
      // drift home and loiter by the town center
      const d = Math.hypot(site.x - v.x, site.z - v.z);
      if (d > IDLE_HOME_RADIUS) {
        v.tx = site.x;
        v.tz = site.z;
        step(state.world, v);
      }
      continue;
    }

    if (v.phase === 'toWork') {
      step(state.world, v);
      if (v.x === v.tx && v.z === v.tz) {
        v.phase = 'working';
        v.timer = GATHER_TICKS[v.job];
      }
    } else if (v.phase === 'working') {
      v.timer -= 1;
      if (v.timer <= 0) {
        const res = JOB_RESOURCE[v.job];
        v.carry = resolveStat({ state, realm: s.ownerRealm, settlement: s.id }, CARRY_CAPACITY, {
          stat: 'gatherRate',
          resource: res,
        });
        const drop = dropTarget(state, s, v.job, v.x, v.z);
        v.tx = drop.x;
        v.tz = drop.z;
        v.phase = 'toDropoff';
      }
    } else {
      // toDropoff
      step(state.world, v);
      if (v.x === v.tx && v.z === v.tz) {
        state.realms[s.ownerRealm].stock[JOB_RESOURCE[v.job]] += v.carry;
        v.carry = 0;
        // back out for another load — re-derive the workplace (buildings may have changed)
        const mine = state.villagers.filter((o) => o.settlement === s.id && o.job === v.job);
        const k = mine.findIndex((o) => o.id === v.id);
        const t = workTarget(state, s, v.job, Math.max(0, k), v.id);
        if (t) {
          v.tx = t.x;
          v.tz = t.z;
          v.phase = 'toWork';
        } else {
          v.job = 'idle';
          v.phase = 'toWork';
        }
      }
    }
  }
}

/** The sword falls on the fields too: kill a fraction of a town's villagers. */
export function killVillagers(state: GameState, settlement: number, fraction: number): number {
  const mine = state.villagers.filter((v) => v.settlement === settlement);
  const toll = Math.floor(mine.length * fraction);
  if (toll <= 0) return 0;
  // the highest ids fall first — the newest hands, deterministically
  const doomed = new Set(
    mine
      .sort((a, b) => b.id - a.id)
      .slice(0, toll)
      .map((v) => v.id),
  );
  state.villagers = state.villagers.filter((v) => !doomed.has(v.id));
  return toll;
}
