import { WORK_JOBS, type WorkJob } from '../content/economy';
import type { BuildingId, TechId, UnitId } from '../content/schema';
import type { SimEvent } from './events';
import type { GameState, RealmId } from './state';

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
  | { kind: 'queueBuilding'; settlement: number; building: BuildingId } // M2
  | { kind: 'setResearch'; tech: TechId } // M3
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
      default:
        reject(out, realm, `command '${cmd.kind}' not implemented yet`);
    }
  }
}
