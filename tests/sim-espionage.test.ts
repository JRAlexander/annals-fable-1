import { describe, expect, it } from 'vitest';
import { COALITION_GRACE_DAYS } from '../src/content/diplomacy';
import {
  SABOTAGE_SETBACK,
  SPY_COOLDOWN_DAYS,
  SPY_COST,
  SPY_MISSION_DAYS,
  STEAL_FRACTION,
} from '../src/content/espionage';
import { makeRng } from '../src/core/rng';
import type { Command } from '../src/sim/commands';
import type { SimEvent } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { espionageSystem, successChance } from '../src/sim/systems/espionage';
import { advanceTick } from '../src/sim/tick';
import { TICKS_PER_DAY } from '../src/sim/time';
import { freshSim, run, type SimRun } from './helpers';

function issueNow(sim: SimRun, cmd: Command): SimEvent[] {
  return run(sim, 1, { [sim.state.tick]: [{ tick: sim.state.tick, realm: 0, seq: 0, cmd }] });
}
const day = (sim: SimRun) => Math.floor(sim.state.tick / TICKS_PER_DAY);
const fund = (sim: SimRun) => {
  sim.state.realms[0].stock = { food: 5000, wood: 5000, stone: 5000, gold: 5000 };
};
/** Queue a mission and fast-forward the sim to its resolve day's last tick. */
function dueTick(sim: SimRun): number {
  const target = (day(sim) + SPY_MISSION_DAYS + 1) * TICKS_PER_DAY;
  return target - sim.state.tick;
}
const alwaysSucceed = () => 0;
const alwaysFail = () => 0.999;

describe('espionage (M16): dispatch and travel', () => {
  it('a mission pays, stamps the cooldown, queues, and dispatches', () => {
    const sim = freshSim(1234);
    fund(sim);
    const before = sim.state.realms[0].stock.gold;
    const events = issueNow(sim, { kind: 'spyMission', target: 1, mission: 'intel' });
    expect(events.some((e) => e.kind === 'spyDispatched')).toBe(true);
    expect(sim.state.realms[0].stock.gold).toBeLessThanOrEqual(before - (SPY_COST.intel.gold ?? 0));
    expect(sim.state.realms[0].spyCooldown[1]).toBe(day(sim) + SPY_COOLDOWN_DAYS);
    expect(sim.state.missions).toHaveLength(1);
    expect(sim.state.missions[0].resolveDay).toBe(day(sim) + SPY_MISSION_DAYS);
  });

  it('rejects: self, unknown realm, bad scout target, poverty, active cooldown (per pair)', () => {
    const sim = freshSim(1234);
    fund(sim);
    const rejected = (events: SimEvent[]) => events.some((e) => e.kind === 'commandRejected');
    expect(rejected(issueNow(sim, { kind: 'spyMission', target: 0, mission: 'intel' }))).toBe(true);
    expect(rejected(issueNow(sim, { kind: 'spyMission', target: 9, mission: 'intel' }))).toBe(true);
    const myTown = sim.state.settlements.find((s) => s.ownerRealm === 0);
    expect(
      rejected(issueNow(sim, { kind: 'spyMission', target: 1, mission: 'scout', settlement: myTown?.id })),
    ).toBe(true);
    expect(rejected(issueNow(sim, { kind: 'spyMission', target: 1, mission: 'scout' }))).toBe(true);
    // fund + first mission OK; second at the same pair blocked; other pair fine
    expect(rejected(issueNow(sim, { kind: 'spyMission', target: 1, mission: 'intel' }))).toBe(false);
    expect(rejected(issueNow(sim, { kind: 'spyMission', target: 1, mission: 'steal' }))).toBe(true);
    expect(rejected(issueNow(sim, { kind: 'spyMission', target: 2, mission: 'intel' }))).toBe(false);
    // poverty
    sim.state.realms[0].stock.gold = 1;
    sim.state.realms[0].spyCooldown = {};
    expect(rejected(issueNow(sim, { kind: 'spyMission', target: 1, mission: 'sabotage' }))).toBe(true);
  });

  it('nothing resolves before the resolve day; only the due are spliced', () => {
    const sim = freshSim(1234);
    fund(sim);
    issueNow(sim, { kind: 'spyMission', target: 1, mission: 'intel' });
    run(sim, TICKS_PER_DAY); // one day — still traveling
    expect(sim.state.missions).toHaveLength(1);
    const events = run(sim, dueTick(sim));
    expect(events.some((e) => e.kind === 'spyIntel' || e.kind === 'spyCaught')).toBe(true);
    expect(sim.state.missions).toHaveLength(0);
  });
});

describe('espionage (M16): resolution effects (stub rngs — no seed-hunting)', () => {
  function resolveNow(sim: SimRun, rng: () => number, events: SimEvent[] = []): SimEvent[] {
    // place the tick ON a day boundary so the system's gate opens
    sim.state.tick = (day(sim) + 1) * TICKS_PER_DAY - 1;
    for (const m of sim.state.missions) m.resolveDay = day(sim);
    espionageSystem(sim.state, events, rng);
    return events;
  }

  it('scout emits the settlement and writes nothing but the mission splice', () => {
    const sim = freshSim(1234);
    fund(sim);
    const theirTown = sim.state.settlements.find((s) => s.ownerRealm === 1);
    issueNow(sim, { kind: 'spyMission', target: 1, mission: 'scout', settlement: theirTown?.id });
    const stocksBefore = JSON.stringify(sim.state.realms.map((r) => r.stock));
    const queuesBefore = JSON.stringify(sim.state.settlements.map((s) => s.buildQueue));
    const events = resolveNow(sim, alwaysSucceed);
    const report = events.find((e) => e.kind === 'spyReport');
    expect(report && report.kind === 'spyReport' && report.settlement === theirTown?.id).toBe(true);
    expect(JSON.stringify(sim.state.realms.map((r) => r.stock))).toBe(stocksBefore);
    expect(JSON.stringify(sim.state.settlements.map((s) => s.buildQueue))).toBe(queuesBefore);
    expect(sim.state.missions).toHaveLength(0);
  });

  it('intel carries a snapshot, not a live reference', () => {
    const sim = freshSim(1234);
    fund(sim);
    issueNow(sim, { kind: 'spyMission', target: 1, mission: 'intel' });
    const events = resolveNow(sim, alwaysSucceed);
    const intel = events.find((e) => e.kind === 'spyIntel');
    if (!intel || intel.kind !== 'spyIntel') throw new Error('no intel');
    const goldSeen = intel.stock.gold;
    sim.state.realms[1].stock.gold = 99999;
    expect(intel.stock.gold).toBe(goldSeen); // a smuggled ledger, not a window
  });

  it('sabotage prefers the wonder, sets back progress, clamps, and survives empty queues', () => {
    const sim = freshSim(1234);
    fund(sim);
    const towns = sim.state.settlements.filter((s) => s.ownerRealm === 1);
    towns[0].buildQueue.push({ building: 'house', progress: 500 });
    towns[1]?.buildQueue.push({ building: 'wonder', progress: 100 });
    const wonderTown = towns[1] ?? towns[0];
    if (towns[1]) {
      issueNow(sim, { kind: 'spyMission', target: 1, mission: 'sabotage' });
      // measure across the (tick-free) resolution only — construction advanced
      // the job during the queueing tick, and that is not what we assert
      const wonderJob = () => wonderTown.buildQueue.find((j) => j.building === 'wonder');
      const progressBefore = wonderJob()?.progress ?? 0;
      const events = resolveNow(sim, alwaysSucceed);
      const hit = events.find((e) => e.kind === 'spySabotage');
      expect(hit && hit.kind === 'spySabotage' && hit.building === 'wonder').toBe(true);
      expect(wonderJob()?.progress).toBe(Math.max(0, progressBefore - SABOTAGE_SETBACK));
    }
    // clamp + empty queue
    sim.state.realms[0].spyCooldown = {};
    issueNow(sim, { kind: 'spyMission', target: 1, mission: 'sabotage' });
    // clear AFTER the queueing tick — realm 1's AI rebuilds at day boundaries,
    // and the resolution itself runs tick-free
    for (const t of towns) t.buildQueue = [];
    const events2 = resolveNow(sim, alwaysSucceed);
    const empty = events2.find((e) => e.kind === 'spySabotage');
    expect(empty && empty.kind === 'spySabotage' && empty.building === null).toBe(true);
  });

  it('steal moves the floored fraction; an empty vault is safe', () => {
    const sim = freshSim(1234);
    fund(sim);
    sim.state.realms[1].stock.gold = 1000;
    const myGold = () => sim.state.realms[0].stock.gold;
    issueNow(sim, { kind: 'spyMission', target: 1, mission: 'steal' });
    // measure across the tick-free resolution only — the queueing tick's
    // storage clamp already trimmed the over-cap test funding
    const mineBefore = myGold();
    const theirsBefore = sim.state.realms[1].stock.gold;
    const take = Math.floor(theirsBefore * STEAL_FRACTION);
    const events = resolveNow(sim, alwaysSucceed);
    const theft = events.find((e) => e.kind === 'spyTheft');
    expect(theft && theft.kind === 'spyTheft' && theft.gold === take).toBe(true);
    expect(sim.state.realms[1].stock.gold).toBe(theirsBefore - take);
    expect(myGold()).toBe(mineBefore + take);
    // empty vault
    sim.state.realms[0].spyCooldown = {};
    sim.state.realms[1].stock.gold = 0;
    issueNow(sim, { kind: 'spyMission', target: 1, mission: 'steal' });
    const events2 = resolveNow(sim, alwaysSucceed);
    const theft2 = events2.find((e) => e.kind === 'spyTheft');
    expect(theft2 && theft2.kind === 'spyTheft' && theft2.gold === 0).toBe(true);
  });

  it('failure = caught, no effect — and exactly ONE draw either way', () => {
    const sim = freshSim(1234);
    fund(sim);
    sim.state.realms[1].stock.gold = 1000;
    issueNow(sim, { kind: 'spyMission', target: 1, mission: 'steal' });
    let draws = 0;
    const counting = () => {
      draws++;
      return 0.999; // fail
    };
    const events = resolveNow(sim, counting);
    expect(events.some((e) => e.kind === 'spyCaught')).toBe(true);
    expect(sim.state.realms[1].stock.gold).toBe(1000); // untouched
    expect(draws).toBe(1);
    // success path draws once too
    sim.state.realms[0].spyCooldown = {};
    issueNow(sim, { kind: 'spyMission', target: 1, mission: 'intel' });
    draws = 0;
    const counting2 = () => {
      draws++;
      return 0;
    };
    resolveNow(sim, counting2);
    expect(draws).toBe(1);
  });

  it('keeps blunt spies: 0.75 bare, 0.35 behind two keeps, floored at 0.15', () => {
    const sim = freshSim(1234);
    expect(successChance(sim.state, 1)).toBeCloseTo(0.75);
    const town = sim.state.settlements.find((s) => s.ownerRealm === 1);
    if (!town) throw new Error('no town');
    town.buildings.keep = 2;
    expect(successChance(sim.state, 1)).toBeCloseTo(0.35);
    town.buildings.keep = 5;
    expect(successChance(sim.state, 1)).toBeCloseTo(0.15);
    // seeded batch: fewer successes against the fortress state
    const outcomes = (keeps: number) => {
      const s2 = freshSim(9);
      const t2 = s2.state.settlements.find((x) => x.ownerRealm === 1);
      if (t2) t2.buildings.keep = keeps;
      const rng = makeRng(42);
      let wins = 0;
      for (let k = 0; k < 100; k++) {
        s2.state.missions = [{ realm: 0, target: 1, mission: 'intel', resolveDay: 0 }];
        s2.state.tick = TICKS_PER_DAY - 1;
        const ev: SimEvent[] = [];
        espionageSystem(s2.state, ev, rng);
        if (ev.some((e) => e.kind === 'spyIntel')) wins++;
      }
      return wins;
    };
    expect(outcomes(3)).toBeLessThan(outcomes(0));
  });
});

describe('espionage (M16): the AI and the pact', () => {
  it('the AI sabotages a wonder-builder and stays silent otherwise', () => {
    const sim = freshSim(1234);
    sim.state.realms[1].stock.gold = 5000; // realm 1 can afford agents
    const quiet = run(sim, TICKS_PER_DAY + 2);
    expect(quiet.some((e) => e.kind === 'spyDispatched' && e.realm !== 0)).toBe(false);
    // the player raises a wonder; the rivals reach for matches
    const cap = sim.state.settlements[sim.state.realms[0].capital];
    cap.buildQueue.push({ building: 'wonder', progress: 200 });
    const events = run(sim, TICKS_PER_DAY + 2);
    expect(events.some((e) => e.kind === 'spyDispatched' && e.realm !== 0)).toBe(true);
  });

  it('no coalition forms inside the grace period, even against a day-0 majority', () => {
    const sim = freshSim(1234);
    for (const s of sim.state.settlements) {
      if (s.id !== sim.state.realms[1].capital && s.id !== sim.state.realms[2].capital) {
        s.ownerRealm = 0;
      }
    }
    const events = run(sim, 30); // well within COALITION_GRACE_DAYS
    expect(COALITION_GRACE_DAYS).toBeGreaterThan(3);
    expect(events.some((e) => e.kind === 'coalitionFormed')).toBe(false);
    expect(sim.state.realms[0].atWarWith).toHaveLength(0);
  });

  it('spy campaigns are deterministic: twin runs hash equal; an extra mission changes it', () => {
    const campaign = (extra: boolean) => {
      const sim = freshSim(777);
      fund(sim);
      const theirTown = sim.state.settlements.find((s) => s.ownerRealm === 1);
      const script: Record<number, { tick: number; realm: number; seq: number; cmd: Command }[]> = {
        5: [
          {
            tick: 5,
            realm: 0,
            seq: 0,
            cmd: { kind: 'spyMission', target: 1, mission: 'scout', settlement: theirTown?.id },
          },
        ],
        7: [{ tick: 7, realm: 0, seq: 1, cmd: { kind: 'spyMission', target: 2, mission: 'intel' } }],
      };
      if (extra) {
        script[300] = [
          { tick: 300, realm: 0, seq: 2, cmd: { kind: 'spyMission', target: 2, mission: 'steal' } },
        ];
      }
      run(sim, (SPY_MISSION_DAYS + 40) * TICKS_PER_DAY, script);
      return hashState(sim.state);
    };
    expect(campaign(false)).toBe(campaign(false));
    expect(campaign(false)).not.toBe(campaign(true));
  });
});
