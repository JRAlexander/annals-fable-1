import { describe, expect, it } from 'vitest';
import { STARTING_VILLAGERS, VILLAGER_TRAIN_TICKS } from '../src/content/economy';
import { RAID_VILLAGER_LOSS } from '../src/content/threats';
import { hashState } from '../src/sim/hash';
import { initGameState } from '../src/sim/state';
import { killVillagers } from '../src/sim/systems/villagers';
import { hidx, worldToCell } from '../src/worldgen/coords';
import { generateWorld } from '../src/worldgen/world';
import { freshSim, run, type SimRun } from './helpers';

function fund(sim: SimRun): void {
  sim.state.realms[0].stock = { food: 9000, wood: 9000, stone: 9000, gold: 9000 };
  sim.state.realms[0].storageCap = { food: 99999, wood: 99999, stone: 99999, gold: 99999 };
}

/** A placed workplace, injected directly — the build pipeline is tested elsewhere. */
function plant(sim: SimRun, sid: number, building: string, x: number, z: number) {
  const s = sim.state.settlements[sid];
  s.buildings[building] = (s.buildings[building] ?? 0) + 1;
  s.placed.push({ building, x, z });
}

describe('villagers (M12 — the economy walks)', () => {
  it('every settlement seeds its tier count, and init is rng-free', () => {
    const world = generateWorld(77);
    const a = initGameState(world);
    for (const s of a.settlements) {
      const tier = world.settlements[s.id].tier;
      expect(a.villagers.filter((v) => v.settlement === s.id)).toHaveLength(STARTING_VILLAGERS[tier]);
    }
    expect(hashState(initGameState(world))).toBe(hashState(a));
  });

  it('a farmer cycles farm → dropoff and out-earns an idle twin', () => {
    const mk = (farmers: number) => {
      const sim = freshSim(1);
      const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
      if (!s) throw new Error('player owns nothing');
      for (const t of sim.state.settlements) {
        if (t.ownerRealm === 0) t.jobTargets = { farm: 0, wood: 0, stone: 0, gold: 0 };
      }
      const site = sim.state.world.settlements[s.id];
      plant(sim, s.id, 'farm', site.x + 80, site.z);
      s.jobTargets.farm = farmers;
      run(sim, 300);
      return sim;
    };
    const worked = mk(4);
    const idle = mk(0);
    // both realms eat the same; only the farmers' baskets differ
    expect(worked.state.realms[0].stock.food).toBeGreaterThan(idle.state.realms[0].stock.food);
    expect(worked.state.villagers.some((v) => v.job === 'farm')).toBe(true);
  });

  it('a lumber camp by the forest out-earns hauling to the town center', () => {
    const mk = () => {
      const sim = freshSim(7);
      for (const t of sim.state.settlements) {
        if (t.ownerRealm === 0) t.jobTargets = { farm: 0, wood: 0, stone: 0, gold: 0 };
      }
      const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
      if (!s) throw new Error('player owns nothing');
      s.jobTargets.wood = 4;
      return { sim, s };
    };
    const far = mk();
    const near = mk();
    // plant the camp right at the woodcutters' destination cell
    run(near.sim, 2); // let the reconciler aim the cutters
    const cutter = near.sim.state.villagers.find((v) => v.settlement === near.s.id && v.job === 'wood');
    if (!cutter) throw new Error('nobody took the axe');
    plant(near.sim, near.s.id, 'lumberCamp', cutter.tx, cutter.tz);
    run(far.sim, 2);

    const w0f = far.sim.state.realms[0].stock.wood;
    const w0n = near.sim.state.realms[0].stock.wood;
    run(far.sim, 600);
    run(near.sim, 600);
    const gainFar = far.sim.state.realms[0].stock.wood - w0f;
    const gainNear = near.sim.state.realms[0].stock.wood - w0n;
    expect(gainNear).toBeGreaterThan(gainFar); // trip distance IS the gather rate
  });

  it('reconciliation honors targets, capacity, and id order', () => {
    const sim = freshSim(1);
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    for (const t of sim.state.settlements) {
      if (t.ownerRealm === 0) t.jobTargets = { farm: 0, wood: 0, stone: 0, gold: 0 };
    }
    const site = sim.state.world.settlements[s.id];
    plant(sim, s.id, 'farm', site.x + 60, site.z); // one farm = capacity 5
    s.jobTargets.farm = 99; // wish for more than the fields can hold
    run(sim, 3);
    const farmers = sim.state.villagers.filter((v) => v.settlement === s.id && v.job === 'farm');
    expect(farmers).toHaveLength(5); // clamped to workplace slots

    s.jobTargets.farm = 2;
    run(sim, 3);
    const after = sim.state.villagers.filter((v) => v.settlement === s.id && v.job === 'farm');
    expect(after).toHaveLength(2);
    // the survivors are the LOWEST ids — the newest hands were sent home first
    const ids = sim.state.villagers
      .filter((v) => v.settlement === s.id)
      .map((v) => v.id)
      .sort((a, b) => a - b);
    expect(after.map((v) => v.id).sort((a, b) => a - b)).toEqual(ids.slice(0, 2));
  });

  it('trainVillagers spawns one villager per VILLAGER_TRAIN_TICKS, with the event', () => {
    const sim = freshSim(1);
    fund(sim);
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    const before = sim.state.villagers.filter((v) => v.settlement === s.id).length;
    run(sim, 1, {
      0: [{ tick: 0, realm: 0, seq: 0, cmd: { kind: 'trainVillagers', settlement: s.id, count: 2 } }],
    });
    const events = run(sim, VILLAGER_TRAIN_TICKS * 2 + 2);
    const now = sim.state.villagers.filter((v) => v.settlement === s.id).length;
    expect(now).toBe(before + 2);
    expect(events.filter((e) => e.kind === 'villagersTrained')).toHaveLength(2);
  });

  it('raids reap the fields: a fifth of the villagers fall', () => {
    const sim = freshSim(1);
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    const before = sim.state.villagers.filter((v) => v.settlement === s.id).length;
    const killed = killVillagers(sim.state, s.id, RAID_VILLAGER_LOSS);
    expect(killed).toBe(Math.floor(before * RAID_VILLAGER_LOSS));
    expect(sim.state.villagers.filter((v) => v.settlement === s.id)).toHaveLength(before - killed);
  });

  it('capture converts the survivors — their loads feed the captor', () => {
    const sim = freshSim(1);
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    const gold1 = sim.state.realms[1].stock.wood;
    s.ownerRealm = 1; // the town changes hands (capture mechanics tested in sim-war)
    for (const t of sim.state.settlements) {
      if (t.id !== s.id && t.ownerRealm === 1) t.jobTargets = { farm: 0, wood: 0, stone: 0, gold: 0 };
    }
    s.jobTargets = { farm: 0, wood: 3, stone: 0, gold: 0 };
    run(sim, 400);
    expect(sim.state.realms[1].stock.wood).toBeGreaterThan(gold1); // income flows to the new banner
  });

  it('farmers idle until a farm stands, then flow in', () => {
    const sim = freshSim(1);
    fund(sim);
    const s = sim.state.settlements.find((x) => x.ownerRealm === 0);
    if (!s) throw new Error('player owns nothing');
    for (const t of sim.state.settlements) {
      if (t.ownerRealm === 0) t.jobTargets = { farm: 0, wood: 0, stone: 0, gold: 0 };
    }
    s.jobTargets.farm = 3;
    run(sim, 10);
    expect(sim.state.villagers.filter((v) => v.settlement === s.id && v.job === 'farm')).toHaveLength(0);
    const site = sim.state.world.settlements[s.id];
    plant(sim, s.id, 'farm', site.x + 70, site.z + 30);
    run(sim, 3);
    expect(sim.state.villagers.filter((v) => v.settlement === s.id && v.job === 'farm')).toHaveLength(3);
  });

  it('no villager ever stands in open water', () => {
    const sim = freshSim(7);
    run(sim, 2000);
    for (const v of sim.state.villagers) {
      const c = worldToCell(v.x, v.z);
      expect(Number.isFinite(sim.state.world.navCost[hidx(c.i, c.j)])).toBe(true);
    }
  });

  it('the AI grows its own economy', () => {
    const sim = freshSim(1234);
    const count = (realm: number) =>
      sim.state.villagers.filter((v) => sim.state.settlements[v.settlement]?.ownerRealm === realm).length;
    const v0 = count(1);
    const stocks0 = { ...sim.state.realms[1].stock };
    run(sim, 4000);
    expect(count(1)).toBeGreaterThan(v0);
    expect(sim.state.realms[1].stock.wood).toBeGreaterThan(stocks0.wood);
    expect(sim.state.realms[1].stock.food).toBeGreaterThan(0); // fed, farming, alive
  });

  it('two identical scripted runs hash identically', () => {
    const once = () => {
      const sim = freshSim(9);
      run(sim, 1500, {
        50: [{ tick: 50, realm: 0, seq: 0, cmd: { kind: 'trainVillagers', settlement: 0, count: 3 } }],
        400: [
          {
            tick: 400,
            realm: 0,
            seq: 1,
            cmd: { kind: 'assignVillagers', settlement: 0, job: 'stone', count: 4 },
          },
        ],
      });
      return hashState(sim.state);
    };
    expect(once()).toBe(once());
  });
});
