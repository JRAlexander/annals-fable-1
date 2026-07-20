import type { IssuedCommand } from '../commands';
import type { GameState } from '../state';
import { dateOf, isDayEnd } from '../time';
import { stewardBuildings, stewardResearch, stewardTrade } from './ai';

/**
 * The town steward (M14): opted-in player settlements get their construction
 * run by the AI's own building book, and a realm with any steward also fills
 * an idle research slot by the same book. Governor-pattern throughout: runs
 * INSIDE the tick, unrecorded, a pure function of state — replays regenerate
 * it. The seq base keeps steward commands after the player's (and the
 * governor's) within a tick, so manual orders always pre-empt.
 */
export const STEWARD_SEQ_BASE = 2_000_000_000;

export function stewardSystem(state: GameState): IssuedCommand[] {
  if (!isDayEnd(state.tick)) return [];
  const out: IssuedCommand[] = [];
  const day = dateOf(state.tick).day;
  let n = 0;
  const researched = new Set<number>(); // one research pick per realm per day
  for (const s of state.settlements) {
    if (!s.steward) continue;
    const realm = state.realms[s.ownerRealm];
    // AI realms already run the book everywhere — the steward is the player's
    if (!realm?.isPlayer) continue;
    // per-town scope: this town's counts, this town's queue — a manually
    // queued building here simply pre-empts the steward for the day
    for (const cmd of stewardBuildings(state, realm, [s], s, day)) {
      out.push({ tick: state.tick, realm: s.ownerRealm, seq: STEWARD_SEQ_BASE + n++, cmd });
    }
    // a stewarded market town also keeps a caravan route running (M17)
    for (const cmd of stewardTrade(state, realm, [s])) {
      out.push({ tick: state.tick, realm: s.ownerRealm, seq: STEWARD_SEQ_BASE + n++, cmd });
    }
    if (!researched.has(realm.id)) {
      researched.add(realm.id);
      const towns = state.settlements.filter((x) => x.ownerRealm === realm.id);
      const research = stewardResearch(state, realm, towns);
      if (research) {
        out.push({ tick: state.tick, realm: s.ownerRealm, seq: STEWARD_SEQ_BASE + n++, cmd: research });
      }
    }
  }
  return out;
}
