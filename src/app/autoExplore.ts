import type { Command } from '../sim/commands';
import type { GameState } from '../sim/state';
import { hidx, worldToCell } from '../worldgen/coords';
import { GRID } from '../worldgen/types';
import { Fog } from './visibility';

/**
 * Auto-explore (M13b) — a PRESENTATION-layer autopilot. The sim has no fog by
 * design, so the explorer lives up here: whenever an enrolled army goes idle,
 * it reads the player's fog mask, finds the nearest unexplored ground, and
 * issues an ordinary RECORDED moveTo order — replay-safe by construction,
 * with not one line of sim code involved.
 */

/** How many idle ticks an ordered army may sit before its target is written off. */
const STUCK_TICKS = 5;

/**
 * Nearest unexplored, walkable cell by Chebyshev ring scan (the villagers'
 * resource-cell order — fixed and deterministic). `skip` holds cell hidx
 * values already tried and found unreachable.
 */
export function nearestFrontier(
  fog: Uint8Array,
  navCost: ArrayLike<number>,
  fromI: number,
  fromJ: number,
  skip?: ReadonlySet<number>,
): { i: number; j: number } | null {
  for (let r = 1; r < GRID; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = fromI + di;
        const j = fromJ + dj;
        if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
        const h = hidx(i, j);
        if (fog[h] !== Fog.Unexplored) continue;
        if (!Number.isFinite(navCost[h])) continue;
        if (skip?.has(h)) continue;
        return { i, j };
      }
    }
  }
  return null;
}

export interface AutoExploreHandle {
  /** Enroll or dismiss an army. Returns whether it is enrolled afterward. */
  toggle(armyId: number): boolean;
  has(armyId: number): boolean;
  /** Call once per sim tick, after the fog refresh. */
  update(): void;
  dispose(): void;
}

export function createAutoExplore(deps: {
  state: GameState;
  fogMask: Uint8Array;
  enqueue: (cmd: Command) => void;
}): AutoExploreHandle {
  interface Scout {
    /** An order is out; waiting for the army to start marching. */
    pending: boolean;
    /** hidx of the last frontier ordered, for the blacklist. */
    lastTarget: number;
    /** Ticks spent idle while pending — a rejected/unreachable order. */
    stuck: number;
    /** Frontiers this army could not reach. */
    barred: Set<number>;
  }
  const scouts = new Map<number, Scout>();

  return {
    toggle(armyId) {
      if (scouts.has(armyId)) {
        scouts.delete(armyId);
        return false;
      }
      scouts.set(armyId, { pending: false, lastTarget: -1, stuck: 0, barred: new Set() });
      return true;
    },
    has(armyId) {
      return scouts.has(armyId);
    },
    update() {
      for (const [id, scout] of scouts) {
        const army = deps.state.armies.find((a) => a.id === id);
        if (!army || army.ownerRealm !== 0) {
          scouts.delete(id); // fallen or turned — the watch ends
          continue;
        }
        if (army.phase !== 'idle' || army.objective) {
          // marching, fighting, or walking back to a post: the order took
          scout.pending = false;
          scout.stuck = 0;
          continue;
        }
        if (scout.pending) {
          // idle though ordered — rejected or unreachable; write the spot off
          scout.stuck += 1;
          if (scout.stuck >= STUCK_TICKS) {
            if (scout.lastTarget >= 0) scout.barred.add(scout.lastTarget);
            scout.pending = false;
            scout.stuck = 0;
          }
          continue;
        }
        const from = worldToCell(army.x, army.z);
        const target = nearestFrontier(deps.fogMask, deps.state.world.navCost, from.i, from.j, scout.barred);
        if (!target) {
          scouts.delete(id); // the map is known (or nothing left is reachable)
          continue;
        }
        deps.enqueue({
          kind: 'orderArmy',
          army: id,
          objective: { kind: 'moveTo', i: target.i, j: target.j },
        });
        scout.pending = true;
        scout.lastTarget = hidx(target.i, target.j);
        scout.stuck = 0;
      }
    },
    dispose() {
      scouts.clear();
    },
  };
}
