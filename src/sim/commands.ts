import { AGES, ageIndex, nextAge } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import { TRUCE_DAYS } from '../content/diplomacy';
import { VILLAGER_COST, VILLAGER_JOBS, type VillagerJob } from '../content/economy';
import type { BuildingId, Cost, ResourceId, TechId, UnitId } from '../content/schema';
import { TECHS } from '../content/techs';
import { WILD_REALM } from '../content/threats';
import { UNITS } from '../content/units';
import { hidx, worldToCell } from '../worldgen/coords';
import { GRID, WORLD_SIZE } from '../worldgen/types';
import { acceptsPeace, runawayLeader, type Tribute, tributeValue } from './diplomacy';
import type { SimEvent } from './events';
import {
  ARMY_STANCES,
  type Army,
  type ArmyStance,
  type GameState,
  type RallyTarget,
  type Realm,
  type RealmId,
} from './state';
import { goHomeward, routePath, standDown } from './systems/armies';
import { dateOf } from './time';
import { spawnArmyUnits, splitUnits } from './unitStore';

/** Nearest navgrid cell to a world position, as routePath arguments. */
function nearestCell(x: number, z: number): [number, number] {
  const { i, j } = worldToCell(x, z);
  return [i, j];
}

export interface Vec2 {
  x: number;
  z: number;
}

export type Objective =
  | { kind: 'attackCamp'; camp: number }
  | { kind: 'attackSettlement'; settlement: number } // M5
  | { kind: 'moveTo'; i: number; j: number } // M7a
  | { kind: 'attackArmy'; army: number } // M7a
  | { kind: 'returnHome' };

/**
 * Every player AND AI mutation flows through this union — it is the sim's
 * entire external API, which is what makes save-as-command-log, replays, and
 * the ruler-mode → RTS evolution work. (M12 retired `setWorkerAllocation`
 * for the villager pair below — save format bumped to v3.)
 */
export type Command =
  // Ruler mode
  | { kind: 'trainVillagers'; settlement: number; count: number }
  | { kind: 'assignVillagers'; settlement: number; job: VillagerJob; count: number }
  | { kind: 'queueBuilding'; settlement: number; building: BuildingId }
  | { kind: 'setResearch'; tech: TechId }
  | { kind: 'advanceAge' }
  | { kind: 'trainUnits'; settlement: number; unit: UnitId; count: number }
  | { kind: 'formArmy'; settlement: number; units: Partial<Record<UnitId, number>>; marshal?: true }
  | { kind: 'declareWar'; target: RealmId } // M5
  | { kind: 'orderArmy'; army: number; objective: Objective }
  // RTS mode (M7+), same envelope, typed now:
  | { kind: 'moveUnits'; units: number[]; to: Vec2 }
  | { kind: 'attackTarget'; units: number[]; target: number; targetKind: 'army' | 'camp' | 'settlement' }
  | { kind: 'placeBuilding'; building: BuildingId; at: Vec2 }
  // Unit autonomy (M13) — appended kinds, so v3 command logs replay unchanged:
  | { kind: 'setStance'; army: number; stance: ArmyStance }
  | { kind: 'setRally'; settlement: number; rally: RallyTarget | null }
  | { kind: 'setGovernor'; settlement: number; enabled: boolean }
  // Full autopilot (M14) — appended kinds, same replay guarantee:
  | { kind: 'setSteward'; settlement: number; enabled: boolean }
  | { kind: 'setMarshal'; enabled: boolean }
  // Diplomacy (M15):
  | { kind: 'offerPeace'; target: RealmId; tribute: Tribute };

export interface IssuedCommand {
  /** Tick it executes on (stamped at enqueue time). */
  tick: number;
  /** Issuer; validated against ownership. */
  realm: RealmId;
  /** Monotonic per-realm counter — stable ordering within a tick. */
  seq: number;
  cmd: Command;
}

function reject(out: SimEvent[], realm: RealmId, reason: string): void {
  out.push({ kind: 'commandRejected', realm, reason });
}

/** The resource the realm is short of, or null if it can afford `cost`. */
function shortOf(r: Realm, cost: Cost): [ResourceId, number] | null {
  const costs = Object.entries(cost) as [ResourceId, number][];
  return costs.find(([res, amt]) => r.stock[res] < amt) ?? null;
}

function pay(r: Realm, cost: Cost): void {
  for (const [res, amt] of Object.entries(cost) as [ResourceId, number][]) r.stock[res] -= amt;
}

/** Distinct completed building types with requiresAge === the realm's current age. */
function currentAgeBuildingTypes(state: GameState, r: Realm): number {
  const types = new Set<string>();
  for (const s of state.settlements) {
    if (s.ownerRealm !== r.id) continue;
    for (const [id, n] of Object.entries(s.buildings)) {
      const def = BUILDINGS[id];
      // seeded freebies (town centers) prove nothing about a realm's progress
      if ((n ?? 0) > 0 && def?.requiresAge === r.age && !def.seedOnly) types.add(id);
    }
  }
  return types.size;
}

function realmHasBuilding(state: GameState, r: Realm, building: BuildingId): boolean {
  return state.settlements.some((s) => s.ownerRealm === r.id && (s.buildings[building] ?? 0) > 0);
}

/** Shared age/tech/uniqueness/cost gates for constructing `def`. True = clear to pay. */
function buildingGates(
  state: GameState,
  realm: RealmId,
  def: (typeof BUILDINGS)[string],
  out: SimEvent[],
): boolean {
  const r = state.realms[realm];
  if (def.seedOnly) {
    reject(out, realm, `${def.name} cannot be built — every settlement is founded with one`);
    return false;
  }
  if (ageIndex(def.requiresAge) > ageIndex(r.age)) {
    reject(out, realm, `${def.name} requires ${AGES[def.requiresAge].name}`);
    return false;
  }
  const missingTech = (def.requiresTechs ?? []).find((t) => !r.researchedTechs.includes(t));
  if (missingTech) {
    reject(out, realm, `${def.name} requires the ${TECHS[missingTech]?.name ?? missingTech} technology`);
    return false;
  }
  if (def.id === 'wonder') {
    const hasOne = state.settlements.some(
      (x) =>
        x.ownerRealm === realm &&
        ((x.buildings.wonder ?? 0) > 0 || x.buildQueue.some((j) => j.building === 'wonder')),
    );
    if (hasOne) {
      reject(out, realm, 'a realm raises only one Wonder');
      return false;
    }
  }
  const short = shortOf(r, def.cost);
  if (short) {
    reject(out, realm, `cannot afford ${def.name}: needs ${short[1]} ${short[0]}`);
    return false;
  }
  return true;
}

/**
 * Peace is sworn (M15): the war ends, a truce is stamped, tribute changes
 * hands, and every army caught mid-campaign against the other realm stands
 * down — nothing in the per-tick systems re-checks war state, so the treaty
 * must clean up after itself. Runs before armiesSystem within the tick, and
 * detectEngagements re-checks hostility, so no freshly-peaced pair re-locks.
 */
function makePeace(state: GameState, a: Realm, b: Realm, tribute: Tribute, out: SimEvent[]): void {
  const day = dateOf(state.tick).day;
  a.atWarWith = a.atWarWith.filter((id) => id !== b.id);
  b.atWarWith = b.atWarWith.filter((id) => id !== a.id);
  a.truceUntil[b.id] = day + TRUCE_DAYS;
  b.truceUntil[a.id] = day + TRUCE_DAYS;

  // tribute both ways; the storage clamp clips overflow next pass — a full
  // treasury wastes tribute, exactly as it wastes camp loot
  const transfer = (from: Realm, to: Realm, cost?: Cost) => {
    if (!cost) return;
    pay(from, cost);
    for (const [res, amt] of Object.entries(cost) as [ResourceId, number][]) {
      to.stock[res] += amt ?? 0;
    }
  };
  transfer(a, b, tribute.give);
  transfer(b, a, tribute.demand);

  // the armies stand down: engaged pairs break, sieges and pursuits turn home
  const pairIds = new Set([a.id, b.id]);
  for (const army of [...state.armies]) {
    if (!pairIds.has(army.ownerRealm)) continue;
    if (!state.armies.includes(army)) continue; // dissolved earlier this pass
    const otherId = army.ownerRealm === a.id ? b.id : a.id;
    if (army.engagedWith !== undefined) {
      const foe = state.armies.find((x) => x.id === army.engagedWith);
      if (foe && foe.ownerRealm === otherId) {
        standDown(state, foe);
        standDown(state, army);
        continue;
      }
    }
    if (army.defending) continue; // the defender sweep below decides
    const o = army.objective;
    if (o?.kind === 'attackSettlement' && state.settlements[o.settlement]?.ownerRealm === otherId) {
      goHomeward(state, army);
    } else if (o?.kind === 'attackArmy') {
      const quarry = state.armies.find((x) => x.id === o.army);
      if (quarry && quarry.ownerRealm === otherId) goHomeward(state, army);
    }
  }
  // just-mustered defenders whose siege has lifted (their besieger turned
  // home above) dissolve back behind their walls; any REMAINING threat —
  // wilds, a third realm still at war — keeps them standing
  for (const army of [...state.armies]) {
    if (!pairIds.has(army.ownerRealm)) continue;
    if (army.defending?.settlement === undefined || army.engagedWith !== undefined) continue;
    const post = army.defending.settlement;
    const stillThreatened = state.armies.some(
      (x) =>
        x.ownerRealm !== army.ownerRealm &&
        x.objective?.kind === 'attackSettlement' &&
        x.objective.settlement === post,
    );
    if (!stillThreatened) standDown(state, army);
  }

  out.push({
    kind: 'peaceMade',
    realm: a.id,
    target: b.id,
    gave: tribute.give ?? {},
    demanded: tribute.demand ?? {},
  });
}

/** Validate and apply this tick's commands. Invalid commands leave state untouched. */
export function applyCommands(state: GameState, issued: IssuedCommand[], out: SimEvent[]): void {
  const ordered = [...issued].sort((a, b) => a.realm - b.realm || a.seq - b.seq);
  for (const ic of ordered) {
    const { cmd, realm } = ic;
    switch (cmd.kind) {
      case 'trainVillagers': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        if (!Number.isInteger(cmd.count) || cmd.count <= 0 || cmd.count > 20) {
          reject(out, realm, 'villager count must be an integer between 1 and 20');
          break;
        }
        if (s.pop - cmd.count < 30) {
          reject(out, realm, `not enough folk in ${state.world.settlements[s.id].name} to send afield`);
          break;
        }
        const total: Cost = {};
        for (const [res, amt] of Object.entries(VILLAGER_COST) as [ResourceId, number][]) {
          total[res] = amt * cmd.count;
        }
        const short = shortOf(state.realms[realm], total);
        if (short) {
          reject(out, realm, `cannot afford villagers: needs ${short[1]} ${short[0]}`);
          break;
        }
        pay(state.realms[realm], total);
        s.pop -= cmd.count;
        s.villagerQueue.remaining += cmd.count;
        break;
      }
      case 'assignVillagers': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        if (!VILLAGER_JOBS.includes(cmd.job)) {
          reject(out, realm, `unknown job '${cmd.job}'`);
          break;
        }
        if (!Number.isInteger(cmd.count) || cmd.count < 0 || cmd.count > 500) {
          reject(out, realm, 'job target must be an integer between 0 and 500');
          break;
        }
        s.jobTargets[cmd.job] = cmd.count;
        break;
      }
      case 'queueBuilding': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        const def = BUILDINGS[cmd.building];
        if (!def) {
          reject(out, realm, `unknown building '${cmd.building}'`);
          break;
        }
        if (!buildingGates(state, realm, def, out)) break;
        pay(state.realms[realm], def.cost);
        s.buildQueue.push({ building: def.id, progress: 0 });
        out.push({ kind: 'buildingQueued', settlement: s.id, building: def.id });
        break;
      }
      case 'placeBuilding': {
        const def = BUILDINGS[cmd.building];
        if (!def) {
          reject(out, realm, `unknown building '${cmd.building}'`);
          break;
        }
        const { x, z } = cmd.at;
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
          reject(out, realm, 'no such place');
          break;
        }
        const [ci, cj] = nearestCell(x, z);
        if (!Number.isFinite(state.world.navCost[hidx(ci, cj)])) {
          reject(out, realm, 'nothing can be built on the water');
          break;
        }
        // the nearest OWNED settlement whose influence covers the spot
        let s: (typeof state.settlements)[number] | undefined;
        let bestD = Number.POSITIVE_INFINITY;
        for (const cand of state.settlements) {
          if (cand.ownerRealm !== realm) continue;
          const site = state.world.settlements[cand.id];
          const d = Math.hypot(site.x - x, site.z - z);
          if (d < bestD && d <= site.radius * 2.5) {
            bestD = d;
            s = cand;
          }
        }
        if (!s) {
          reject(out, realm, 'too far from any settlement of the realm');
          break;
        }
        // footprint overlap against existing placed buildings and queued spots
        const cellW = WORLD_SIZE / (GRID - 1);
        const half = (fp: { w: number; d: number }) => (Math.max(fp.w, fp.d) * cellW) / 4;
        const tooClose = state.settlements.some((other) => {
          if (other.ownerRealm !== realm) return false;
          const queuedSpots = other.buildQueue
            .filter((j) => j.at)
            .map((j) => ({
              x: (j.at as { x: number; z: number }).x,
              z: (j.at as { x: number; z: number }).z,
              fp: BUILDINGS[j.building]?.footprint ?? { w: 1, d: 1 },
            }));
          const placedSpots = other.placed.map((pb) => ({
            x: pb.x,
            z: pb.z,
            fp: BUILDINGS[pb.building]?.footprint ?? { w: 1, d: 1 },
          }));
          return [...placedSpots, ...queuedSpots].some(
            (pb) => Math.hypot(pb.x - x, pb.z - z) < half(pb.fp) + half(def.footprint),
          );
        });
        if (tooClose) {
          reject(out, realm, 'the ground there is already taken');
          break;
        }
        if (!buildingGates(state, realm, def, out)) break;
        pay(state.realms[realm], def.cost);
        s.buildQueue.push({ building: def.id, progress: 0, at: { x, z } });
        out.push({ kind: 'buildingQueued', settlement: s.id, building: def.id });
        break;
      }
      case 'setResearch': {
        const r = state.realms[realm];
        const def = TECHS[cmd.tech];
        if (!def) {
          reject(out, realm, `unknown technology '${cmd.tech}'`);
          break;
        }
        if (r.researchedTechs.includes(def.id)) {
          reject(out, realm, `${def.name} is already researched`);
          break;
        }
        if (r.research) {
          reject(
            out,
            realm,
            r.research.kind === 'tech'
              ? `the realm is already researching ${TECHS[r.research.tech]?.name ?? r.research.tech}`
              : 'the realm is busy advancing its age',
          );
          break;
        }
        if (ageIndex(def.age) > ageIndex(r.age)) {
          reject(out, realm, `${def.name} requires ${AGES[def.age].name}`);
          break;
        }
        if (def.culture && def.culture !== r.culture) {
          reject(out, realm, `${def.name} is a secret of the ${def.culture}`);
          break;
        }
        const missing = def.prereqs.find((p) => !r.researchedTechs.includes(p));
        if (missing) {
          reject(out, realm, `${def.name} requires ${TECHS[missing]?.name ?? missing} first`);
          break;
        }
        if (!realmHasBuilding(state, r, def.researchedAt)) {
          reject(
            out,
            realm,
            `${def.name} is researched at the ${BUILDINGS[def.researchedAt]?.name ?? def.researchedAt} — build one first`,
          );
          break;
        }
        const short = shortOf(r, def.cost);
        if (short) {
          reject(out, realm, `cannot afford ${def.name}: needs ${short[1]} ${short[0]}`);
          break;
        }
        pay(r, def.cost);
        r.research = { kind: 'tech', tech: def.id, progress: 0 };
        out.push({ kind: 'researchStarted', realm, tech: def.id });
        break;
      }
      case 'trainUnits': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        const def = UNITS[cmd.unit];
        if (!def || !Number.isInteger(cmd.count) || cmd.count <= 0) {
          reject(out, realm, `invalid training order '${cmd.unit}' ×${cmd.count}`);
          break;
        }
        const r = state.realms[realm];
        if (ageIndex(def.requiresAge) > ageIndex(r.age)) {
          reject(out, realm, `${def.name} requires ${AGES[def.requiresAge].name}`);
          break;
        }
        const missingTech = (def.requiresTechs ?? []).find((t) => !r.researchedTechs.includes(t));
        if (missingTech) {
          reject(
            out,
            realm,
            `${def.name} requires the ${TECHS[missingTech]?.name ?? missingTech} technology`,
          );
          break;
        }
        if (def.culture && def.culture !== r.culture) {
          reject(out, realm, `only the ${def.culture} may train the ${def.name}`);
          break;
        }
        const trainer = Object.entries(BUILDINGS).find(
          ([id, b]) =>
            (s.buildings[id] ?? 0) > 0 &&
            b.functions.some((f) => f.kind === 'training' && f.units.includes(def.id)),
        );
        if (!trainer) {
          reject(out, realm, `${def.name} needs a training building here (e.g. barracks/range/stable)`);
          break;
        }
        const popNeeded = def.popCost * cmd.count;
        if (s.pop - popNeeded < 30) {
          reject(
            out,
            realm,
            `not enough folk in ${state.world.settlements[s.id].name} to enlist ${cmd.count}`,
          );
          break;
        }
        const totalCost: Cost = {};
        for (const [res, amt] of Object.entries(def.cost) as [ResourceId, number][]) {
          totalCost[res] = amt * cmd.count;
        }
        const short = shortOf(r, totalCost);
        if (short) {
          reject(out, realm, `cannot afford ${cmd.count}× ${def.name}: needs ${short[1]} ${short[0]}`);
          break;
        }
        pay(r, totalCost);
        s.pop -= popNeeded;
        s.trainQueue.push({ unit: def.id, remaining: cmd.count, progress: 0 });
        break;
      }
      case 'formArmy': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        const taking: [UnitId, number][] = [];
        for (const [id, n] of Object.entries(cmd.units) as [UnitId, number][]) {
          if (!Number.isInteger(n) || n < 0) {
            taking.length = 0;
            break;
          }
          if (n === 0) continue;
          if ((s.garrison[id] ?? 0) < n) {
            reject(out, realm, `garrison has only ${s.garrison[id] ?? 0} ${UNITS[id]?.name ?? id}`);
            taking.length = 0;
            break;
          }
          taking.push([id, n]);
        }
        if (taking.length === 0) {
          if (!out.some((e) => e.kind === 'commandRejected')) reject(out, realm, 'an army needs soldiers');
          break;
        }
        const site = state.world.settlements[s.id];
        const units: Partial<Record<UnitId, number>> = {};
        let strength = 0;
        for (const [id, n] of taking) {
          s.garrison[id] = (s.garrison[id] ?? 0) - n;
          if (s.garrison[id] === 0) delete s.garrison[id];
          units[id] = n;
          strength += n;
        }
        const formed: Army = {
          id: state.nextArmyId,
          ownerRealm: realm,
          home: s.id,
          units,
          x: site.x,
          z: site.z,
          prevX: site.x,
          prevZ: site.z,
          path: [[site.i, site.j]] as [number, number][],
          pathIdx: 0,
          cellProgress: 0,
          objective: null,
          phase: 'idle' as const,
          stance: 'defensive' as const,
          muster: strength,
          battleStartStrength: 0,
        };
        if (cmd.marshal === true) formed.marshal = true; // the marshal's own banner (M14)
        state.armies.push(formed);
        spawnArmyUnits(state, formed, units); // the soldiers take the field (M8a)
        out.push({ kind: 'armyFormed', army: state.nextArmyId, settlement: s.id, strength });
        state.nextArmyId += 1;
        break;
      }
      case 'orderArmy': {
        const army = state.armies.find((a) => a.id === cmd.army);
        if (!army) {
          reject(out, realm, `no such army ${cmd.army}`);
          break;
        }
        if (army.ownerRealm !== realm) {
          reject(out, realm, `army ${cmd.army} not yours`);
          break;
        }
        if (army.phase === 'fighting') {
          reject(out, realm, 'the army is locked in battle');
          break;
        }
        // a successful direct order overrides the autonomy layer (M13): each
        // accepting branch below clears the return-to-post memory
        if (cmd.objective.kind === 'attackCamp') {
          const camp = state.camps[cmd.objective.camp];
          const site = state.world.camps[cmd.objective.camp];
          if (!camp || !site || camp.cleared) {
            reject(out, realm, 'no such camp remains');
            break;
          }
          delete army.post;
          army.objective = { kind: 'attackCamp', camp: camp.id };
          army.phase = 'marching';
          routePath(state, army, site.i, site.j);
          out.push({ kind: 'armyDeparted', army: army.id, camp: camp.id });
        } else if (cmd.objective.kind === 'attackSettlement') {
          const target = state.settlements[cmd.objective.settlement];
          if (!target) {
            reject(out, realm, `no such settlement ${cmd.objective.settlement}`);
            break;
          }
          if (target.ownerRealm === realm) {
            reject(out, realm, 'that settlement is already yours');
            break;
          }
          const r = state.realms[realm];
          if (!r.atWarWith.includes(target.ownerRealm)) {
            reject(out, realm, `you are not at war with ${state.realms[target.ownerRealm].name}`);
            break;
          }
          const site = state.world.settlements[target.id];
          delete army.post;
          army.objective = { kind: 'attackSettlement', settlement: target.id };
          army.phase = 'marching';
          routePath(state, army, site.i, site.j);
          out.push({ kind: 'armyMarchedOnSettlement', army: army.id, settlement: target.id });
        } else if (cmd.objective.kind === 'moveTo') {
          const { i, j } = cmd.objective;
          if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= GRID || j >= GRID) {
            reject(out, realm, 'no such place');
            break;
          }
          if (!Number.isFinite(state.world.navCost[hidx(i, j)])) {
            reject(out, realm, 'an army cannot march into the sea');
            break;
          }
          delete army.post;
          army.objective = { kind: 'moveTo', i, j };
          army.phase = 'marching';
          routePath(state, army, i, j);
        } else if (cmd.objective.kind === 'attackArmy') {
          const target = state.armies.find((a) => a.id === (cmd.objective as { army: number }).army);
          if (!target) {
            reject(out, realm, 'that host is no more');
            break;
          }
          if (target.ownerRealm === realm) {
            reject(out, realm, 'that army is your own');
            break;
          }
          const r = state.realms[realm];
          const hostile = target.ownerRealm === WILD_REALM || r.atWarWith.includes(target.ownerRealm);
          if (!hostile) {
            reject(out, realm, `you are not at war with ${state.realms[target.ownerRealm]?.name ?? 'them'}`);
            break;
          }
          delete army.post;
          army.objective = { kind: 'attackArmy', army: target.id };
          army.phase = 'marching';
          routePath(state, army, ...nearestCell(target.x, target.z));
        } else {
          delete army.post;
          army.objective = { kind: 'returnHome' };
          army.phase = 'returning';
          const home = state.world.settlements[army.home];
          routePath(state, army, home.i, home.j);
        }
        break;
      }
      case 'advanceAge': {
        const r = state.realms[realm];
        const target = nextAge(r.age);
        if (!target) {
          reject(out, realm, 'the realm already stands in the Golden Age');
          break;
        }
        if (r.research) {
          reject(out, realm, 'the research slot is busy');
          break;
        }
        const targetDef = AGES[target];
        const have = currentAgeBuildingTypes(state, r);
        if (have < targetDef.requires.buildingsFromCurrentAge) {
          reject(
            out,
            realm,
            `advancing needs ${targetDef.requires.buildingsFromCurrentAge} kinds of ${AGES[r.age].name} building, have ${have}`,
          );
          break;
        }
        const short = shortOf(r, targetDef.advanceCost);
        if (short) {
          reject(out, realm, `cannot afford the advance: needs ${short[1]} ${short[0]}`);
          break;
        }
        pay(r, targetDef.advanceCost);
        r.research = { kind: 'age', progress: 0 };
        out.push({ kind: 'ageAdvanceStarted', realm, age: target });
        break;
      }
      case 'declareWar': {
        const r = state.realms[realm];
        const target = state.realms[cmd.target];
        if (!target || cmd.target === realm) {
          reject(out, realm, 'no such rival realm');
          break;
        }
        if (r.atWarWith.includes(cmd.target)) {
          reject(out, realm, `already at war with ${target.name}`);
          break;
        }
        {
          const day = dateOf(state.tick).day;
          const truce = r.truceUntil[cmd.target] ?? 0;
          if (day < truce) {
            reject(out, realm, `the truce with ${target.name} holds for ${truce - day} more days`);
            break;
          }
        }
        r.atWarWith.push(cmd.target);
        target.atWarWith.push(realm);
        out.push({ kind: 'warDeclared', realm, target: cmd.target });
        // an AI declaring on the runaway leader is the pact taking shape (M15)
        if (!r.isPlayer && runawayLeader(state) === cmd.target) {
          out.push({ kind: 'coalitionFormed', against: cmd.target, members: [realm] });
        }
        break;
      }
      case 'offerPeace': {
        const offerer = state.realms[realm];
        const target = state.realms[cmd.target];
        if (!target || cmd.target === realm) {
          reject(out, realm, 'no such rival realm');
          break;
        }
        if (!offerer.atWarWith.includes(cmd.target)) {
          reject(out, realm, `there is no war with ${target.name} to end`);
          break;
        }
        if (cmd.tribute.give && shortOf(offerer, cmd.tribute.give)) {
          reject(out, realm, 'cannot afford the tribute offered');
          break;
        }
        if (cmd.tribute.demand && shortOf(target, cmd.tribute.demand)) {
          reject(out, realm, `${target.name} cannot pay such tribute`);
          break;
        }
        // the player is never bound by a demand it did not choose to accept
        const accepted = target.isPlayer
          ? tributeValue(cmd.tribute.demand) === 0
          : acceptsPeace(state, target, offerer, cmd.tribute);
        if (!accepted) {
          reject(out, realm, `${target.name} refuses our terms`);
          break;
        }
        makePeace(state, offerer, target, cmd.tribute, out);
        break;
      }
      case 'moveUnits':
      case 'attackTarget': {
        const wanted = cmd.kind === 'moveUnits' ? cmd.units : cmd.units;
        const ids = new Set(wanted);
        if (ids.size === 0) {
          reject(out, realm, 'no soldiers chosen');
          break;
        }
        // every chosen soldier must exist, serve this realm, and be free to move
        const chosen = state.units.filter((u) => ids.has(u.id));
        if (chosen.length !== ids.size) {
          reject(out, realm, 'some of those soldiers are no more');
          break;
        }
        const groups = new Map(state.armies.map((a) => [a.id, a]));
        let bad = false;
        for (const u of chosen) {
          const g = groups.get(u.group);
          if (!g || g.ownerRealm !== realm) {
            reject(out, realm, 'those soldiers are not yours to command');
            bad = true;
            break;
          }
          if (g.phase === 'fighting') {
            reject(out, realm, 'soldiers locked in battle cannot be detached');
            bad = true;
            break;
          }
        }
        if (bad) break;

        // resolve destination/target BEFORE splitting — invalid orders split nothing
        if (cmd.kind === 'moveUnits') {
          const { i, j } = worldToCell(cmd.to.x, cmd.to.z);
          if (i < 0 || j < 0 || i >= GRID || j >= GRID || !Number.isFinite(state.world.navCost[hidx(i, j)])) {
            reject(out, realm, 'soldiers cannot march into the sea');
            break;
          }
          const home = groups.get(chosen[0].group)?.home ?? 0;
          const det = splitUnits(state, ids, home);
          det.ownerRealm = realm;
          det.objective = { kind: 'moveTo', i, j };
          det.phase = 'marching';
          routePath(state, det, i, j);
          out.push({ kind: 'armyFormed', army: det.id, settlement: home, strength: chosen.length });
        } else {
          // attackTarget: the id space is explicit — army, camp, or settlement
          const r = state.realms[realm];
          const enemyArmy =
            cmd.targetKind === 'army'
              ? state.armies.find(
                  (a) =>
                    a.id === cmd.target &&
                    a.ownerRealm !== realm &&
                    (a.ownerRealm === WILD_REALM || r.atWarWith.includes(a.ownerRealm)),
                )
              : undefined;
          const camp = cmd.targetKind === 'camp' ? state.camps[cmd.target] : undefined;
          const settlement =
            cmd.targetKind === 'settlement'
              ? state.settlements.find(
                  (x) => x.id === cmd.target && x.ownerRealm !== realm && r.atWarWith.includes(x.ownerRealm),
                )
              : undefined;
          if (!enemyArmy && (!camp || camp.cleared) && !settlement) {
            reject(out, realm, 'no such enemy to strike');
            break;
          }
          const home = groups.get(chosen[0].group)?.home ?? 0;
          const det = splitUnits(state, ids, home);
          det.ownerRealm = realm;
          det.phase = 'marching';
          if (enemyArmy) {
            det.objective = { kind: 'attackArmy', army: enemyArmy.id };
            routePath(state, det, ...nearestCell(enemyArmy.x, enemyArmy.z));
          } else if (camp && !camp.cleared) {
            det.objective = { kind: 'attackCamp', camp: camp.id };
            const site = state.world.camps[camp.id];
            routePath(state, det, site.i, site.j);
          } else if (settlement) {
            det.objective = { kind: 'attackSettlement', settlement: settlement.id };
            const site = state.world.settlements[settlement.id];
            routePath(state, det, site.i, site.j);
          }
          out.push({ kind: 'armyFormed', army: det.id, settlement: home, strength: chosen.length });
        }
        break;
      }
      case 'setStance': {
        const army = state.armies.find((a) => a.id === cmd.army);
        if (!army) {
          reject(out, realm, `no such army ${cmd.army}`);
          break;
        }
        if (army.ownerRealm !== realm) {
          reject(out, realm, `army ${cmd.army} not yours`);
          break;
        }
        if (!ARMY_STANCES.includes(cmd.stance)) {
          reject(out, realm, `unknown stance '${cmd.stance}'`);
          break;
        }
        army.stance = cmd.stance;
        // an army told to stand fast forgets the post it was walking back to
        if (cmd.stance === 'standGround') delete army.post;
        break;
      }
      case 'setRally': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        const r = cmd.rally;
        if (r === null) {
          delete s.rally;
          break;
        }
        if (r.kind === 'army') {
          const target = state.armies.find((a) => a.id === r.army);
          if (!target || target.ownerRealm !== realm || target.defending) {
            reject(out, realm, 'no army of yours stands ready to be reinforced');
            break;
          }
          s.rally = { kind: 'army', army: target.id };
        } else if (r.kind === 'point') {
          const { i, j } = r;
          if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= GRID || j >= GRID) {
            reject(out, realm, 'no such place');
            break;
          }
          if (!Number.isFinite(state.world.navCost[hidx(i, j)])) {
            reject(out, realm, 'soldiers cannot muster in the sea');
            break;
          }
          s.rally = { kind: 'point', i, j };
        } else {
          reject(out, realm, 'invalid rally order');
        }
        break;
      }
      case 'setGovernor': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        s.governor = cmd.enabled === true;
        break;
      }
      case 'setSteward': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        s.steward = cmd.enabled === true;
        break;
      }
      case 'setMarshal': {
        const r = state.realms[realm];
        if (!r) {
          reject(out, realm, 'no such realm');
          break;
        }
        r.marshal = cmd.enabled === true;
        break;
      }
      // every command kind is now live — the M1 envelope is fully realized
    }
  }
}
