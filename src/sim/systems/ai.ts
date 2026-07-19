import { AGES, nextAge } from '../../content/ages';
import { COALITION_GRACE_DAYS } from '../../content/diplomacy';
import { FOOD_PER_POP_DAY, STARTING_VILLAGERS, VILLAGER_JOBS, type VillagerJob } from '../../content/economy';
import { SPY_COST } from '../../content/espionage';
import type { BuildingId, TechId } from '../../content/schema';
import { TECHS } from '../../content/techs';
import { UNITS } from '../../content/units';
import { totalUnits } from '../combat';
import type { Command, IssuedCommand } from '../commands';
import { acceptsPeace, activelyAttacking, aiPeaceOffer, isLosing, runawayLeader } from '../diplomacy';
import type { GameState, Realm, SimSettlement } from '../state';
import { dateOf, isDayEnd } from '../time';

/**
 * One settlement's villager housekeeping: train toward a day-scaled target,
 * keep every hand assigned by a food-first split. Pure — reads state, returns
 * commands. The AI runs it on every rival town; the governor (M13) runs the
 * SAME book on player towns that opted in.
 */
export function villagerEconomy(state: GameState, realm: Realm, s: SimSettlement, day: number): Command[] {
  const out: Command[] = [];
  const mine = state.settlements.filter((x) => x.ownerRealm === realm.id);
  const realmPop = mine.reduce((t, x) => t + x.pop, 0);
  const foodBuffer = realmPop * FOOD_PER_POP_DAY * 30; // a season in the granary
  const site = state.world.settlements[s.id];
  const have = state.villagers.filter((v) => v.settlement === s.id).length + s.villagerQueue.remaining;
  const target = Math.min(30, STARTING_VILLAGERS[site.tier] + Math.floor(day / 90));
  if (have < target && realm.stock.food > 150 && s.pop - 2 >= 30) {
    out.push({ kind: 'trainVillagers', settlement: s.id, count: Math.min(2, target - have) });
  }
  // food first until the larder holds a season, then wood for the builders
  const n = state.villagers.filter((v) => v.settlement === s.id).length;
  const hungry = realm.stock.food < foodBuffer;
  const split: Record<VillagerJob, number> = hungry
    ? { farm: 0.5, wood: 0.3, stone: 0.1, gold: 0.1 }
    : { farm: 0.3, wood: 0.4, stone: 0.2, gold: 0.1 };
  for (const job of VILLAGER_JOBS) {
    const want = Math.floor(n * split[job]);
    if (s.jobTargets[job] !== want) out.push({ kind: 'assignVillagers', settlement: s.id, job, count: want });
  }
  return out;
}

/**
 * One realm's building book: one building at a time, in priority order —
 * farms lead (villagers can only work fields that exist), houses next because
 * a realm that stops housing stops growing. Pure. The AI runs it realm-wide;
 * the steward (M14) runs it per opted-in player town. The Wonder rush is
 * AI-only: committing 2000 stone and the victory clock is a player decision.
 */
export function stewardBuildings(
  state: GameState,
  realm: Realm,
  towns: SimSettlement[],
  seat: SimSettlement,
  day: number,
): Command[] {
  void state;
  if (towns.some((s) => s.buildQueue.length > 0)) return [];
  const count = (b: BuildingId) => towns.reduce((t, s) => t + (s.buildings[b] ?? 0), 0);
  const wants: [BuildingId, number][] = [
    ['farm', Math.max(1, Math.ceil(seat.jobTargets.farm / 5))],
    ['house', 2 + Math.floor(day / 90)],
    ['lumberCamp', 1],
    ['barracks', 1],
    ['storehouse', 1 + Math.floor(day / 300)],
    ['market', 1],
    ['quarry', 1],
    ['palisade', 1],
  ];
  // the endgame: a rich Golden-age AI realm races for the Wonder
  if (!realm.isPlayer && realm.age === 'golden' && count('wonder') === 0 && realm.stock.stone >= 2000) {
    wants.unshift(['wonder', 1]);
  }
  for (const [b, want] of wants) {
    if (count(b) < want) return [{ kind: 'queueBuilding', settlement: seat.id, building: b }];
  }
  return [];
}

/**
 * One realm's research book: the cheapest available tech, else the age
 * advance. Pure. Shared by the AI and the steward (M14).
 */
export function stewardResearch(state: GameState, realm: Realm, towns: SimSettlement[]): Command | null {
  void state;
  if (realm.research) return null;
  const affordable = (Object.keys(TECHS) as TechId[])
    .map((t) => TECHS[t])
    .filter(
      (t) =>
        !realm.researchedTechs.includes(t.id) &&
        (!t.culture || t.culture === realm.culture) &&
        AGES[t.age].index <= AGES[realm.age].index &&
        t.prereqs.every((p) => realm.researchedTechs.includes(p)) &&
        towns.some((s) => (s.buildings[t.researchedAt] ?? 0) > 0),
    )
    .sort((a, b) => {
      const cost = (c: typeof a.cost) => Object.values(c).reduce((x, y) => (x ?? 0) + (y ?? 0), 0) ?? 0;
      return cost(a.cost) - cost(b.cost) || a.id.localeCompare(b.id);
    });
  if (affordable.length > 0) return { kind: 'setResearch', tech: affordable[0].id };
  if (nextAge(realm.age)) return { kind: 'advanceAge' };
  return null;
}

/**
 * The rival realms' brain. Runs on the daily boundary and emits ordinary
 * IssuedCommands — the AI plays by exactly the player's rules, which is what
 * keeps the sim deterministic and replayable. Personality (aggression) is a
 * pure function of realm id; the ai rng stream belongs to espionage (M16).
 */
export function aiSystem(state: GameState): IssuedCommand[] {
  if (!isDayEnd(state.tick)) return [];
  const out: IssuedCommand[] = [];
  const day = dateOf(state.tick).day;
  // one realm bestrides the world; the rest take counsel against it (M15) —
  // but the pact needs a season and a half of grievance first (M16 tuning)
  const leader = day >= COALITION_GRACE_DAYS ? runawayLeader(state) : null;

  for (const realm of state.realms) {
    if (realm.isPlayer) continue;
    let seq = 0;
    const issue = (cmd: Command) => out.push({ tick: state.tick, realm: realm.id, seq: seq++, cmd });
    const mine = state.settlements.filter((s) => s.ownerRealm === realm.id);
    if (mine.length === 0) continue;
    const seat = mine.reduce((a, b) => (a.pop > b.pop ? a : b));
    const count = (b: BuildingId) => mine.reduce((t, s) => t + (s.buildings[b] ?? 0), 0);
    const aggression = 0.6 + (0.4 * ((realm.id * 7919) % 10)) / 10;

    // --- villagers: the shared housekeeping book (M12, factored for M13) ---
    for (const s of mine) {
      for (const cmd of villagerEconomy(state, realm, s, day)) issue(cmd);
    }

    // --- economy + research: the shared books (factored for M14's steward) ---
    for (const cmd of stewardBuildings(state, realm, mine, seat, day)) issue(cmd);
    const research = stewardResearch(state, realm, mine);
    if (research) issue(research);

    // --- military: keep a growing garrison at the seat ---
    const garrisonTarget = Math.floor((15 + day / 24) * aggression);
    const garrisonNow = totalUnits(seat.garrison) + seat.trainQueue.reduce((t, q) => t + q.remaining, 0);
    if (count('barracks') > 0 && garrisonNow < garrisonTarget) {
      const unit = garrisonNow % 3 === 0 ? 'spearman' : 'militia';
      if (UNITS[unit]) issue({ kind: 'trainUnits', settlement: seat.id, unit, count: 5 });
    }

    // --- diplomacy (M15): sue when losing; join the pact against the mighty ---
    for (const enemyId of [...realm.atWarWith].sort((x, y) => x - y)) {
      const enemy = state.realms[enemyId];
      if (!enemy) continue;
      if (enemyId === leader) continue; // no separate peace with the tyrant while the pact stands
      if (!isLosing(state, realm.id, enemyId)) continue;
      // a conqueror at the gates will not be bought off — no suing away a
      // campaign the enemy is actively prosecuting
      if (activelyAttacking(state, enemyId, realm.id)) continue;
      const tribute = { give: aiPeaceOffer(realm) };
      // player targets auto-accept a pure gift; AI targets are pre-checked so
      // the command stream carries no doomed offers
      if (enemy.isPlayer || acceptsPeace(state, enemy, realm, tribute)) {
        issue({ kind: 'offerPeace', target: enemyId, tribute });
      }
    }
    if (leader !== null && leader !== realm.id) {
      if (!realm.atWarWith.includes(leader) && day >= (realm.truceUntil[leader] ?? 0)) {
        issue({ kind: 'declareWar', target: leader });
      }
      // fellow members settle their quarrels — the lower id extends the hand,
      // so exactly one offer per pair reaches the queue
      for (const other of state.realms) {
        if (other.id <= realm.id || other.isPlayer || other.id === leader) continue;
        if (realm.atWarWith.includes(other.id)) {
          issue({ kind: 'offerPeace', target: other.id, tribute: {} });
        }
      }
    }

    // --- espionage (M16): the one mission an omniscient AI values is
    // slowing a rival's Wonder — scout and intel tell it nothing new
    for (const other of state.realms) {
      if (other.id === realm.id) continue;
      const wonderRising = state.settlements.some(
        (s) => s.ownerRealm === other.id && s.buildQueue.some((j) => j.building === 'wonder'),
      );
      if (!wonderRising) continue;
      if (day < (realm.spyCooldown[other.id] ?? 0)) continue;
      if (realm.stock.gold < (SPY_COST.sabotage.gold ?? 0) * 2) continue; // never beggar the realm for spies
      issue({ kind: 'spyMission', target: other.id, mission: 'sabotage' });
      break; // one agent a day
    }

    // --- war: after the grace period, march the garrison at the player ---
    const graceDays = Math.floor(400 / aggression);
    const player = state.realms.find((r) => r.isPlayer);
    if (player && day > graceDays) {
      if (!realm.atWarWith.includes(player.id) && day >= (realm.truceUntil[player.id] ?? 0)) {
        issue({ kind: 'declareWar', target: player.id });
      } else if (
        totalUnits(seat.garrison) >= Math.max(25, garrisonTarget * 0.8) &&
        !state.armies.some((a) => a.ownerRealm === realm.id)
      ) {
        issue({ kind: 'formArmy', settlement: seat.id, units: { ...seat.garrison } });
      }
    }
    // an idle AI army marches on the weakest settlement of ANY war enemy
    // (M15: coalition wars against an AI leader must prosecute too)
    const idle = state.armies.find((a) => a.ownerRealm === realm.id && a.phase === 'idle');
    if (idle && realm.atWarWith.length > 0) {
      const targets = state.settlements
        .filter((s) => realm.atWarWith.includes(s.ownerRealm))
        .sort(
          (a, b) =>
            totalUnits(a.garrison) - totalUnits(b.garrison) || a.ownerRealm - b.ownerRealm || a.id - b.id,
        );
      if (targets.length > 0) {
        issue({
          kind: 'orderArmy',
          army: idle.id,
          objective: { kind: 'attackSettlement', settlement: targets[0].id },
        });
      }
    }
  }
  return out;
}
