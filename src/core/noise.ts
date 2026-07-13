import { lerp, smoothstep } from './math';
import { makeRng } from './rng';

export type Fbm = (x: number, y: number, octaves?: number) => number;

/** Seeded value-noise fBm, ported from ANNALS. Output roughly in [-1, 1]. */
export function makeNoise(seed: number): Fbm {
  const r = makeRng(seed);
  const P = new Uint8Array(512);
  const perm: number[] = [];
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];

  function grad(h: number, x: number, y: number): number {
    const g = h & 7;
    const u = g < 4 ? x : y;
    const v = g < 4 ? y : x;
    return (g & 1 ? -u : u) + (g & 2 ? -v : v);
  }

  function noise2(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = smoothstep(x);
    const v = smoothstep(y);
    const a = P[X] + Y;
    const b = P[X + 1] + Y;
    return lerp(
      lerp(grad(P[a], x, y), grad(P[b], x - 1, y), u),
      lerp(grad(P[a + 1], x, y - 1), grad(P[b + 1], x - 1, y - 1), u),
      v,
    );
  }

  return (x, y, octaves = 5) => {
    let f = 1;
    let a = 0.5;
    let s = 0;
    let m = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * noise2(x * f, y * f);
      m += a;
      f *= 2;
      a *= 0.5;
    }
    return s / m;
  };
}
