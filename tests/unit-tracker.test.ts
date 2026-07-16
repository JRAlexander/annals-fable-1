import { describe, expect, it } from 'vitest';
import { createUnitTracker } from '../src/render/unitTracker';
import type { GameState } from '../src/sim/state';

/** Minimal state shape — the tracker reads only armies and units. */
function fake(units: Partial<GameState['units'][number]>[], armies: { id: number; ownerRealm: number }[]) {
  return {
    armies: armies.map((a) => ({ ...a })),
    units: units.map((u, i) => ({
      id: u.id ?? i,
      type: u.type ?? 'militia',
      group: u.group ?? 0,
      x: u.x ?? 0,
      z: u.z ?? 0,
      prevX: u.x ?? 0,
      prevZ: u.z ?? 0,
      slot: i,
      hp: u.hp ?? 10,
      cd: u.cd ?? 0,
    })),
  } as unknown as GameState;
}

const ARMIES = [
  { id: 0, ownerRealm: 0 },
  { id: 1, ownerRealm: -1 },
];

describe('unit tracker (render-side combat observer)', () => {
  it('a cooldown that jumps up is a swing; ticking down is not', () => {
    const t = createUnitTracker();
    t.diff(
      fake(
        [
          { id: 5, cd: 0, group: 0 },
          { id: 9, group: 1, x: 20 },
        ],
        ARMIES,
      ),
    );
    // cd 0 → 3: struck this tick, aimed at the nearest hostile
    let ev = t.diff(
      fake(
        [
          { id: 5, cd: 3, group: 0 },
          { id: 9, group: 1, x: 20 },
        ],
        ARMIES,
      ),
    );
    expect(ev.swings).toHaveLength(1);
    expect(ev.swings[0].id).toBe(5);
    expect(ev.swings[0].tx).toBe(20);
    expect(ev.swings[0].ranged).toBe(false);
    // cd 3 → 2: just waiting
    ev = t.diff(
      fake(
        [
          { id: 5, cd: 2, group: 0 },
          { id: 9, group: 1, x: 20 },
        ],
        ARMIES,
      ),
    );
    expect(ev.swings).toHaveLength(0);
  });

  it('ranged units swing ranged', () => {
    const t = createUnitTracker();
    t.diff(
      fake(
        [
          { id: 1, type: 'archer', cd: 0, group: 0 },
          { id: 2, group: 1, x: 50 },
        ],
        ARMIES,
      ),
    );
    const ev = t.diff(
      fake(
        [
          { id: 1, type: 'archer', cd: 3, group: 0 },
          { id: 2, group: 1, x: 50 },
        ],
        ARMIES,
      ),
    );
    expect(ev.swings[0]?.ranged).toBe(true);
  });

  it('a vanished id is a death at its last position, and the map self-prunes', () => {
    const t = createUnitTracker();
    t.diff(fake([{ id: 7, x: 33, z: -12, group: 1, hp: 4 }], ARMIES));
    const ev = t.diff(fake([], ARMIES));
    expect(ev.deaths).toHaveLength(1);
    expect(ev.deaths[0].x).toBe(33);
    expect(ev.deaths[0].z).toBe(-12);
    expect(ev.deaths[0].owner).toBe(-1);
    expect(t.maxHp(7)).toBeUndefined(); // evicted
    // a re-used id later registers fresh, no ghost of the old soldier
    const ev2 = t.diff(fake([{ id: 7, hp: 25 }], ARMIES));
    expect(ev2.deaths).toHaveLength(0);
    expect(t.maxHp(7)).toBe(25);
  });

  it('max hp is the first-seen hp, remembered through damage', () => {
    const t = createUnitTracker();
    t.diff(fake([{ id: 3, hp: 60 }], ARMIES));
    t.diff(fake([{ id: 3, hp: 41 }], ARMIES));
    t.diff(fake([{ id: 3, hp: 12 }], ARMIES));
    expect(t.maxHp(3)).toBe(60);
  });
});
