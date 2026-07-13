/**
 * Deterministic RNG (sfc32), ported from ANNALS. All game randomness flows
 * through named streams so that adding a draw in one system never reshuffles
 * another: `world` for worldgen, `history` for macro events, `combat` for
 * battle rolls, `ai` for rival-realm decisions.
 */
export type Rng = () => number;

function sfc32(a: number, b: number, c: number, d: number): Rng {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** A fresh generator stream from an integer seed. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const h = () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507);
    s = Math.imul(s ^ (s >>> 13), 3266489909);
    return (s ^ (s >>> 16)) >>> 0;
  };
  return sfc32(h(), h(), h(), h());
}

/** Integer in [a, b] inclusive. */
export function ri(rng: Rng, a: number, b: number): number {
  return a + Math.floor(rng() * (b - a + 1));
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export interface RngStreams {
  world: Rng;
  history: Rng;
  combat: Rng;
  ai: Rng;
}

/** Stream seeds use the same derivations ANNALS did for gen/his, extended. */
export function makeStreams(seed: number): RngStreams {
  return {
    world: makeRng(((seed * 2654435761) % 4294967296) + 7),
    history: makeRng(((seed * 40503) % 4294967296) + 131),
    combat: makeRng(((seed * 69069) % 4294967296) + 17),
    ai: makeRng(((seed * 22695477) % 4294967296) + 43),
  };
}
