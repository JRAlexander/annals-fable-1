import { AGES, ageIndex, nextAge } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import { WORK_JOBS, type WorkJob } from '../content/economy';
import type { BuildingId, Cost, ResourceId, TechId, UnitId } from '../content/schema';
import { TECHS } from '../content/techs';
import type { SimEvent } from './events';
import type { GameState, Realm, RealmId } from './state';

export interface Vec2 {
  x: number;
  z: number;
}

export type Objective =
  | { kind: 'attackSettlement'; settlement: number }
  | { kind: 'defendSettlement'; settlement: number };

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
  | { kind: 'trainUnits'; settlement: number; unit: UnitId; count: number } // M4
  | { kind: 'declareWar'; target: RealmId } // M5
  | { kind: 'orderArmy'; army: number; objective: Objective } // M4
  // RTS mode (M7+), same envelope, typed now:
  | { kind: 'moveUnits'; units: number[]; to: Vec2 }
  | { kind: 'attackTarget'; units: number[]; target: number }
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
      if ((n ?? 0) > 0 && BUILDINGS[id]?.requiresAge === r.age) types.add(id);
    }
  }
  return types.size;
}

function realmHasBuilding(state: GameState, r: Realm, building: BuildingId): boolean {
  return state.settlements.some((s) => s.ownerRealm === r.id && (s.buildings[building] ?? 0) > 0);
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
        const short = shortOf(r, def.cost);
        if (short) {
          reject(out, realm, `cannot afford ${def.name}: needs ${short[1]} ${short[0]}`);
          break;
        }
        pay(r, def.cost);
        s.buildQueue.push({ building: def.id, progress: 0 });
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
      default:
        reject(out, realm, `command '${cmd.kind}' not implemented yet`);
    }
  }
}
