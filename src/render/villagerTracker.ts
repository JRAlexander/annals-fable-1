import type { GameState } from '../sim/state';
import type { DeathEvent } from './unitTracker';

/**
 * Render-side villager observer (M12b): diffs `state.villagers` per tick and
 * reports the vanished as deaths at their last position — the effects layer
 * topples them exactly like fallen soldiers. Self-pruning, presentation only.
 */
export interface VillagerTracker {
  /** Call exactly once per sim tick. */
  diff(state: GameState): DeathEvent[];
}

export function createVillagerTracker(): VillagerTracker {
  const known = new Map<number, { x: number; z: number; owner: number }>();
  const seen = new Set<number>();

  return {
    diff(state) {
      const deaths: DeathEvent[] = [];
      seen.clear();
      for (const v of state.villagers) {
        seen.add(v.id);
        const owner = state.settlements[v.settlement]?.ownerRealm ?? 0;
        const prev = known.get(v.id);
        if (prev) {
          prev.x = v.x;
          prev.z = v.z;
          prev.owner = owner;
        } else {
          known.set(v.id, { x: v.x, z: v.z, owner });
        }
      }
      for (const [id, snap] of known) {
        if (seen.has(id)) continue;
        deaths.push({ x: snap.x, z: snap.z, owner: snap.owner, type: 'militia' });
        known.delete(id);
      }
      return deaths;
    },
  };
}
