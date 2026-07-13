import { WONDER_DAYS } from '../../content/threats';
import type { SimEvent } from '../events';
import type { GameState } from '../state';
import { dateOf, isDayEnd } from '../time';

/**
 * Win/lose checks, daily. Writes `state.outcome` exactly once (latched); the
 * sim keeps ticking afterwards — the world outlives the game.
 *
 * Defeat: the player's capital is held by another realm.
 * Conquest: the player holds EVERY realm's capital.
 * Wonder: a realm's wonder has stood complete for WONDER_DAYS.
 */
export function victorySystem(state: GameState, out: SimEvent[]): void {
  if (!isDayEnd(state.tick)) return;
  const day = dateOf(state.tick).day;

  // wonder clocks start the day the monument stands (any realm — the race is real)
  for (const realm of state.realms) {
    if (realm.wonderDay !== null) continue;
    const site = state.settlements.find((s) => s.ownerRealm === realm.id && (s.buildings.wonder ?? 0) > 0);
    if (site) {
      realm.wonderDay = day;
      out.push({ kind: 'wonderCompleted', realm: realm.id, settlement: site.id });
    }
  }
  // a wonder lost with its settlement stops counting
  for (const realm of state.realms) {
    if (realm.wonderDay === null) continue;
    const stillStands = state.settlements.some(
      (s) => s.ownerRealm === realm.id && (s.buildings.wonder ?? 0) > 0,
    );
    if (!stillStands) realm.wonderDay = null;
  }

  if (state.outcome) return; // the ending is already written

  const player = state.realms[0];
  const capitalOwner = state.settlements[player.capital]?.ownerRealm;
  if (capitalOwner !== undefined && capitalOwner !== 0) {
    state.outcome = { kind: 'defeat' };
    out.push({ kind: 'gameLost' });
    return;
  }

  if (state.realms.every((r) => state.settlements[r.capital]?.ownerRealm === 0)) {
    state.outcome = { kind: 'victory', how: 'conquest' };
    out.push({ kind: 'gameWon', how: 'conquest' });
    return;
  }

  if (player.wonderDay !== null && day - player.wonderDay >= WONDER_DAYS) {
    state.outcome = { kind: 'victory', how: 'wonder' };
    out.push({ kind: 'gameWon', how: 'wonder' });
  }
}
