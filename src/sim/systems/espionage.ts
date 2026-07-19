import {
  KEEP_PENALTY,
  SABOTAGE_SETBACK,
  SPY_BASE_SUCCESS,
  SPY_MIN_SUCCESS,
  STEAL_FRACTION,
} from '../../content/espionage';
import { chance, type Rng } from '../../core/rng';
import { warPower } from '../diplomacy';
import type { SimEvent } from '../events';
import type { ConstructionJob, GameState, RealmId } from '../state';
import { dateOf, isDayEnd } from '../time';

/**
 * Espionage (M16): dispatched missions come due and are resolved here — the
 * ONLY consumer of the reserved `ai` rng stream in the whole sim. Discipline:
 * exactly ONE draw per resolving mission, success or failure, effect or no
 * effect, so the stream's position is a pure function of how many missions
 * resolved — never of their outcomes. Missions resolve in array order (the
 * command queue's realm→seq ordering made the array deterministic). Failure
 * means the agent is caught: the fee is sunk, the chronicle names the shame.
 * Fog is the app's business — scout success only EMITS; nothing here reads
 * or writes visibility.
 */

/** Odds a mission lands, after the target's keeps take their toll. Pure; UI-safe. */
export function successChance(state: GameState, target: RealmId): number {
  let keeps = 0;
  for (const s of state.settlements) {
    if (s.ownerRealm === target) keeps += s.buildings.keep ?? 0;
  }
  return Math.max(SPY_MIN_SUCCESS, Math.min(1, SPY_BASE_SUCCESS - KEEP_PENALTY * keeps));
}

/**
 * The job worth wrecking: any Wonder under construction anywhere (lowest
 * settlement id wins ties), else the head job furthest along.
 */
function pickSabotageJob(
  state: GameState,
  target: RealmId,
): { settlement: number; job: ConstructionJob } | null {
  let wonder: { settlement: number; job: ConstructionJob } | null = null;
  let best: { settlement: number; job: ConstructionJob } | null = null;
  for (const s of state.settlements) {
    if (s.ownerRealm !== target) continue;
    for (const job of s.buildQueue) {
      if (job.building === 'wonder' && !wonder) wonder = { settlement: s.id, job };
    }
    const head = s.buildQueue[0];
    if (head && (!best || head.progress > best.job.progress)) best = { settlement: s.id, job: head };
  }
  return wonder ?? best;
}

export function espionageSystem(state: GameState, out: SimEvent[], rng: Rng): void {
  if (!isDayEnd(state.tick)) return;
  const day = dateOf(state.tick).day;
  if (!state.missions.some((m) => m.resolveDay <= day)) return;

  const pending: typeof state.missions = [];
  for (const m of state.missions) {
    if (m.resolveDay > day) {
      pending.push(m);
      continue;
    }
    // ONE draw, always — even when the target is gone or there is nothing
    // to wreck or steal; see the header
    const landed = chance(rng, successChance(state, m.target));
    const actor = state.realms[m.realm];
    const target = state.realms[m.target];
    if (!actor || !target) continue;
    if (!landed) {
      out.push({ kind: 'spyCaught', realm: m.realm, target: m.target, mission: m.mission });
      continue;
    }
    switch (m.mission) {
      case 'scout':
        out.push({ kind: 'spyReport', realm: m.realm, target: m.target, settlement: m.settlement ?? -1 });
        break;
      case 'intel':
        out.push({
          kind: 'spyIntel',
          realm: m.realm,
          target: m.target,
          // snapshots, never live references — the UI keeps these events
          stock: { ...target.stock },
          power: warPower(state, m.target),
          wars: [...target.atWarWith],
          truces: { ...target.truceUntil },
          age: target.age,
          wonderBuilding: state.settlements.some(
            (s) => s.ownerRealm === m.target && s.buildQueue.some((j) => j.building === 'wonder'),
          ),
        });
        break;
      case 'sabotage': {
        const picked = pickSabotageJob(state, m.target);
        if (picked) picked.job.progress = Math.max(0, picked.job.progress - SABOTAGE_SETBACK);
        out.push({
          kind: 'spySabotage',
          realm: m.realm,
          target: m.target,
          settlement: picked?.settlement ?? -1,
          building: picked?.job.building ?? null,
        });
        break;
      }
      case 'steal': {
        const amount = Math.floor((target.stock.gold ?? 0) * STEAL_FRACTION);
        target.stock.gold -= amount;
        actor.stock.gold += amount; // the storage clamp trims overflow later this tick
        out.push({ kind: 'spyTheft', realm: m.realm, target: m.target, gold: amount });
        break;
      }
    }
  }
  state.missions = pending;
}
