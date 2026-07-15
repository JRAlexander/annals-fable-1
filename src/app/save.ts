import type { CultureId } from '../content/schema';
import { makeStreams } from '../core/rng';
import type { IssuedCommand } from '../sim/commands';
import type { SimEvent } from '../sim/events';
import { type GameState, initGameState } from '../sim/state';
import { advanceTick, type SimStreams } from '../sim/tick';
import { generateWorld } from '../worldgen/world';

/**
 * Save = seed + culture + the player's command log — the M1 promise made
 * real. Replay regenerates everything else: the world from the seed, the AI
 * and combat from their streams, the chronicle word for word. App layer only
 * (localStorage is impure); the sim stays headless.
 */
export interface SaveGame {
  /** v2: the M9 economy rebase — v1 command logs replay into a different world. */
  v: 2;
  seed: number;
  culture: CultureId;
  tick: number;
  commands: IssuedCommand[];
  /** Hex-packed explored fog mask (M7b) — presentation state, optional. */
  explored?: string;
}

const KEY_PREFIX = 'realms.save.';
const key = (seed: number, culture: CultureId) => `${KEY_PREFIX}${seed}.${culture}`;

export function loadSave(seed: number, culture: CultureId): SaveGame | null {
  try {
    const raw = localStorage.getItem(key(seed, culture));
    if (!raw) return null;
    const save = JSON.parse(raw) as SaveGame;
    if (save.v !== 2 || save.seed !== seed || save.culture !== culture) return null;
    return save;
  } catch {
    return null;
  }
}

export function hasSave(seed: number, culture: CultureId): boolean {
  return loadSave(seed, culture) !== null;
}

/** Any save stored for this seed, regardless of culture (for the Continue card). */
export function anySaveFor(seed: number): SaveGame | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(`${KEY_PREFIX}${seed}.`)) {
        const save = JSON.parse(localStorage.getItem(k) ?? 'null') as SaveGame | null;
        if (save?.v === 2 && save.seed === seed) return save;
      }
    }
  } catch {
    // storage unavailable — play on without saves
  }
  return null;
}

export function writeSave(save: SaveGame): void {
  try {
    localStorage.setItem(key(save.seed, save.culture), JSON.stringify(save));
  } catch {
    // quota or privacy mode — the game goes on, just unsaved
  }
}

export function clearSave(seed: number, culture: CultureId): void {
  try {
    localStorage.removeItem(key(seed, culture));
  } catch {
    // nothing to do
  }
}

/**
 * Recorder: collects the player's commands and autosaves on a cadence the
 * caller chooses (day boundaries). The recorded log is authoritative — it is
 * exactly what replay() will feed back in.
 */
export function createRecorder(seed: number, culture: CultureId, initial: IssuedCommand[] = []) {
  const commands: IssuedCommand[] = [...initial];
  return {
    record(cmd: IssuedCommand): void {
      commands.push(cmd);
    },
    autosave(tick: number, explored?: string): void {
      writeSave({ v: 2, seed, culture, tick, commands, explored });
    },
  };
}

/**
 * Rebuild a game from a save by re-running the sim. ~33µs/tick means even a
 * decade-long game replays in seconds. Returns the state AND the streams —
 * both are mid-sequence and must be the ones the resumed game continues with.
 */
export function replay(save: SaveGame): {
  state: GameState;
  streams: SimStreams;
  chronicleTail: SimEvent[];
} {
  const world = generateWorld(save.seed);
  const { history, combat, ai } = makeStreams(save.seed);
  const streams: SimStreams = { history, combat, ai };
  const state = initGameState(world, save.culture);
  const byTick = new Map<number, IssuedCommand[]>();
  for (const c of save.commands) {
    const list = byTick.get(c.tick) ?? [];
    list.push(c);
    byTick.set(c.tick, list);
  }
  const chronicleTail: SimEvent[] = [];
  while (state.tick < save.tick) {
    const events = advanceTick(state, byTick.get(state.tick) ?? [], streams);
    for (const e of events) {
      if (e.kind === 'chronicle') {
        chronicleTail.push(e);
        if (chronicleTail.length > 50) chronicleTail.shift();
      }
    }
  }
  return { state, streams, chronicleTail };
}
