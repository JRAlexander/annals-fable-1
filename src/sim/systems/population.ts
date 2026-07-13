import {
  BASE_GROWTH_PER_DAY,
  FOOD_PER_POP_DAY,
  HOUSING_BASE,
  POP_MILESTONES,
  STARVATION_RATE,
} from '../../content/economy';
import { buildingContrib } from '../buildings';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import type { GameState } from '../state';

/**
 * Daily: eat, then grow (fed, under the housing cap) or starve (shortfall).
 * Pop stays a float in state; milestones compare floored values.
 */
export function populationSystem(state: GameState, out: SimEvent[]): void {
  for (const realm of state.realms) {
    const mine = state.settlements.filter((s) => s.ownerRealm === realm.id);
    let totalPop = 0;
    for (const s of mine) totalPop += s.pop;
    if (totalPop <= 0) continue;

    const need = totalPop * FOOD_PER_POP_DAY;
    const have = realm.stock.food;

    if (have >= need) {
      realm.stock.food = have - need;
      for (const s of mine) {
        const ctx = { state, realm: realm.id, settlement: s.id };
        const tier = state.world.settlements[s.id].tier;
        const base = HOUSING_BASE[tier] + buildingContrib(s).housing;
        s.popCap = resolveStat(ctx, base, { stat: 'housingCap' });
        if (s.pop >= s.popCap) continue;
        const growth = s.pop * resolveStat(ctx, BASE_GROWTH_PER_DAY, { stat: 'popGrowth' });
        const before = Math.floor(s.pop);
        s.pop = Math.min(s.popCap, s.pop + growth);
        for (const m of POP_MILESTONES) {
          if (before < m && Math.floor(s.pop) >= m)
            out.push({ kind: 'popMilestone', settlement: s.id, milestone: m });
        }
      }
    } else {
      const shortfall = (need - have) / need;
      realm.stock.food = 0;
      for (const s of mine) {
        const deaths = s.pop * STARVATION_RATE * shortfall;
        if (deaths <= 0) continue;
        s.pop = Math.max(0, s.pop - deaths);
        out.push({ kind: 'starvation', settlement: s.id, deaths: Math.ceil(deaths) });
      }
    }
  }
}
