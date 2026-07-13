import { BUILDINGS } from '../content/buildings';
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
        say(`The stores of the realm overflow with ${e.resource}; the surplus goes to waste.`);
        break;
      case 'buildingCompleted': {
        const def = BUILDINGS[e.building];
        say(
          `${pick(rng, RAISED_PHRASES)} ${nameOf(e.settlement)}: a ${def?.name.toLowerCase() ?? e.building} stands complete.`,
          'good',
        );
        break;
      }
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
