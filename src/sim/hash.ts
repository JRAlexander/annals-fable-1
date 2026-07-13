import type { GameState } from './state';

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${k}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

/**
 * FNV-1a over a stable stringification of the mutable state. `world` is
 * excluded — it is static and regenerable from the seed. Bit-identical or
 * bust: numbers stringify via String(n), an exact double round-trip.
 */
export function hashState(state: GameState): string {
  const { world: _world, ...mutable } = state;
  const s = stableStringify(mutable);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
