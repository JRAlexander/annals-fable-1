import type { RngStreams } from '../core/rng';
import { narrate } from './chronicle';
import { applyCommands, type IssuedCommand } from './commands';
import type { SimEvent } from './events';
import type { GameState } from './state';
import { aiSystem } from './systems/ai';
import { armiesSystem } from './systems/armies';
import { constructionSystem } from './systems/construction';
import { populationSystem } from './systems/population';
import { productionSystem } from './systems/production';
import { researchSystem } from './systems/research';
import { storageSystem } from './systems/storage';
import { trainingSystem } from './systems/training';
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

  // rival realms think on the daily boundary and speak the same command language
  const aiCommands = aiSystem(state);
  applyCommands(state, aiCommands.length ? [...issued, ...aiCommands] : issued, events);
  constructionSystem(state, events);
  researchSystem(state, events);
  trainingSystem(state, events);
  armiesSystem(state, events, streams);
  productionSystem(state, events);
  if (isDayEnd(state.tick)) {
    populationSystem(state, events);
    const d = dateOf(state.tick);
    events.push({ kind: 'dayEnd', tick: state.tick, day: d.day, year: d.year });
  }
  storageSystem(state, events);
  narrate(state, events, streams.history);

  state.tick++;
  return events;
}
