import type { UnitId } from '../content/schema';
import { UNITS } from '../content/units';
import type { GameState } from '../sim/state';

/**
 * Presentation-side combat observer (M10). The sim emits no per-soldier
 * events, so the render layer derives them by diffing `state.units` once per
 * tick: a cooldown that jumped UP is a swing (the engine only ever decrements
 * it, or resets it on a strike); an id that vanished is a death at its last
 * known position. Pure bookkeeping — never mutates sim state, and the map
 * self-prunes to live ids every pass, so it cannot leak.
 */

export interface DeathEvent {
  x: number;
  z: number;
  owner: number;
  type: UnitId;
}

export interface SwingEvent {
  id: number;
  x: number;
  z: number;
  owner: number;
  ranged: boolean;
  /** Nearest-enemy position at swing time (render-derived, presentation only). */
  tx: number;
  tz: number;
}

export interface TickCombatEvents {
  deaths: DeathEvent[];
  swings: SwingEvent[];
}

interface Snapshot {
  hp: number;
  maxHp: number;
  cd: number;
  x: number;
  z: number;
  type: UnitId;
  group: number;
}

export interface UnitTracker {
  /** Call exactly once per sim tick, after advanceTick. */
  diff(state: GameState): TickCombatEvents;
  /** Full health as first witnessed (muster hp includes tech modifiers). */
  maxHp(id: number): number | undefined;
}

export function createUnitTracker(): UnitTracker {
  const known = new Map<number, Snapshot>();
  const seen = new Set<number>();

  return {
    maxHp(id) {
      return known.get(id)?.maxHp;
    },

    diff(state) {
      const deaths: DeathEvent[] = [];
      const swings: SwingEvent[] = [];
      const ownerOf = new Map<number, number>();
      for (const a of state.armies) ownerOf.set(a.id, a.ownerRealm);

      seen.clear();
      for (const u of state.units) {
        seen.add(u.id);
        const prev = known.get(u.id);
        if (!prev) {
          known.set(u.id, { hp: u.hp, maxHp: u.hp, cd: u.cd, x: u.x, z: u.z, type: u.type, group: u.group });
          continue;
        }
        if (u.cd > prev.cd) {
          // a strike this tick — find whom it was aimed at (nearest hostile)
          const owner = ownerOf.get(u.group) ?? -1;
          let tx = u.x;
          let tz = u.z;
          let bestD2 = Number.POSITIVE_INFINITY;
          for (const e of state.units) {
            if ((ownerOf.get(e.group) ?? -1) === owner) continue;
            const dx = e.x - u.x;
            const dz = e.z - u.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              tx = e.x;
              tz = e.z;
            }
          }
          swings.push({
            id: u.id,
            x: u.x,
            z: u.z,
            owner,
            ranged: (UNITS[u.type]?.range ?? 0) > 0,
            tx,
            tz,
          });
        }
        prev.cd = u.cd;
        prev.hp = u.hp;
        // no healing exists; max() only self-corrects a mid-battle save resume
        prev.maxHp = Math.max(prev.maxHp, u.hp);
        prev.x = u.x;
        prev.z = u.z;
        prev.group = u.group;
      }

      // the fallen: known but no longer among the living — and the eviction sweep
      for (const [id, snap] of known) {
        if (seen.has(id)) continue;
        deaths.push({ x: snap.x, z: snap.z, owner: ownerOf.get(snap.group) ?? -1, type: snap.type });
        known.delete(id);
      }

      return { deaths, swings };
    },
  };
}
