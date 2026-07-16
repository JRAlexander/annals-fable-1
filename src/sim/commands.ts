import { AGES, ageIndex, nextAge } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import { WORK_JOBS, type WorkJob } from '../content/economy';
import type { BuildingId, Cost, ResourceId, TechId, UnitId } from '../content/schema';
import { TECHS } from '../content/techs';
import { WILD_REALM } from '../content/threats';
import { UNITS } from '../content/units';
import { hidx, worldToCell } from '../worldgen/coords';
import { GRID, WORLD_SIZE } from '../worldgen/types';
import type { SimEvent } from './events';
import type { GameState, Realm, RealmId } from './state';
import { routePath } from './systems/armies';
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
 * the ruler-mode → RTS evolution work. Only `setWorkerAllocation` is live in
 * M1; the rest are typed now and reject cleanly until their milestone.
 */
export type Command =
  // Ruler mode
  | { kind: 'setWorkerAllocation'; settlement: number; alloc: Partial<Record<WorkJob, number>> }
  | { kind: 'queueBuilding'; settlement: number; building: BuildingId }
  | { kind: 'setResearch'; tech: TechId }
  | { kind: 'advanceAge' }
  | { kind: 'trainUnits'; settlement: number; unit: UnitId; count: number }
  | { kind: 'formArmy'; settlement: number; units: Partial<Record<UnitId, number>> }
  | { kind: 'declareWar'; target: RealmId } // M5
  | { kind: 'orderArmy'; army: number; objective: Objective }
  // RTS mode (M7+), same envelope, typed now:
  | { kind: 'moveUnits'; units: number[]; to: Vec2 }
  | { kind: 'attackTarget'; units: number[]; target: number; targetKind: 'army' | 'camp' | 'settlement' }
  | { kind: 'placeBuilding'; building: BuildingId; at: Vec2 };

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

/** Validate and apply this tick's commands. Invalid commands leave state untouched. */
export function applyCommands(state: GameState, issued: IssuedCommand[], out: SimEvent[]): void {
  const ordered = [...issued].sort((a, b) => a.realm - b.realm || a.seq - b.seq);
  for (const ic of ordered) {
    const { cmd, realm } = ic;
    switch (cmd.kind) {
      case 'setWorkerAllocation': {
        const s = state.settlements[cmd.settlement];
        if (!s) {
          reject(out, realm, `no such settlement ${cmd.settlement}`);
          break;
        }
        if (s.ownerRealm !== realm) {
          reject(out, realm, `settlement ${cmd.settlement} not owned by realm ${realm}`);
          break;
        }
        const next = { ...s.alloc, ...cmd.alloc };
        const values = WORK_JOBS.map((j) => next[j]);
        if (values.some((v) => !Number.isFinite(v) || v < 0)) {
          reject(out, realm, 'allocation weights must be finite and >= 0');
          break;
        }
        if (values.every((v) => v === 0)) {
          reject(out, realm, 'at least one allocation weight must be > 0');
          break;
        }
        s.alloc = next;
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
        const formed = {
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
          battleStartStrength: 0,
        };
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
        if (cmd.objective.kind === 'attackCamp') {
          const camp = state.camps[cmd.objective.camp];
          const site = state.world.camps[cmd.objective.camp];
          if (!camp || !site || camp.cleared) {
            reject(out, realm, 'no such camp remains');
            break;
          }
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
          army.objective = { kind: 'attackArmy', army: target.id };
          army.phase = 'marching';
          routePath(state, army, ...nearestCell(target.x, target.z));
        } else {
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
        r.atWarWith.push(cmd.target);
        target.atWarWith.push(realm);
        out.push({ kind: 'warDeclared', realm, target: cmd.target });
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
      // every command kind is now live — the M1 envelope is fully realized
    }
  }
}
