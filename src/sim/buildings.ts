import { BUILDINGS } from '../content/buildings';
import { JOB_RESOURCE, WORK_JOBS, type WorkJob } from '../content/economy';
import type { SimSettlement } from './state';

export interface BuildingContrib {
  housing: number;
  storage: number;
  jobSlots: Record<WorkJob, number>;
  /** Total fortification HP (town center + walls + keep) shielding a siege. */
  fortHp: number;
}

/** What a settlement's completed buildings add to housing, storage, worker slots, and forts. */
export function buildingContrib(s: SimSettlement): BuildingContrib {
  const contrib: BuildingContrib = {
    housing: 0,
    storage: 0,
    jobSlots: { farm: 0, forest: 0, quarry: 0, trade: 0 },
    fortHp: 0,
  };
  for (const [id, rawCount] of Object.entries(s.buildings)) {
    const def = BUILDINGS[id];
    const count = rawCount ?? 0;
    if (!def || count <= 0) continue;
    for (const fn of def.functions) {
      switch (fn.kind) {
        case 'housing':
          contrib.housing += fn.capacity * count;
          break;
        case 'storage':
          contrib.storage += fn.capacity * count;
          break;
        case 'production': {
          const job = WORK_JOBS.find((j) => JOB_RESOURCE[j] === fn.resource);
          if (job) contrib.jobSlots[job] += fn.workers * count;
          break;
        }
        case 'fort':
          contrib.fortHp += fn.hp * count;
          break;
        default:
          break;
      }
    }
  }
  return contrib;
}

/** Siege fortification pool: what attackers must burn before the town bleeds fully. */
export function settlementFortHp(s: SimSettlement): number {
  return buildingContrib(s).fortHp;
}

/** Effective worker capacity for a job: what the land offers plus what was built. */
export function jobCapacity(s: SimSettlement, job: WorkJob): number {
  return s.siteCapacity[job] + buildingContrib(s).jobSlots[job];
}
