import { describe, expect, it } from 'vitest';
import { HOUSING_BASE, SEED_BUILDINGS, STARTING_POP } from '../src/content/economy';
import { buildingContrib, settlementFortHp } from '../src/sim/buildings';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { initGameState } from '../src/sim/state';
import { generateWorld } from '../src/worldgen/world';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
}
function fund(sim: SimRun): void {
  sim.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
  sim.state.realms[0].storageCap = { food: 99999, wood: 99999, stone: 99999, gold: 99999 };
}
const rejected = (events: SimEvent[]) => events.some((e) => e.kind === 'commandRejected');

describe('seeded settlements (M9)', () => {
  it('every settlement starts with its tier seed: town center + houses, placed and counted', () => {
    const sim = freshSim(1234);
    for (const s of sim.state.settlements) {
      const site = sim.state.world.settlements[s.id];
      const seeds = SEED_BUILDINGS[site.tier];
      expect(s.buildings.townCenter, `${site.name} town center`).toBe(1);
      for (const [id, n] of Object.entries(seeds)) {
        expect(s.buildings[id], `${site.name} ${id}`).toBe(n);
      }
      // placed mirrors the counts exactly, with the town center at the heart
      const total = Object.values(seeds).reduce((t: number, n) => t + (n ?? 0), 0);
      expect(s.placed).toHaveLength(total);
      const tc = s.placed.find((p) => p.building === 'townCenter');
      expect(tc?.x).toBe(site.x);
      expect(tc?.z).toBe(site.z);
      // pop and cap come from the rebased numbers, with headroom to grow
      expect(s.pop).toBe(STARTING_POP[site.tier]);
      expect(s.popCap).toBe(HOUSING_BASE[site.tier] + buildingContrib(s).housing);
      expect(s.popCap).toBeGreaterThan(s.pop);
    }
  });

  it('seeding is rng-free: two inits from the same world hash identically', () => {
    const world = generateWorld(77);
    expect(hashState(initGameState(world))).toBe(hashState(initGameState(world)));
  });

  it('town centers cannot be queued or placed', () => {
    const sim = freshSim(1234);
    fund(sim);
    expect(rejected(issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'townCenter' }))).toBe(
      true,
    );
    const site = sim.state.world.settlements[0];
    expect(
      rejected(
        issueNow(sim, {
          kind: 'placeBuilding',
          building: 'townCenter',
          at: { x: site.x + 120, z: site.z + 120 },
        }),
      ),
    ).toBe(true);
  });

  it('seeded buildings prove nothing: age advance still demands built progress', () => {
    const sim = freshSim(1234);
    fund(sim);
    // house + townCenter are both standing founding-age types, yet the realm
    // has BUILT nothing — one distinct buildable type (house) is not two
    expect(rejected(issueNow(sim, { kind: 'advanceAge' }))).toBe(true);
  });

  it('the town center levies militia without a barracks', () => {
    const sim = freshSim(1234);
    fund(sim);
    const events = issueNow(sim, { kind: 'trainUnits', settlement: 0, unit: 'militia', count: 1 });
    expect(rejected(events)).toBe(false);
  });

  it('fortifications sum: town center + palisade + keep', () => {
    const sim = freshSim(1234);
    const s = sim.state.settlements[0];
    expect(settlementFortHp(s)).toBe(300); // the seeded town center
    s.buildings.palisade = 1;
    expect(settlementFortHp(s)).toBe(800);
    s.buildings.keep = 1;
    expect(settlementFortHp(s)).toBe(2000);
  });

  it('stone walls gate on the High Kingdom and masonry', () => {
    const sim = freshSim(1234);
    fund(sim);
    expect(rejected(issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'stoneWall' }))).toBe(
      true,
    ); // founding age
    sim.state.realms[0].age = 'highKingdom';
    fund(sim);
    expect(rejected(issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'stoneWall' }))).toBe(
      true,
    ); // no masonry
    sim.state.realms[0].researchedTechs.push('masonry');
    fund(sim);
    expect(rejected(issueNow(sim, { kind: 'queueBuilding', settlement: 0, building: 'stoneWall' }))).toBe(
      false,
    );
  });

  it('houses matter: a housed village outgrows its unhoused twin', () => {
    const grown = freshSim(42);
    const bare = freshSim(42);
    const village = grown.state.settlements.find(
      (s) => grown.state.world.settlements[s.id].tier === 'village',
    );
    if (!village) throw new Error('no village in seed 42');
    village.buildings.house = (village.buildings.house ?? 0) + 3;
    run(grown, 2600); // long enough for the bare twin to hit its housing cap
    run(bare, 2600);
    const twin = bare.state.settlements.find((s) => s.id === village.id);
    expect(village.pop).toBeGreaterThan(twin?.pop ?? Number.POSITIVE_INFINITY);
  });

  it('AI rivals build houses and grow under the rebased economy', () => {
    const sim = freshSim(1234);
    run(sim, 3000);
    const rivalSeats = sim.state.settlements.filter(
      (s) => s.ownerRealm !== 0 && sim.state.realms[s.ownerRealm] !== undefined,
    );
    const housesBuilt = rivalSeats.reduce((t, s) => {
      const seed = SEED_BUILDINGS[sim.state.world.settlements[s.id].tier].house ?? 0;
      return t + Math.max(0, (s.buildings.house ?? 0) - seed);
    }, 0);
    expect(housesBuilt).toBeGreaterThan(0);
  });
});
