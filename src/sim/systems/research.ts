import { AGES, nextAge } from '../../content/ages';
import { TECHS } from '../../content/techs';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import type { GameState } from '../state';

/**
 * Advances each realm's research slot (a tech, or the age advance itself).
 * Costs were paid when the job started; this only accumulates progress.
 * Realm-scoped researchSpeed means a university anywhere in the realm helps.
 */
export function researchSystem(state: GameState, out: SimEvent[]): void {
  for (const realm of state.realms) {
    const job = realm.research;
    if (!job) continue;
    job.progress += resolveStat({ state, realm: realm.id }, 1, { stat: 'researchSpeed' });

    if (job.kind === 'tech') {
      const def = TECHS[job.tech];
      if (!def) {
        // content changed under a save — drop rather than wedge the slot
        realm.research = null;
        continue;
      }
      if (job.progress >= def.researchTime) {
        realm.researchedTechs.push(def.id);
        realm.research = null;
        out.push({ kind: 'researchCompleted', realm: realm.id, tech: def.id });
      }
    } else {
      const target = nextAge(realm.age);
      if (!target) {
        realm.research = null;
        continue;
      }
      if (job.progress >= AGES[target].advanceTime) {
        realm.age = target;
        realm.research = null;
        out.push({ kind: 'ageAdvanced', realm: realm.id, age: target });
      }
    }
  }
}
