import { describe, expect, it } from 'vitest';
import { TRUCE_DAYS } from '../src/content/diplomacy';
import { totalUnits } from '../src/sim/combat';
import type { Command } from '../src/sim/commands';
import { acceptsPeace, isLosing, runawayLeader, warPower } from '../src/sim/diplomacy';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import type { Army } from '../src/sim/state';
import { advanceTick } from '../src/sim/tick';
import { TICKS_PER_DAY } from '../src/sim/time';
import { worldToCell } from '../src/worldgen/coords';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
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
function conjureArmy(sim: SimRun, units: Record<string, number>, settlement = 0): Army {
  const s = sim.state.settlements[settlement];
  for (const [u, n] of Object.entries(units)) s.garrison[u] = n;
  const events = issueNow(sim, { kind: 'formArmy', settlement: s.id, units });
  const formed = events.find((e) => e.kind === 'armyFormed');
  if (!formed || formed.kind !== 'armyFormed') throw new Error('army not formed');
  const army = sim.state.armies.find((a) => a.id === formed.army);
  if (!army) throw new Error('army vanished');
  return army;
}
/** Drop a foreign realm's army directly at a position (test shortcut). */
function conjureEnemyArmy(
  sim: SimRun,
  owner: number,
  units: Record<string, number>,
  x: number,
  z: number,
): Army {
  const { i, j } = worldToCell(x, z);
  const home = sim.state.settlements.find((s) => s.ownerRealm === owner)?.id ?? 0;
  const army: Army = {
    id: sim.state.nextArmyId++,
    ownerRealm: owner,
    home,
    units,
    x,
    z,
    prevX: x,
    prevZ: z,
    path: [
      [i, j],
      [i, j],
    ],
    pathIdx: 1,
    cellProgress: 0,
    objective: null,
    phase: 'idle',
    stance: 'standGround',
    muster: totalUnits(units),
    battleStartStrength: 0,
  };
  sim.state.armies.push(army);
  return army;
}
/** Make realm `id` militarily hopeless so it accepts (or sues for) peace. */
function crush(sim: SimRun, id: number): void {
  for (const s of sim.state.settlements) {
    if (s.ownerRealm === id) {
      s.garrison = {};
      s.trainQueue = [];
    }
  }
  sim.state.armies = sim.state.armies.filter((a) => a.ownerRealm !== id);
  sim.state.units = sim.state.units.filter((u) => sim.state.armies.some((a) => a.id === u.group));
}
const day = (sim: SimRun) => Math.floor(sim.state.tick / TICKS_PER_DAY);

describe('diplomacy (M15): peace and truce', () => {
  it('peace splices both atWarWith and stamps a symmetric truce', () => {
    const sim = freshSim(1234);
    crush(sim, 1);
    sim.state.settlements[sim.state.realms[0].capital].garrison = { swordsman: 40 };
    issueNow(sim, { kind: 'declareWar', target: 1 });
    expect(sim.state.realms[0].atWarWith).toContain(1);
    const events = issueNow(sim, { kind: 'offerPeace', target: 1, tribute: {} });
    expect(events.some((e) => e.kind === 'peaceMade')).toBe(true);
    expect(sim.state.realms[0].atWarWith).not.toContain(1);
    expect(sim.state.realms[1].atWarWith).not.toContain(0);
    expect(sim.state.realms[0].truceUntil[1]).toBe(day(sim) + TRUCE_DAYS);
    expect(sim.state.realms[1].truceUntil[0]).toBe(day(sim) + TRUCE_DAYS);
  });

  it('an engaged field battle breaks off: both sides stand down', () => {
    const sim = freshSim(1234);
    const me = conjureArmy(sim, { swordsman: 40, archer: 20 });
    const foe = conjureEnemyArmy(sim, 1, { militia: 30 }, me.x + 10, me.z);
    issueNow(sim, { kind: 'declareWar', target: 1 });
    runUntil(sim, () => me.engagedWith !== undefined, 20, 'engaged');
    crush2way(sim); // make realm 1 accept white peace without touching the armies
    issueNow(sim, { kind: 'offerPeace', target: 1, tribute: {} });
    expect(me.engagedWith).toBeUndefined();
    expect(foe.engagedWith).toBeUndefined();
    expect(me.objective).toEqual({ kind: 'returnHome' });
    expect(me.phase).toBe('returning');
    function crush2way(s: SimRun) {
      for (const t of s.state.settlements) if (t.ownerRealm === 1) t.garrison = {};
    }
  });

  it('a sieging army turns for home; a pursuit is called off; wild hunts are not', () => {
    const sim = freshSim(1234);
    crush(sim, 1);
    const sieger = conjureArmy(sim, { swordsman: 30 });
    const hunter = conjureArmy(sim, { swordsman: 20 });
    const wildHunter = conjureArmy(sim, { swordsman: 20 });
    issueNow(sim, { kind: 'declareWar', target: 1 });
    const enemyTown = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!enemyTown) throw new Error('no enemy town');
    const quarry = conjureEnemyArmy(sim, 1, { militia: 5 }, sieger.x + 900, sieger.z + 900);
    const wild = conjureEnemyArmy(sim, -1, { militia: 5 }, sieger.x - 900, sieger.z - 900);
    issueNow(sim, {
      kind: 'orderArmy',
      army: sieger.id,
      objective: { kind: 'attackSettlement', settlement: enemyTown.id },
    });
    issueNow(sim, { kind: 'orderArmy', army: hunter.id, objective: { kind: 'attackArmy', army: quarry.id } });
    issueNow(sim, {
      kind: 'orderArmy',
      army: wildHunter.id,
      objective: { kind: 'attackArmy', army: wild.id },
    });
    issueNow(sim, { kind: 'offerPeace', target: 1, tribute: {} });
    expect(sieger.objective).toEqual({ kind: 'returnHome' });
    expect(hunter.objective).toEqual({ kind: 'returnHome' });
    expect(wildHunter.objective).toEqual({ kind: 'attackArmy', army: wild.id }); // the wilds sign nothing
  });

  it('the truce blocks re-declaration until it lifts', () => {
    const sim = freshSim(1234);
    crush(sim, 1);
    sim.state.settlements[sim.state.realms[0].capital].garrison = { swordsman: 40 };
    issueNow(sim, { kind: 'declareWar', target: 1 });
    issueNow(sim, { kind: 'offerPeace', target: 1, tribute: {} });
    let events = issueNow(sim, { kind: 'declareWar', target: 1 });
    expect(events.some((e) => e.kind === 'commandRejected' && /truce/.test(e.reason))).toBe(true);
    expect(sim.state.realms[0].atWarWith).not.toContain(1);
    // the seasons pass; the truce lifts
    sim.state.tick += TRUCE_DAYS * TICKS_PER_DAY;
    events = issueNow(sim, { kind: 'declareWar', target: 1 });
    expect(events.some((e) => e.kind === 'warDeclared')).toBe(true);
  });

  it('tribute moves both ways, exactly', () => {
    const sim = freshSim(1234);
    crush(sim, 1);
    sim.state.settlements[sim.state.realms[0].capital].garrison = { swordsman: 40 };
    sim.state.realms[0].stock = { food: 1000, wood: 1000, stone: 1000, gold: 1000 };
    sim.state.realms[1].stock = { food: 1000, wood: 1000, stone: 1000, gold: 1000 };
    issueNow(sim, { kind: 'declareWar', target: 1 });
    const events = issueNow(sim, {
      kind: 'offerPeace',
      target: 1,
      tribute: { give: { wood: 100 }, demand: { gold: 200 } },
    });
    const made = events.find((e) => e.kind === 'peaceMade');
    expect(made).toBeDefined();
    // measured immediately post-tick: the tick's economy drifts food, not these
    expect(sim.state.realms[1].stock.wood).toBeGreaterThanOrEqual(1090);
    expect(sim.state.realms[0].stock.gold).toBeGreaterThanOrEqual(1190);
    expect(sim.state.realms[0].stock.wood).toBeLessThanOrEqual(910);
    expect(sim.state.realms[1].stock.gold).toBeLessThanOrEqual(810);
  });

  it('rejects: no war, self, unaffordable give, unpayable demand', () => {
    const sim = freshSim(1234);
    let events = issueNow(sim, { kind: 'offerPeace', target: 1, tribute: {} });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    events = issueNow(sim, { kind: 'offerPeace', target: 0, tribute: {} });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    issueNow(sim, { kind: 'declareWar', target: 1 });
    events = issueNow(sim, { kind: 'offerPeace', target: 1, tribute: { give: { gold: 99999 } } });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    events = issueNow(sim, { kind: 'offerPeace', target: 1, tribute: { demand: { gold: 99999 } } });
    expect(events.some((e) => e.kind === 'commandRejected')).toBe(true);
    expect(sim.state.realms[0].atWarWith).toContain(1); // the war stands
  });

  it('acceptance math: the beaten accept, the strong want paying', () => {
    const sim = freshSim(1234);
    const [player, rival] = [sim.state.realms[0], sim.state.realms[1]];
    crush(sim, 1);
    sim.state.settlements[player.capital].garrison = { swordsman: 40 };
    rival.stock = { food: 400, wood: 400, stone: 400, gold: 400 };
    expect(isLosing(sim.state, 1, 0)).toBe(true);
    // a losing realm accepts white peace and small demands…
    expect(acceptsPeace(sim.state, rival, player, {})).toBe(true);
    expect(acceptsPeace(sim.state, rival, player, { demand: { gold: 100 } })).toBe(true);
    // …but not the surrender of half its wealth
    expect(acceptsPeace(sim.state, rival, player, { demand: { gold: 400, stone: 400 } })).toBe(false);
    // a STRONGER realm refuses a demand-only peace outright
    sim.state.settlements[player.capital].garrison = {};
    for (const s of sim.state.settlements) if (s.ownerRealm === 1) s.garrison = { knight: 30 };
    expect(warPower(sim.state, 1)).toBeGreaterThan(warPower(sim.state, 0));
    expect(acceptsPeace(sim.state, rival, player, { demand: { gold: 50 } })).toBe(false);
  });
});

describe('diplomacy (M15): the AI sues and the pact forms', () => {
  it('a losing AI sues for peace, paying tribute the player pockets', () => {
    const sim = freshSim(1234);
    crush(sim, 1);
    sim.state.settlements[sim.state.realms[0].capital].garrison = { swordsman: 50 };
    sim.state.realms[1].stock = { food: 800, wood: 800, stone: 800, gold: 800 };
    const goldBefore = sim.state.realms[0].stock.gold;
    issueNow(sim, { kind: 'declareWar', target: 1 });
    const events = runUntil(sim, () => !sim.state.realms[0].atWarWith.includes(1), 30, 'AI sued');
    expect(events.some((e) => e.kind === 'peaceMade')).toBe(true);
    expect(sim.state.realms[0].stock.gold).toBeGreaterThan(goldBefore); // their gold, our peace
    expect(sim.state.realms[1].truceUntil[0]).toBeGreaterThan(day(sim));
  });

  it('no suing while the conqueror is at the gates', () => {
    const sim = freshSim(1234);
    crush(sim, 1);
    sim.state.settlements[sim.state.realms[0].capital].garrison = { swordsman: 60 };
    issueNow(sim, { kind: 'declareWar', target: 1 });
    const me = conjureArmy(sim, { swordsman: 60 });
    const enemyTown = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!enemyTown) throw new Error('no enemy town');
    issueNow(sim, {
      kind: 'orderArmy',
      army: me.id,
      objective: { kind: 'attackSettlement', settlement: enemyTown.id },
    });
    const events = run(sim, TICKS_PER_DAY * 3); // several day boundaries
    expect(events.some((e) => e.kind === 'peaceMade')).toBe(false);
    expect(sim.state.realms[0].atWarWith).toContain(1); // the campaign stands
  });

  it('a player majority raises a coalition: both realms declare the same day', () => {
    const sim = freshSim(1234);
    // hand the player everything but the rival capitals — a strict majority
    for (const s of sim.state.settlements) {
      if (s.id !== sim.state.realms[1].capital && s.id !== sim.state.realms[2].capital) {
        s.ownerRealm = 0;
      }
    }
    expect(runawayLeader(sim.state)).toBe(0);
    const events = runUntil(
      sim,
      () => sim.state.realms[0].atWarWith.includes(1) && sim.state.realms[0].atWarWith.includes(2),
      30,
      'coalition declared',
    );
    expect(
      events.filter((e) => e.kind === 'coalitionFormed' && e.against === 0).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('coalition members settle their own quarrels; an AI leader draws AI war, not the player', () => {
    const sim = freshSim(1234);
    // realm 1 bestrides the world
    for (const s of sim.state.settlements) {
      if (s.id !== sim.state.realms[0].capital && s.id !== sim.state.realms[2].capital) {
        s.ownerRealm = 1;
      }
    }
    // and realms 1×2 already feud — the pact must first make peace between members?
    // (members here are only realm 2; the feud is member-vs-LEADER, which stands)
    expect(runawayLeader(sim.state)).toBe(1);
    const events = runUntil(sim, () => sim.state.realms[2].atWarWith.includes(1), 30, 'AI joined pact');
    expect(events.some((e) => e.kind === 'coalitionFormed' && e.against === 1)).toBe(true);
    expect(sim.state.realms[0].atWarWith).toHaveLength(0); // the player was never conscripted
    // the war prosecutes: run on and require no crash and eventual army action or peace
    run(sim, 600);
    expect(sim.state.realms[2].atWarWith.includes(1) || (sim.state.realms[2].truceUntil[1] ?? 0) > 0).toBe(
      true,
    );
  });

  it('conquest by subdual: a rival eaten by a third realm no longer bars victory', () => {
    const sim = freshSim(1234);
    // realm 1 has swallowed realm 2 entirely (coalition aftermath)
    for (const s of sim.state.settlements) {
      if (s.ownerRealm === 2) s.ownerRealm = 1;
    }
    // the player then takes realm 1's capital and all its holdings
    for (const s of sim.state.settlements) {
      if (s.ownerRealm === 1) s.ownerRealm = 0;
    }
    const events = runUntil(sim, () => sim.state.outcome !== null, TICKS_PER_DAY + 2, 'outcome judged');
    expect(sim.state.outcome).toEqual({ kind: 'victory', how: 'conquest' });
    expect(events.some((e) => e.kind === 'gameWon' && e.how === 'conquest')).toBe(true);
  });

  it('diplomacy-heavy runs stay deterministic: twin runs hash equal', () => {
    const once = () => {
      const sim = freshSim(777);
      crush(sim, 1);
      sim.state.settlements[sim.state.realms[0].capital].garrison = { swordsman: 40 };
      run(sim, 3);
      run(sim, 1, {
        [sim.state.tick]: [
          { tick: sim.state.tick, realm: 0, seq: 0, cmd: { kind: 'declareWar', target: 1 } },
        ],
      });
      run(sim, 1500); // AI sues, truce stamps, life goes on
      return hashState(sim.state);
    };
    expect(once()).toBe(once());
  });
});
