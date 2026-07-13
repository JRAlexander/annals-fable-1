import type { GameState } from '../sim/state';
import { hidx, worldToCell } from '../worldgen/coords';
import { GRID } from '../worldgen/types';

/**
 * Fog of war (M7b) — a PRESENTATION concern. The sim stays omniscient and
 * untouched; what the player may see is a pure function of player state:
 * cells near owned settlements and player armies are VISIBLE, and anything
 * ever seen stays EXPLORED. App layer so it can persist alongside the save.
 */

export const SETTLEMENT_SIGHT_CELLS = 10;
export const ARMY_SIGHT_CELLS = 6;

export enum Fog {
  Unexplored = 0,
  Explored = 1,
  Visible = 2,
}

function stamp(mask: Uint8Array, ci: number, cj: number, radius: number): void {
  const r2 = radius * radius;
  const i0 = Math.max(0, ci - radius);
  const i1 = Math.min(GRID - 1, ci + radius);
  const j0 = Math.max(0, cj - radius);
  const j1 = Math.min(GRID - 1, cj + radius);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const di = i - ci;
      const dj = j - cj;
      if (di * di + dj * dj <= r2) mask[hidx(i, j)] = Fog.Visible;
    }
  }
}

/** What realm 0 can see RIGHT NOW: Visible cells set, everything else 0. */
export function computeVisibility(state: GameState): Uint8Array {
  const mask = new Uint8Array(GRID * GRID);
  for (const s of state.settlements) {
    if (s.ownerRealm !== 0) continue;
    const site = state.world.settlements[s.id];
    stamp(mask, site.i, site.j, SETTLEMENT_SIGHT_CELLS);
  }
  for (const a of state.armies) {
    if (a.ownerRealm !== 0) continue;
    const { i, j } = worldToCell(a.x, a.z);
    stamp(mask, i, j, ARMY_SIGHT_CELLS);
  }
  return mask;
}

/**
 * Merge current visibility into the accumulating fog mask (in place).
 * Returns true when anything changed — the renderer re-uploads only then.
 */
export function accumulate(fog: Uint8Array, visible: Uint8Array): boolean {
  let changed = false;
  for (let k = 0; k < fog.length; k++) {
    const next =
      visible[k] === Fog.Visible ? Fog.Visible : fog[k] === Fog.Unexplored ? Fog.Unexplored : Fog.Explored;
    if (next !== fog[k]) {
      fog[k] = next;
      changed = true;
    }
  }
  return changed;
}

/** Is this world position currently visible to the player? */
export function isVisibleAt(fog: Uint8Array, x: number, z: number): boolean {
  const { i, j } = worldToCell(x, z);
  return fog[hidx(i, j)] === Fog.Visible;
}

/** Has this world position ever been seen? */
export function isExploredAt(fog: Uint8Array, x: number, z: number): boolean {
  const { i, j } = worldToCell(x, z);
  return fog[hidx(i, j)] >= Fog.Explored;
}

/** Pack the EXPLORED bits (not visibility — that's recomputed) into hex. */
export function packExplored(fog: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(fog.length / 8));
  for (let k = 0; k < fog.length; k++) {
    if (fog[k] >= Fog.Explored) bytes[k >> 3] |= 1 << (k & 7);
  }
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Restore a fog mask (all Explored/Unexplored) from packed hex. */
export function unpackExplored(hex: string | undefined): Uint8Array {
  const fog = new Uint8Array(GRID * GRID);
  if (!hex) return fog;
  for (let k = 0; k < fog.length; k++) {
    const byte = Number.parseInt(hex.slice((k >> 3) * 2, (k >> 3) * 2 + 2), 16);
    if (Number.isFinite(byte) && byte & (1 << (k & 7))) fog[k] = Fog.Explored;
  }
  return fog;
}
