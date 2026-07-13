import { BASE_GATHER_PER_TICK, JOB_RESOURCE, WORK_JOBS } from '../../content/economy';
import { jobCapacity } from '../buildings';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import type { GameState } from '../state';

/**
 * Every tick: workers gather into their realm's stockpile. Draws no rng.
 * Worker counts floor BEFORE rates apply — keep it that way or the exact
 * accounting tests get fragile.
 */
export function productionSystem(state: GameState, _out: SimEvent[]): void {
  for (const s of state.settlements) {
    const realm = state.realms[s.ownerRealm];
    const workers = Math.floor(s.pop * s.workRatio);
    if (workers <= 0) continue;

    const total = WORK_JOBS.reduce((t, job) => t + s.alloc[job], 0);
    if (total <= 0) continue;

    // desired per job, capped by land + buildings; spill remainder in fixed order
    const capacity: Record<string, number> = {};
    for (const job of WORK_JOBS) capacity[job] = jobCapacity(s, job);
    const assigned: Record<string, number> = {};
    let used = 0;
    for (const job of WORK_JOBS) {
      const want = Math.floor((workers * s.alloc[job]) / total);
      const got = Math.min(want, capacity[job]);
      assigned[job] = got;
      used += got;
    }
    // leftover workers spill ONLY into jobs the allocation actually weights —
    // zeroing a job means nobody works it, which is what makes the sliders real
    let leftover = workers - used;
    for (const job of WORK_JOBS) {
      if (leftover <= 0) break;
      if (s.alloc[job] <= 0) continue;
      const spare = capacity[job] - assigned[job];
      const add = Math.min(leftover, spare);
      assigned[job] += add;
      leftover -= add;
    }

    const ctx = { state, realm: s.ownerRealm, settlement: s.id };
    for (const job of WORK_JOBS) {
      if (assigned[job] <= 0) continue;
      const rate = resolveStat(ctx, BASE_GATHER_PER_TICK[job], {
        stat: 'gatherRate',
        resource: JOB_RESOURCE[job],
      });
      realm.stock[JOB_RESOURCE[job]] += assigned[job] * rate;
    }
  }
}
