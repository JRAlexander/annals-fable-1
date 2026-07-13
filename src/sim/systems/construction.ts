import { BUILDINGS } from '../../content/buildings';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import type { GameState } from '../state';

/**
 * Advances the head of each settlement's build queue. Costs were already paid
 * at queue time (in applyCommands), so this only accumulates progress and
 * completes buildings.
 */
export function constructionSystem(state: GameState, out: SimEvent[]): void {
  for (const s of state.settlements) {
    const job = s.buildQueue[0];
    if (!job) continue;
    const def = BUILDINGS[job.building];
    if (!def) {
      // content changed under a save — drop the orphaned job rather than wedge the queue
      s.buildQueue.shift();
      continue;
    }
    job.progress += resolveStat({ state, realm: s.ownerRealm, settlement: s.id }, 1, {
      stat: 'buildSpeed',
      buildingId: def.id,
    });
    if (job.progress >= def.buildTime) {
      s.buildQueue.shift();
      s.buildings[def.id] = (s.buildings[def.id] ?? 0) + 1;
      out.push({ kind: 'buildingCompleted', settlement: s.id, building: def.id });
    }
  }
}
