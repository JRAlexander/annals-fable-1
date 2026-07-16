import type { IssuedCommand } from '../commands';
import type { GameState } from '../state';
import { dateOf, isDayEnd } from '../time';
import { villagerEconomy } from './ai';

/**
 * The town governor (M13): player settlements that opted in get their villager
 * economy run by the AI's own housekeeping book. Like aiSystem, this runs
 * INSIDE the tick and its commands are never recorded — replay regenerates
 * them because it is a pure function of state. Governor seqs start far above
 * any per-tick player counter, so the player's recorded commands always apply
 * first within the tick, live and in replay alike.
 */
export const GOVERNOR_SEQ_BASE = 1_000_000_000;

export function governorSystem(state: GameState): IssuedCommand[] {
  if (!isDayEnd(state.tick)) return [];
  const out: IssuedCommand[] = [];
  const day = dateOf(state.tick).day;
  let n = 0;
  for (const s of state.settlements) {
    if (!s.governor) continue;
    const realm = state.realms[s.ownerRealm];
    // AI realms already govern every town they hold — this layer is the player's
    if (!realm?.isPlayer) continue;
    for (const cmd of villagerEconomy(state, realm, s, day)) {
      out.push({ tick: state.tick, realm: s.ownerRealm, seq: GOVERNOR_SEQ_BASE + n++, cmd });
    }
  }
  return out;
}
