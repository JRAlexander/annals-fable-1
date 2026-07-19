import { LOSING_RATIO, PEACE_BASE, RESOURCE_VALUE, TRIBUTE_FRACTION } from '../content/diplomacy';
import type { Cost, ResourceId } from '../content/schema';
import { power } from './combat';
import type { GameState, Realm, RealmId } from './state';

/**
 * Diplomacy arithmetic (M15) — pure, rng-free helpers shared by the
 * offerPeace command handler, the AI's diplomatic thinking, and the UI's
 * "they will accept" hint. Fixed iteration orders throughout.
 */

/** Tribute terms: what the offerer gives, and what it demands of the target. */
export interface Tribute {
  give?: Cost;
  demand?: Cost;
}

/** A realm's total fighting strength: every field army plus every garrison. */
export function warPower(state: GameState, realmId: RealmId): number {
  let total = 0;
  for (const a of state.armies) {
    if (a.ownerRealm === realmId) total += power(state, realmId, a.units);
  }
  for (const s of state.settlements) {
    if (s.ownerRealm === realmId) total += power(state, realmId, s.garrison);
  }
  return total;
}

/** Gold-equivalent worth of a mixed cost. */
export function tributeValue(cost: Cost | undefined): number {
  if (!cost) return 0;
  let v = 0;
  for (const [res, amt] of Object.entries(cost) as [ResourceId, number][]) {
    v += (amt ?? 0) * (RESOURCE_VALUE[res] ?? 0);
  }
  return v;
}

/** Is `a` losing its war against `b`? Strength collapse, not territory. */
export function isLosing(state: GameState, a: RealmId, b: RealmId): boolean {
  return warPower(state, a) < LOSING_RATIO * warPower(state, b);
}

/**
 * The runaway leader: the realm holding a STRICT majority of all
 * realm-owned settlements, or null when power is balanced.
 */
export function runawayLeader(state: GameState): RealmId | null {
  const counts = new Map<RealmId, number>();
  let total = 0;
  for (const s of state.settlements) {
    if (s.ownerRealm < 0) continue;
    counts.set(s.ownerRealm, (counts.get(s.ownerRealm) ?? 0) + 1);
    total += 1;
  }
  for (const realm of state.realms) {
    if ((counts.get(realm.id) ?? 0) * 2 > total) return realm.id;
  }
  return null;
}

/** AI realms that would join a pact against the current leader. */
export function isCoalitionMember(state: GameState, realmId: RealmId): boolean {
  const leader = runawayLeader(state);
  if (leader === null || leader === realmId) return false;
  return !(state.realms[realmId]?.isPlayer ?? true);
}

/**
 * Would `target` accept `offerer`'s peace terms? Pure — the command handler
 * decides with it, the AI pre-checks with it, the UI hints with it.
 */
export function acceptsPeace(state: GameState, target: Realm, offerer: Realm, tribute: Tribute): boolean {
  const give = tributeValue(tribute.give); // income, from the target's view
  const demand = tributeValue(tribute.demand);
  // a losing realm takes peace gladly, conceding up to a quarter of its wealth
  if (isLosing(state, target.id, offerer.id)) {
    return demand <= TRIBUTE_FRACTION * tributeValue(target.stock);
  }
  // common enemies make quick friends: coalition members white-peace freely
  if (isCoalitionMember(state, target.id) && isCoalitionMember(state, offerer.id)) {
    return give - demand >= 0;
  }
  // otherwise the stronger the target, the dearer the peace
  const ratio = warPower(state, target.id) / Math.max(1, warPower(state, offerer.id));
  const peacePrice = PEACE_BASE * Math.max(0, ratio - 1);
  return give - demand >= peacePrice;
}

/**
 * Is `attacker` actively prosecuting its war on `defender` — marching on a
 * town, hunting an army, or locked in battle? A realm under active attack
 * cannot buy its way out by suing: the campaign in flight belongs to the
 * attacker, and peace would rob it mid-stride.
 */
export function activelyAttacking(state: GameState, attacker: RealmId, defender: RealmId): boolean {
  for (const a of state.armies) {
    if (a.ownerRealm !== attacker) continue;
    const o = a.objective;
    if (o?.kind === 'attackSettlement' && state.settlements[o.settlement]?.ownerRealm === defender) {
      return true;
    }
    if (o?.kind === 'attackArmy') {
      const quarry = state.armies.find((x) => x.id === o.army);
      if (quarry && quarry.ownerRealm === defender) return true;
    }
    if (a.engagedWith !== undefined) {
      const foe = state.armies.find((x) => x.id === a.engagedWith);
      if (foe && foe.ownerRealm === defender) return true;
    }
  }
  return false;
}

/** What a suing AI offers: a quarter of everything, floored, zeros omitted. */
export function aiPeaceOffer(realm: Realm): Cost {
  const give: Cost = {};
  for (const [res, amt] of Object.entries(realm.stock) as [ResourceId, number][]) {
    const share = Math.floor((amt ?? 0) * TRIBUTE_FRACTION);
    if (share > 0) give[res] = share;
  }
  return give;
}
