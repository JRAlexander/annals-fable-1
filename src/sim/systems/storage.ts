import { STORAGE_BASE } from '../../content/economy';
import type { ResourceId } from '../../content/schema';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import type { GameState } from '../state';
import { isDayEnd } from '../time';

const RESOURCES: readonly ResourceId[] = ['food', 'wood', 'stone', 'gold'];

/**
 * Every tick: recompute realm storage caps from settlement tiers (M2 storage
 * buildings add here) and clamp stockpiles. storageFull only fires on the
 * daily boundary to avoid event spam.
 */
export function storageSystem(state: GameState, out: SimEvent[]): void {
  for (const realm of state.realms) {
    const cap: Record<ResourceId, number> = { food: 0, wood: 0, stone: 0, gold: 0 };
    for (const s of state.settlements) {
      if (s.ownerRealm !== realm.id) continue;
      const tier = state.world.settlements[s.id].tier;
      const per = resolveStat({ state, realm: realm.id, settlement: s.id }, STORAGE_BASE[tier], {
        stat: 'storageCap',
      });
      for (const r of RESOURCES) cap[r] += per;
    }
    realm.storageCap = cap;
    for (const r of RESOURCES) {
      if (realm.stock[r] >= cap[r]) {
        realm.stock[r] = cap[r];
        if (isDayEnd(state.tick)) out.push({ kind: 'storageFull', realm: realm.id, resource: r });
      }
    }
  }
}
