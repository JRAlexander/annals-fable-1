import type { RngStreams } from '../core/rng';
import { narrate } from './chronicle';
import { applyCommands, type IssuedCommand } from './commands';
import type { SimEvent } from './events';
import type { GameState } from './state';
import { aiSystem } from './systems/ai';
import { armiesSystem } from './systems/armies';
import { constructionSystem } from './systems/construction';
import { espionageSystem } from './systems/espionage';
import { governorSystem } from './systems/governor';
import { marshalSystem } from './systems/marshal';
import { populationSystem } from './systems/population';
import { researchSystem } from './systems/research';
import { stewardSystem } from './systems/steward';
import { storageSystem } from './systems/storage';
import { threatsSystem } from './systems/threats';
import { trainingSystem } from './systems/training';
import { victorySystem } from './systems/victory';
import { villagersSystem } from './systems/villagers';
import { dateOf, isDayEnd } from './time';

/** The world stream is spent during generateWorld; the sim uses the rest. */
export type SimStreams = Pick<RngStreams, 'history' | 'combat' | 'ai'>;

/**
 * The entire sim API: advance one tick, mutating state in place, and return
 * this tick's events for the UI/AI to consume. Systems run in a fixed order;
 * commands are the only external mutation path.
 */
export function advanceTick(state: GameState, issued: IssuedCommand[], streams: SimStreams): SimEvent[] {
  const events: SimEvent[] = [];
  if (state.tick === 0) events.push({ kind: 'realmFounded', realm: 0, tick: 0 });

  // rival realms — and the player's governors (M13), stewards, and marshal
  // (M14) — think on the daily boundary and speak the same command language,
  // unrecorded; seq bands keep the order player → governor → steward → marshal
  const auto = [
    ...aiSystem(state),
    ...governorSystem(state),
    ...stewardSystem(state),
    ...marshalSystem(state),
  ];
  applyCommands(state, auto.length ? [...issued, ...auto] : issued, events);
  espionageSystem(state, events, streams.ai); // agents come due (M16)
  threatsSystem(state, events); // the wilds move before the day's marching
  constructionSystem(state, events);
  researchSystem(state, events);
  trainingSystem(state, events);
  armiesSystem(state, events);
  villagersSystem(state, events); // the economy walks (M12)
  if (isDayEnd(state.tick)) {
    populationSystem(state, events);
    const d = dateOf(state.tick);
    events.push({ kind: 'dayEnd', tick: state.tick, day: d.day, year: d.year });
  }
  storageSystem(state, events);
  victorySystem(state, events); // endings are judged on the finished day
  narrate(state, events, streams.history);

  state.tick++;
  return events;
}
