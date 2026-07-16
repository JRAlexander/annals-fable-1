import { BUILDINGS } from '../content/buildings';
import type { ResourceId } from '../content/schema';
import type { PlacedBuilding, SimSettlement } from './state';

export interface BuildingContrib {
  housing: number;
  storage: number;
  /** Total fortification HP (town center + walls + keep) shielding a siege. */
  fortHp: number;
}

/** What a settlement's completed buildings add to housing, storage, and forts. */
export function buildingContrib(s: SimSettlement): BuildingContrib {
  const contrib: BuildingContrib = { housing: 0, storage: 0, fortHp: 0 };
  for (const [id, rawCount] of Object.entries(s.buildings)) {
    const def = BUILDINGS[id];
    const count = rawCount ?? 0;
    if (!def || count <= 0) continue;
    for (const fn of def.functions) {
      switch (fn.kind) {
        case 'housing':
          contrib.housing += fn.capacity * count;
          break;
        case 'storage':
          contrib.storage += fn.capacity * count;
          break;
        case 'fort':
          contrib.fortHp += fn.hp * count;
          break;
        default:
          break;
      }
    }
  }
  return contrib;
}

/** Siege fortification pool: what attackers must burn before the town bleeds fully. */
export function settlementFortHp(s: SimSettlement): number {
  return buildingContrib(s).fortHp;
}

/** Standing workplaces for a resource, at their placed positions (M12). */
export function workplacesOf(s: SimSettlement, resource: ResourceId): PlacedBuilding[] {
  return s.placed.filter((pb) =>
    BUILDINGS[pb.building]?.functions.some((f) => f.kind === 'workplace' && f.resource === resource),
  );
}

/** Standing dropoffs that accept a resource, at their placed positions (M12). */
export function dropoffsOf(s: SimSettlement, resource: ResourceId): PlacedBuilding[] {
  return s.placed.filter((pb) =>
    BUILDINGS[pb.building]?.functions.some((f) => f.kind === 'dropoff' && f.resources.includes(resource)),
  );
}

/** Villager slots a settlement's standing workplaces offer for a resource. */
export function workplaceSlots(s: SimSettlement, resource: ResourceId): number {
  let slots = 0;
  for (const [id, rawCount] of Object.entries(s.buildings)) {
    const def = BUILDINGS[id];
    const count = rawCount ?? 0;
    if (!def || count <= 0) continue;
    for (const fn of def.functions) {
      if (fn.kind === 'workplace' && fn.resource === resource) slots += fn.slots * count;
    }
  }
  return slots;
}
