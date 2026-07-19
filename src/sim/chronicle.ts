import { AGES } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import { TECHS } from '../content/techs';
import type { Rng } from '../core/rng';
import { pick } from '../core/rng';
import type { SimEvent } from './events';
import type { GameState } from './state';
import { DAYS_PER_YEAR, dateOf } from './time';

const GOOD_OMENS = [
  'and the omens were kind',
  'and the harvests promised well',
  'and the roads were busy with trade',
  'and the bells rang gladly',
];
const MILESTONE_PHRASES = ['has grown to', 'now numbers', 'counts within its walls', 'has swelled to'];
const FAMINE_PHRASES = ['Famine stalks', 'Hunger gnaws at', 'Empty granaries haunt', 'Want and sorrow visit'];
const RAISED_PHRASES = [
  'New timbers rise in',
  'The masons have finished their work in',
  'There is new building in',
];
const MARCH_PHRASES = [
  'The banners are raised and the host marches',
  'With drums and hard bread the levies set out',
  'The realm sends its soldiers',
];
const VICTORY_PHRASES = ['Victory!', 'The day is won!', 'Let the bells ring:'];
const LEARNED_PHRASES = [
  'The scholars of the realm have mastered',
  'The wise now speak of',
  'It is set down in the realm’s books:',
];

/**
 * The annalist. Reads this tick's raw events and appends prose `chronicle`
 * events. Runs inside advanceTick and is the ONLY consumer of the history
 * stream in M1, so its rng draws are part of the deterministic timeline.
 */
export function narrate(state: GameState, events: SimEvent[], rng: Rng): void {
  const prose: SimEvent[] = [];
  const say = (text: string, tone: 'neutral' | 'good' | 'grim' = 'neutral') =>
    prose.push({ kind: 'chronicle', tick: state.tick, text, tone });
  const nameOf = (id: number) => state.world.settlements[id].name;

  for (const e of events) {
    switch (e.kind) {
      case 'realmFounded': {
        const realm = state.realms[e.realm];
        say(
          `Here begins the chronicle of ${realm.name}, set down in the first year of its founding, ${pick(rng, GOOD_OMENS)}.`,
          'good',
        );
        break;
      }
      case 'popMilestone':
        say(`${nameOf(e.settlement)} ${pick(rng, MILESTONE_PHRASES)} ${e.milestone} souls.`, 'good');
        break;
      case 'starvation':
        say(
          `${pick(rng, FAMINE_PHRASES)} ${nameOf(e.settlement)}; some ${e.deaths} souls perished for want of bread.`,
          'grim',
        );
        break;
      case 'storageFull':
        // a gentle periodic reminder, not a daily drumbeat (the event itself stays
        // daily) — and only for OUR stores; rival realms waste in silence
        if (e.realm === 0 && dateOf(state.tick).dayOfYear % 30 === 1) {
          say(`The stores of the realm overflow with ${e.resource}; the surplus goes to waste.`);
        }
        break;
      case 'buildingCompleted': {
        const def = BUILDINGS[e.building];
        say(
          `${pick(rng, RAISED_PHRASES)} ${nameOf(e.settlement)}: a ${def?.name.toLowerCase() ?? e.building} stands complete.`,
          'good',
        );
        break;
      }
      case 'researchCompleted': {
        const def = TECHS[e.tech];
        say(`${pick(rng, LEARNED_PHRASES)} ${def?.name ?? e.tech}.`, 'good');
        break;
      }
      case 'ageAdvanceStarted':
        say('The realm turns its wealth and its will toward a new age.');
        break;
      case 'ageAdvanced':
        say(`Let it be written in letters of gold: the realm enters ${AGES[e.age].name}.`, 'good');
        break;
      case 'armyDeparted':
        say(`${pick(rng, MARCH_PHRASES)} against the bandit camp in the wilds.`);
        break;
      case 'battleStarted':
        say('Steel rings in the wilds: battle is joined at the bandit palisade.');
        break;
      case 'campCleared':
        say(`${pick(rng, VICTORY_PHRASES)} The bandit camp is burned and ${e.loot} gold recovered.`, 'good');
        break;
      case 'battleLost':
        say('Grievous news: the host was cut down to the last beneath the bandit palisade.', 'grim');
        break;
      case 'armyRouted':
        say('The line broke and the survivors fled for home, harried and ashamed.', 'grim');
        break;
      case 'armyReturned':
        say(`The banners come home to ${nameOf(e.settlement)}.`);
        break;
      case 'warDeclared':
        say(
          `Let all men know: ${state.realms[e.realm].name} has declared war upon ${state.realms[e.target].name}.`,
          'grim',
        );
        break;
      case 'peaceMade': {
        // deliberately rng-free (no pick) — treaty prose must not shift the
        // history stream's timeline
        const gave = Object.entries(e.gave)
          .map(([res, amt]) => `${amt} ${res}`)
          .join(', ');
        const demanded = Object.entries(e.demanded)
          .map(([res, amt]) => `${amt} ${res}`)
          .join(', ');
        const terms = gave
          ? ` ${state.realms[e.realm].name} pays tribute: ${gave}.`
          : demanded
            ? ` ${state.realms[e.target].name} pays tribute: ${demanded}.`
            : '';
        const playerGains = (e.target === 0 && gave !== '') || (e.realm === 0 && demanded !== '');
        say(
          `Peace is sworn between ${state.realms[e.realm].name} and ${state.realms[e.target].name}; the truce shall hold a season and more.${terms}`,
          playerGains ? 'good' : 'neutral',
        );
        break;
      }
      case 'coalitionFormed':
        say(
          `The realms take counsel against the might of ${state.realms[e.against].name}: ${e.members.map((m) => state.realms[m].name).join(', ')} joins the pact.`,
          e.against === 0 ? 'grim' : 'neutral',
        );
        break;
      // espionage (M16) — all rng-free: spy prose must not shift the timeline
      case 'spyReport':
        if (e.realm === 0)
          say(`Our agent returns from ${nameOf(e.settlement)} with maps of all that country.`, 'good');
        break;
      case 'spyIntel':
        if (e.realm === 0)
          say(`A ledger smuggled out of ${state.realms[e.target].name} lays their strength bare.`, 'good');
        break;
      case 'spySabotage':
        if (e.realm === 0 && e.building)
          say(`Fire in the night: the ${e.building} rising at ${nameOf(e.settlement)} is set back.`, 'good');
        else if (e.target === 0 && e.building)
          say(
            `Sabotage! The ${e.building} at ${nameOf(e.settlement)} smoulders — a foreign hand, surely.`,
            'grim',
          );
        break;
      case 'spyTheft':
        if (e.realm === 0)
          say(`${e.gold} gold slips out of ${state.realms[e.target].name}'s vaults and into ours.`, 'good');
        else if (e.target === 0) say(`Thieves in the treasury! ${e.gold} gold is gone.`, 'grim');
        break;
      case 'spyCaught':
        if (e.realm === 0)
          say(
            `Our agent was seized in the streets of ${state.realms[e.target].name}; the fee is lost with them.`,
            'grim',
          );
        else if (e.target === 0)
          say(
            `A spy of ${state.realms[e.realm].name} was taken within our walls — the keeps keep good watch.`,
            'good',
          );
        break;
      case 'siegeStarted':
        say(`A hostile host stands before the gates of ${nameOf(e.settlement)}.`, 'grim');
        break;
      case 'levyRaised':
        say(`${nameOf(e.settlement)} calls ${e.count} of its folk to the walls.`);
        break;
      case 'settlementCaptured':
        say(
          `${nameOf(e.settlement)} has fallen to ${state.realms[e.by].name}; its people bow to a new banner.`,
          'grim',
        );
        break;
      case 'siegeRepelled':
        say(`The walls of ${nameOf(e.settlement)} held; the besiegers lie broken before them.`, 'good');
        break;
      case 'armiesEngaged':
        say('The hosts have met in the open field, and the earth drinks deep.', 'grim');
        break;
      case 'fieldBattleWon': {
        const winner = state.armies.find((a) => a.id === e.winner);
        const name =
          winner && winner.ownerRealm >= 0 ? state.realms[winner.ownerRealm]?.name : 'the wild companies';
        say(`The field is won by ${name ?? 'an unknown banner'}; the beaten host is scattered.`, 'neutral');
        break;
      }
      case 'raidSpawned':
        say(
          `The wandering companies grow bold: raiders are seen on the roads toward ${nameOf(e.settlement)}.`,
          'grim',
        );
        break;
      case 'settlementRaided':
        say(
          `Raiders have had their way with ${nameOf(e.settlement)}: stores plundered and folk carried off.`,
          'grim',
        );
        break;
      case 'dragonAwakened':
        say(
          `Doom on wings: a great dragon has risen from the deep wilds, and its shadow falls toward ${nameOf(e.settlement)}.`,
          'grim',
        );
        break;
      case 'dragonSlain':
        say(
          `${pick(rng, VICTORY_PHRASES)} The dragon lies slain beneath the walls, and ${e.hoard} gold of its hoard is claimed by ${state.realms[e.realm].name}.`,
          'good',
        );
        break;
      case 'wonderCompleted':
        say(
          `In ${nameOf(e.settlement)} the Wonder of ${state.realms[e.realm].name} stands complete, and all who see it fall silent.`,
          e.realm === 0 ? 'good' : 'grim',
        );
        break;
      case 'gameWon':
        say(
          e.how === 'conquest'
            ? 'Every capital bows to one banner. The chroniclers put down their pens: the realm has no rival left under heaven.'
            : 'The Wonder has stood its season unbroken. Let the age be named for this realm, now and always.',
          'good',
        );
        break;
      case 'gameLost':
        say(
          'The capital has fallen, and with it the realm. Here the chronicle ends, written in another hand.',
          'grim',
        );
        break;
      case 'dayEnd': {
        const d = dateOf(state.tick);
        if (d.day > 0 && d.day % DAYS_PER_YEAR === 0) {
          say(`So closed the year ${d.year - 1} of the realm, ${pick(rng, GOOD_OMENS)}.`);
        }
        break;
      }
      default:
        break;
    }
  }
  events.push(...prose);
}
