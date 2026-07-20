import { describe, expect, it } from 'vitest';
import { RESOURCE_VALUE } from '../src/content/diplomacy';
import { FOREIGN_TRADE_BONUS, TRADE_SPREAD } from '../src/content/trade';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { findPath } from '../src/sim/pathfind';
import { routeGold } from '../src/sim/systems/caravans';
import { advanceTick } from '../src/sim/tick';
import { TICKS_PER_DAY } from '../src/sim/time';
import { hidx } from '../src/worldgen/coords';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command, realm = 0): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm, seq: 0, cmd }] });
}
function runUntil(sim: SimRun, pred: () => boolean, maxTicks: number, what: string): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return all;
    all.push(...advanceTick(sim.state, [], sim.streams));
  }
  if (!pred()) throw new Error(`runUntil: '${what}' not reached within ${maxTicks} ticks`);
  return all;
}

/** Plant standing buildings (economy-test pattern — placement is real now). */
function standUp(sim: SimRun, sid: number, building: string, n = 1, r = 60) {
  const s = sim.state.settlements[sid];
  const site = sim.state.world.settlements[sid];
  s.buildings[building] = (s.buildings[building] ?? 0) + n;
  for (let i = 0; i < n; i++) s.placed.push({ building, x: site.x + r + i * 30, z: site.z + 20 });
}

/** Silence villager income so gold deltas are the carts' alone. */
function stillEconomy(sim: SimRun) {
  for (const s of sim.state.settlements) {
    if (s.ownerRealm === 0) s.jobTargets = { farm: 0, wood: 0, stone: 0, gold: 0 };
  }
}

/** Two player towns + the one-way path cell count between them. */
function playerRoute(sim: SimRun): { home: number; target: number; cells: number } {
  const mine = sim.state.settlements.filter((s) => s.ownerRealm === 0);
  const [a, b] = [mine[0], mine[1]];
  const sa = sim.state.world.settlements[a.id];
  const sb = sim.state.world.settlements[b.id];
  return { home: a.id, target: b.id, cells: findPath(sim.state.world, sa.i, sa.j, sb.i, sb.j).length - 1 };
}

/** Expected round-trip gold: two floored halves, base × bonus × (no techs). */
const expectTrip = (cells: number, bonus = 1) => 2 * Math.floor((routeGold(cells) * bonus) / 2);

const myCarts = (sim: SimRun) =>
  sim.state.caravans.filter((c) => sim.state.settlements[c.home].ownerRealm === 0);

describe('market exchange (M17)', () => {
  it('sells wood for gold and buys wood with gold at the spread', () => {
    const sim = freshSim(1234);
    standUp(sim, playerRoute(sim).home, 'market');
    const r = sim.state.realms[0];
    const gold0 = r.stock.gold;
    const wood0 = r.stock.wood;
    // 100 wood → floor(100 × .25/1 × .75) = 18 gold
    let events = issueNow(sim, { kind: 'marketTrade', give: 'wood', get: 'gold', amount: 100 });
    const expGold = Math.floor(((100 * RESOURCE_VALUE.wood) / RESOURCE_VALUE.gold) * (1 - TRADE_SPREAD));
    expect(expGold).toBe(18);
    expect(r.stock.gold).toBe(gold0 + 18);
    expect(r.stock.wood).toBe(wood0 - 100);
    const done = events.find((e) => e.kind === 'tradeExecuted');
    expect(done && done.kind === 'tradeExecuted' && done.got.gold).toBe(18);
    // 100 gold → floor(100 × 1/.25 × .75) = 300 wood
    events = issueNow(sim, { kind: 'marketTrade', give: 'gold', get: 'wood', amount: 100 });
    expect(events.some((e) => e.kind === 'tradeExecuted')).toBe(true);
    expect(r.stock.wood).toBe(wood0 - 100 + 300);
  });

  it('rejects every malformed exchange', () => {
    const sim = freshSim(1234);
    const home = playerRoute(sim).home;
    const rejected = (cmd: Command) =>
      issueNow(sim, cmd).some((e) => e.kind === 'commandRejected' && e.realm === 0);
    // no market anywhere yet
    expect(rejected({ kind: 'marketTrade', give: 'wood', get: 'gold', amount: 100 })).toBe(true);
    standUp(sim, home, 'market');
    expect(rejected({ kind: 'marketTrade', give: 'wood', get: 'wood', amount: 100 })).toBe(true);
    expect(rejected({ kind: 'marketTrade', give: 'wood', get: 'gold', amount: 0 })).toBe(true);
    expect(rejected({ kind: 'marketTrade', give: 'wood', get: 'gold', amount: 2.5 })).toBe(true);
    expect(rejected({ kind: 'marketTrade', give: 'wood', get: 'gold', amount: 200_000 })).toBe(true);
    expect(rejected({ kind: 'marketTrade', give: 'wood', get: 'gold', amount: 99_999 })).toBe(true); // stock short
    // 1 food → floor(.25 × .75) = 0 gold: the spread eats it whole
    expect(rejected({ kind: 'marketTrade', give: 'food', get: 'gold', amount: 1 })).toBe(true);
  });
});

describe('caravan routes (M17)', () => {
  it('setTradeRoute validates, establishes, and clears', () => {
    const sim = freshSim(1234);
    const { home, target } = playerRoute(sim);
    const rejected = (cmd: Command) =>
      issueNow(sim, cmd).some((e) => e.kind === 'commandRejected' && e.realm === 0);
    const rival = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!rival) throw new Error('no rival town');
    expect(rejected({ kind: 'setTradeRoute', settlement: rival.id, target: home })).toBe(true); // not ours
    expect(rejected({ kind: 'setTradeRoute', settlement: home, target })).toBe(true); // no market yet
    standUp(sim, home, 'market');
    expect(rejected({ kind: 'setTradeRoute', settlement: home, target: home })).toBe(true); // self
    expect(rejected({ kind: 'setTradeRoute', settlement: home, target: 999 })).toBe(true); // no such town
    issueNow(sim, { kind: 'declareWar', target: 1 });
    expect(rejected({ kind: 'setTradeRoute', settlement: home, target: rival.id })).toBe(true); // battle line
    const events = issueNow(sim, { kind: 'setTradeRoute', settlement: home, target });
    expect(events.some((e) => e.kind === 'routeEstablished')).toBe(true);
    expect(sim.state.settlements[home].trade).toEqual({ target, trips: 0, lastGold: 0 });
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target: null });
    expect(sim.state.settlements[home].trade).toBeUndefined();
  });

  it('rejects a route no road can reach', () => {
    const sim = freshSim(1234);
    const { home, target } = playerRoute(sim);
    standUp(sim, home, 'market');
    // wall the target off (world is not hashed — carving it is fair game)
    const there = sim.state.world.settlements[target];
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        sim.state.world.navCost[hidx(there.i + di, there.j + dj)] = Number.POSITIVE_INFINITY;
      }
    }
    const events = issueNow(sim, { kind: 'setTradeRoute', settlement: home, target });
    expect(events.some((e) => e.kind === 'commandRejected' && e.realm === 0)).toBe(true);
  });

  it('spawns one cart per day toward the markets+guildhalls cap', () => {
    const sim = freshSim(1234);
    stillEconomy(sim);
    const { home, target } = playerRoute(sim);
    standUp(sim, home, 'market');
    standUp(sim, home, 'guildhall'); // cap 2 — tech gates don't bind planted tests
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target });
    run(sim, TICKS_PER_DAY);
    expect(myCarts(sim).length).toBe(1); // one day, one cart
    run(sim, TICKS_PER_DAY);
    expect(myCarts(sim).length).toBe(2); // second day fills the cap
    run(sim, TICKS_PER_DAY * 3);
    expect(myCarts(sim).length).toBe(2); // and it holds
  });

  it('carts move along the path and the renderer sees prevX trail x', () => {
    const sim = freshSim(1234);
    stillEconomy(sim);
    const { home, target } = playerRoute(sim);
    standUp(sim, home, 'market');
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target });
    runUntil(sim, () => myCarts(sim).length > 0, TICKS_PER_DAY + 2, 'first cart');
    const cart = myCarts(sim)[0];
    const x0 = cart.x;
    const z0 = cart.z;
    run(sim, 5);
    expect(Math.hypot(cart.x - x0, cart.z - z0)).toBeGreaterThan(0);
    expect(cart.prevX === cart.x && cart.prevZ === cart.z).toBe(false);
  });

  it('pays a home route in two exact halves and books the trip', () => {
    const sim = freshSim(1234);
    stillEconomy(sim);
    const { home, target, cells } = playerRoute(sim);
    standUp(sim, home, 'market');
    standUp(sim, home, 'storehouse', 4); // room for the gold — the clamp must not mask the math
    run(sim, 1); // let storage derive the new cap
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target });
    const gold0 = sim.state.realms[0].stock.gold;
    const events = runUntil(
      sim,
      () => (sim.state.settlements[home].trade?.trips ?? 0) >= 1,
      2000,
      'first round trip',
    );
    const expected = expectTrip(cells);
    expect(sim.state.settlements[home].trade?.lastGold).toBe(expected);
    expect(sim.state.realms[0].stock.gold - gold0).toBe(expected);
    const arrived = events.find((e) => e.kind === 'caravanArrived');
    expect(arrived && arrived.kind === 'caravanArrived' && arrived.gold).toBe(expected);
    expect(arrived && arrived.kind === 'caravanArrived' && arrived.trips).toBe(1);
  });

  it('foreign routes pay the bonus and coinage scales the take', () => {
    const sim = freshSim(1234);
    stillEconomy(sim);
    const { home } = playerRoute(sim);
    const rival = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!rival) throw new Error('no rival town');
    standUp(sim, home, 'market');
    standUp(sim, home, 'storehouse', 6);
    run(sim, 1);
    sim.state.realms[0].researchedTechs.push('coinage'); // +10% gatherRate gold
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target: rival.id });
    const a = sim.state.world.settlements[home];
    const b = sim.state.world.settlements[rival.id];
    const cells = findPath(sim.state.world, a.i, a.j, b.i, b.j).length - 1;
    runUntil(sim, () => (sim.state.settlements[home].trade?.trips ?? 0) >= 1, 4000, 'foreign trip');
    const expected = 2 * Math.floor((routeGold(cells) * FOREIGN_TRADE_BONUS * 1.1) / 2);
    expect(sim.state.settlements[home].trade?.lastGold).toBe(expected);
  });

  it('the storage clamp eats overflow — stock parks exactly at cap', () => {
    const sim = freshSim(1234);
    stillEconomy(sim);
    const { home, target } = playerRoute(sim);
    standUp(sim, home, 'market'); // no storehouses — the base cap is the wall
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target });
    run(sim, 1); // let storage derive the cap
    const r = sim.state.realms[0];
    r.stock.gold = r.storageCap.gold - 10; // a payout must overflow the vault
    runUntil(sim, () => (sim.state.settlements[home].trade?.trips ?? 0) >= 1, 2000, 'one trip');
    expect(r.stock.gold).toBe(r.storageCap.gold); // waste by design: build storehouses
  });

  it('war breaks the route mid-trip: recall, no payout, carts retire at home', () => {
    const sim = freshSim(1234);
    stillEconomy(sim);
    const { home } = playerRoute(sim);
    const rival = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!rival) throw new Error('no rival town');
    standUp(sim, home, 'market');
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target: rival.id });
    runUntil(
      sim,
      () => myCarts(sim).some((c) => c.phase === 'outbound' && c.pathIdx > 2),
      TICKS_PER_DAY * 4,
      'cart on the road',
    );
    const gold0 = sim.state.realms[0].stock.gold;
    const events = issueNow(sim, { kind: 'declareWar', target: 1 });
    const more = runUntil(sim, () => myCarts(sim).length === 0, 3000, 'carts home and retired');
    expect(
      [...events, ...more].some((e) => e.kind === 'routeBroken' && e.realm === 0 && e.reason === 'war'),
    ).toBe(true);
    expect(sim.state.settlements[home].trade).toBeUndefined();
    expect([...events, ...more].some((e) => e.kind === 'caravanArrived' && e.realm === 0)).toBe(false);
    expect(sim.state.realms[0].stock.gold).toBe(gold0); // the recalled leg pays nothing
  });

  it('a target captured by a PEACEFUL realm keeps the route alive', () => {
    const sim = freshSim(1234);
    stillEconomy(sim);
    const { home } = playerRoute(sim);
    const rival = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!rival) throw new Error('no rival town');
    standUp(sim, home, 'market');
    standUp(sim, home, 'storehouse', 6);
    run(sim, 1);
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target: rival.id });
    run(sim, 5);
    rival.ownerRealm = 2; // a change of banner, but not a hostile one
    runUntil(sim, () => (sim.state.settlements[home].trade?.trips ?? 0) >= 1, 4000, 'trip after capture');
    expect(sim.state.settlements[home].trade?.target).toBe(rival.id);
  });

  it('replacing the route mid-trip re-departs the cart to the new target', () => {
    const sim = freshSim(1234);
    stillEconomy(sim);
    const mine = sim.state.settlements.filter((s) => s.ownerRealm === 0);
    if (mine.length < 3) throw new Error('need three player towns');
    const [home, t1, t2] = [mine[0].id, mine[1].id, mine[2].id];
    standUp(sim, home, 'market');
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target: t1 });
    runUntil(
      sim,
      () => myCarts(sim).some((c) => c.phase === 'outbound' && c.pathIdx > 2),
      TICKS_PER_DAY * 4,
      'cart under way',
    );
    issueNow(sim, { kind: 'setTradeRoute', settlement: home, target: t2 });
    runUntil(sim, () => myCarts(sim).some((c) => c.target === t2), 3000, 're-departed to new target');
    expect(sim.state.settlements[home].trade?.target).toBe(t2);
  });

  it('a captured home loses its route and its carts (the real siege path)', () => {
    const sim = freshSim(1234);
    // realm 1 runs a route between two of ITS towns; the player takes the home
    const theirs = sim.state.settlements.filter((s) => s.ownerRealm === 1);
    const [rHome, rTarget] = [theirs[0], theirs[1] ?? theirs[0]];
    if (rHome.id === rTarget.id) throw new Error('rival needs two towns');
    standUp(sim, rHome.id, 'market');
    issueNow(sim, { kind: 'setTradeRoute', settlement: rHome.id, target: rTarget.id }, 1);
    runUntil(
      sim,
      () => sim.state.caravans.some((c) => c.home === rHome.id),
      TICKS_PER_DAY * 3,
      'rival cart out',
    );
    issueNow(sim, { kind: 'declareWar', target: 1 });
    const capital = sim.state.settlements.find((s) => s.id === sim.state.world.capital.id);
    if (!capital) throw new Error('no capital');
    const units = { swordsman: 80, spearman: 40, archer: 30 };
    for (const [u, n] of Object.entries(units)) capital.garrison[u] = n;
    const formed = issueNow(sim, { kind: 'formArmy', settlement: capital.id, units }).find(
      (e) => e.kind === 'armyFormed',
    );
    if (!formed || formed.kind !== 'armyFormed') throw new Error('army not formed');
    issueNow(sim, {
      kind: 'orderArmy',
      army: formed.army,
      objective: { kind: 'attackSettlement', settlement: rHome.id },
    });
    const events = runUntil(sim, () => rHome.ownerRealm === 0, 30000, 'home town captured');
    expect(
      events.some((e) => e.kind === 'routeBroken' && e.reason === 'captured' && e.settlement === rHome.id),
    ).toBe(true);
    expect(rHome.trade).toBeUndefined();
    expect(sim.state.caravans.some((c) => c.home === rHome.id)).toBe(false);
  });

  it('the AI and the steward both put markets on the road', () => {
    const sim = freshSim(1234);
    // the AI builds its own market in time and routes it
    runUntil(
      sim,
      () => sim.state.settlements.some((s) => s.ownerRealm !== 0 && s.trade !== undefined),
      TICKS_PER_DAY * 400,
      'an AI trade route',
    );
    // a stewarded player town with a market gets one the next day
    const { home } = playerRoute(sim);
    standUp(sim, home, 'market');
    issueNow(sim, { kind: 'setSteward', settlement: home, enabled: true });
    runUntil(
      sim,
      () => sim.state.settlements[home].trade !== undefined,
      TICKS_PER_DAY * 2,
      'steward routes the market',
    );
  });

  it('twin runs with trade stay hash-identical; an extra route changes it', () => {
    const script = (sim: SimRun): Record<number, { tick: number; realm: 0; seq: number; cmd: Command }[]> => {
      const { home, target } = playerRoute(sim);
      standUp(sim, home, 'market');
      return {
        5: [
          { tick: 5, realm: 0, seq: 0, cmd: { kind: 'marketTrade', give: 'wood', get: 'gold', amount: 100 } },
          { tick: 5, realm: 0, seq: 1, cmd: { kind: 'setTradeRoute', settlement: home, target } },
        ],
      };
    };
    const a = freshSim(1234);
    run(a, 300, script(a));
    const b = freshSim(1234);
    run(b, 300, script(b));
    expect(hashState(a.state)).toBe(hashState(b.state));

    const c = freshSim(1234);
    const extra = script(c);
    const { home: h2 } = playerRoute(c);
    const mine = c.state.settlements.filter((s) => s.ownerRealm === 0);
    extra[15] = [
      {
        tick: 15,
        realm: 0,
        seq: 0,
        cmd: { kind: 'setTradeRoute', settlement: h2, target: mine[2]?.id ?? mine[1].id },
      },
    ];
    run(c, 300, extra);
    expect(hashState(c.state)).not.toBe(hashState(a.state));
  });

  it('three live routes stay inside the tick budget', () => {
    const sim = freshSim(1234);
    const mine = sim.state.settlements.filter((s) => s.ownerRealm === 0);
    for (const s of mine) standUp(sim, s.id, 'market');
    for (let k = 0; k < mine.length; k++) {
      issueNow(sim, {
        kind: 'setTradeRoute',
        settlement: mine[k].id,
        target: mine[(k + 1) % mine.length].id,
      });
    }
    run(sim, 50); // carts on the road before the clock starts
    const t0 = performance.now();
    run(sim, 2000);
    const ms = (performance.now() - t0) / 2000;
    expect(ms).toBeLessThan(2);
  });
});
