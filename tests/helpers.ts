import { makeStreams } from '../src/core/rng';
import type { IssuedCommand } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { type GameState, initGameState } from '../src/sim/state';
import { advanceTick, type SimStreams } from '../src/sim/tick';
import { generateWorld } from '../src/worldgen/world';

export interface SimRun {
  state: GameState;
  streams: SimStreams;
  events: SimEvent[];
}

export function freshSim(seed: number): SimRun {
  const world = generateWorld(seed);
  const { history, combat, ai } = makeStreams(seed);
  return { state: initGameState(world), streams: { history, combat, ai }, events: [] };
}

/** Run n ticks, feeding commands scheduled by tick index; collects all events. */
export function run(sim: SimRun, n: number, script: Record<number, IssuedCommand[]> = {}): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    const issued = script[sim.state.tick] ?? [];
    all.push(...advanceTick(sim.state, issued, sim.streams));
  }
  sim.events.push(...all);
  return all;
}
