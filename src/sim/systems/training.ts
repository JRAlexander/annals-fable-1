import { UNITS } from '../../content/units';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import type { GameState } from '../state';

/**
 * Advances the head of each settlement's training queue (one unit at a time).
 * Costs and population were paid at queue time; completions join the garrison.
 */
export function trainingSystem(state: GameState, out: SimEvent[]): void {
  for (const s of state.settlements) {
    const job = s.trainQueue[0];
    if (!job) continue;
    const def = UNITS[job.unit];
    if (!def) {
      s.trainQueue.shift();
      continue;
    }
    job.progress += resolveStat({ state, realm: s.ownerRealm, settlement: s.id }, 1, {
      stat: 'trainSpeed',
      unitTag: def.tags[0],
    });
    if (job.progress >= def.trainTime) {
      s.garrison[def.id] = (s.garrison[def.id] ?? 0) + 1;
      job.remaining -= 1;
      job.progress = 0;
      out.push({ kind: 'unitsTrained', settlement: s.id, unit: def.id, count: 1 });
      if (job.remaining <= 0) s.trainQueue.shift();
    }
  }
}
