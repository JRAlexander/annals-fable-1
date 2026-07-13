import { AGES, nextAge } from '../../content/ages';
import { BUILDINGS } from '../../content/buildings';
import type { BuildingId, TechId } from '../../content/schema';
import { TECHS } from '../../content/techs';
import { UNITS } from '../../content/units';
import { totalUnits } from '../combat';
import type { Command, IssuedCommand } from '../commands';
import type { GameState, Realm } from '../state';
import { dateOf, isDayEnd } from '../time';

/**
 * The rival realms' brain. Runs on the daily boundary and emits ordinary
 * IssuedCommands — the AI plays by exactly the player's rules, which is what
 * keeps the sim deterministic and replayable. Personality (aggression) is a
 * pure function of realm id; the ai rng stream stays in reserve.
 */
export function aiSystem(state: GameState): IssuedCommand[] {
  if (!isDayEnd(state.tick)) return [];
  const out: IssuedCommand[] = [];

  for (const realm of state.realms) {
    if (realm.isPlayer) continue;
    let seq = 0;
    const issue = (cmd: Command) => out.push({ tick: state.tick, realm: realm.id, seq: seq++, cmd });
    const mine = state.settlements.filter((s) => s.ownerRealm === realm.id);
    if (mine.length === 0) continue;
    const seat = mine.reduce((a, b) => (a.pop > b.pop ? a : b));
    const count = (b: BuildingId) => mine.reduce((t, s) => t + (s.buildings[b] ?? 0), 0);
    const queued = mine.some((s) => s.buildQueue.length > 0);
    const aggression = 0.6 + (0.4 * ((realm.id * 7919) % 10)) / 10;
    const day = dateOf(state.tick).day;

    // --- economy: one building at a time, in priority order ---
    if (!queued) {
      const wants: [BuildingId, number][] = [
        ['farm', 2 + Math.floor(day / 240)],
        ['house', 1 + Math.floor(day / 300)],
        ['lumberCamp', 1],
        ['barracks', 1],
        ['market', 1],
        ['quarry', 1],
      ];
      // the endgame: a rich Golden-age realm races for the Wonder
      if (realm.age === 'golden' && count('wonder') === 0 && realm.stock.stone >= 2000) {
        wants.unshift(['wonder', 1]);
      }
      for (const [b, want] of wants) {
        if (count(b) < want) {
          issue({ kind: 'queueBuilding', settlement: seat.id, building: b });
          break;
        }
      }
    }

    // --- research: cheapest available tech, else advance the age ---
    if (!realm.research) {
      const affordable = (Object.keys(TECHS) as TechId[])
        .map((t) => TECHS[t])
        .filter(
          (t) =>
            !realm.researchedTechs.includes(t.id) &&
            (!t.culture || t.culture === realm.culture) &&
            AGES[t.age].index <= AGES[realm.age].index &&
            t.prereqs.every((p) => realm.researchedTechs.includes(p)) &&
            mine.some((s) => (s.buildings[t.researchedAt] ?? 0) > 0),
        )
        .sort((a, b) => {
          const cost = (c: typeof a.cost) => Object.values(c).reduce((x, y) => (x ?? 0) + (y ?? 0), 0) ?? 0;
          return cost(a.cost) - cost(b.cost) || a.id.localeCompare(b.id);
        });
      if (affordable.length > 0) issue({ kind: 'setResearch', tech: affordable[0].id });
      else if (nextAge(realm.age)) issue({ kind: 'advanceAge' });
    }

    // --- military: keep a growing garrison at the seat ---
    const garrisonTarget = Math.floor((15 + day / 24) * aggression);
    const garrisonNow = totalUnits(seat.garrison) + seat.trainQueue.reduce((t, q) => t + q.remaining, 0);
    if (count('barracks') > 0 && garrisonNow < garrisonTarget) {
      const unit = garrisonNow % 3 === 0 ? 'spearman' : 'militia';
      if (UNITS[unit]) issue({ kind: 'trainUnits', settlement: seat.id, unit, count: 5 });
    }

    // --- war: after the grace period, march the garrison at the player ---
    const graceDays = Math.floor(400 / aggression);
    const player = state.realms.find((r) => r.isPlayer);
    if (player && day > graceDays) {
      if (!realm.atWarWith.includes(player.id)) {
        issue({ kind: 'declareWar', target: player.id });
      } else if (
        totalUnits(seat.garrison) >= Math.max(25, garrisonTarget * 0.8) &&
        !state.armies.some((a) => a.ownerRealm === realm.id)
      ) {
        issue({ kind: 'formArmy', settlement: seat.id, units: { ...seat.garrison } });
      }
    }
    // an idle AI army marches on the player's weakest settlement
    const idle = state.armies.find((a) => a.ownerRealm === realm.id && a.phase === 'idle');
    if (idle && player && realm.atWarWith.includes(player.id)) {
      const targets = state.settlements
        .filter((s) => s.ownerRealm === player.id)
        .sort((a, b) => totalUnits(a.garrison) - totalUnits(b.garrison) || a.id - b.id);
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
