import type { UnitId } from '../content/schema';
import { UNITS } from '../content/units';
import type { Army, FieldUnit, GameState, UnitCounts } from './state';

/**
 * The physical unit layer (M8a): every soldier in a fielded army is an entity
 * with a persistent id and a position in sim state. The army's typed COUNTS
 * remain authoritative for combat and economy — this layer mirrors them, and
 * `reconcileUnits` keeps the mirror honest after casualties. Deterministic
 * throughout: stable iteration by unit id, slots assigned in spawn order.
 */

export const FORMATION_SPACING = 7;

/** Phalanx slot offset for the k-th soldier of a group of `total`. */
export function slotOffset(slot: number, total: number): { dx: number; dz: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total * 1.5)));
  const col = (slot % cols) - (cols - 1) / 2;
  const row = Math.floor(slot / cols) + 1;
  return { dx: col * FORMATION_SPACING, dz: row * FORMATION_SPACING };
}

export function unitsOf(state: GameState, armyId: number): FieldUnit[] {
  return state.units.filter((u) => u.group === armyId);
}

/** Spawn entities matching `counts` around the army's anchor, in slot order. */
export function spawnArmyUnits(state: GameState, army: Army, counts: UnitCounts): void {
  const existing = unitsOf(state, army.id).length;
  const total = existing + Object.values(counts).reduce((t: number, n) => t + (n ?? 0), 0);
  let slot = existing;
  // deterministic type order: the content roster's declaration order
  for (const type of Object.keys(UNITS) as UnitId[]) {
    const n = counts[type] ?? 0;
    for (let k = 0; k < n; k++) {
      const { dx, dz } = slotOffset(slot, total);
      state.units.push({
        id: state.nextUnitId++,
        type,
        group: army.id,
        x: army.x + dx,
        z: army.z + dz,
        prevX: army.x + dx,
        prevZ: army.z + dz,
        slot: slot++,
      });
    }
  }
}

/** Remove every entity of an army (disband, annihilation, army removal). */
export function removeArmyUnits(state: GameState, armyId: number): void {
  state.units = state.units.filter((u) => u.group !== armyId);
}

/**
 * After casualties on the counts, drop excess entities per type — highest
 * slot first: the rear ranks fall. Never spawns (counts can only shrink in
 * battle); formArmy is the only birth place.
 */
export function reconcileUnits(state: GameState, army: Army): void {
  const have = new Map<UnitId, FieldUnit[]>();
  for (const u of state.units) {
    if (u.group !== army.id) continue;
    const list = have.get(u.type) ?? [];
    list.push(u);
    have.set(u.type, list);
  }
  const doomed = new Set<number>();
  for (const [type, list] of have) {
    const want = army.units[type] ?? 0;
    if (list.length <= want) continue;
    list.sort((a, b) => b.slot - a.slot); // rear ranks first
    for (let k = 0; k < list.length - want; k++) doomed.add(list[k].id);
  }
  if (doomed.size > 0) state.units = state.units.filter((u) => !doomed.has(u.id));
}

/**
 * Per-tick steering: every soldier walks toward its formation slot around the
 * army anchor. Step is capped by unit speed so stragglers visibly catch up
 * (marching columns stretch); anchors come from the armies system.
 */
export function steerUnits(state: GameState): void {
  const anchors = new Map<number, { x: number; z: number; total: number }>();
  for (const a of state.armies) anchors.set(a.id, { x: a.x, z: a.z, total: 0 });
  for (const u of state.units) {
    const anchor = anchors.get(u.group);
    if (anchor) anchor.total++;
  }
  for (const u of state.units) {
    u.prevX = u.x;
    u.prevZ = u.z;
    const anchor = anchors.get(u.group);
    if (!anchor) continue;
    const { dx, dz } = slotOffset(u.slot, anchor.total);
    const tx = anchor.x + dx;
    const tz = anchor.z + dz;
    const gapX = tx - u.x;
    const gapZ = tz - u.z;
    const dist = Math.hypot(gapX, gapZ);
    if (dist < 0.5) {
      u.x = tx;
      u.z = tz;
      continue;
    }
    // catch-up pace: faster than the army's crawl, still bounded per unit
    const speed = (UNITS[u.type]?.speed ?? 1) * 22;
    const step = Math.min(dist, speed);
    u.x += (gapX / dist) * step;
    u.z += (gapZ / dist) * step;
  }
}

/** Re-pack an army's slots 0..n-1 in unit-id order (after splits). */
export function resequenceSlots(state: GameState, armyId: number): void {
  const mine = state.units.filter((u) => u.group === armyId).sort((a, b) => a.id - b.id);
  mine.forEach((u, k) => {
    u.slot = k;
  });
}

/**
 * Detach specific soldiers into a NEW army (M8a micro). Counts move with
 * them; sources left empty dissolve on the next armies tick. Returns the new
 * army, positioned at the detachment's centroid. Caller validates ownership.
 */
export function splitUnits(state: GameState, ids: ReadonlySet<number>, home: number): Army {
  const chosen = state.units.filter((u) => ids.has(u.id)).sort((a, b) => a.id - b.id);
  const newId = state.nextArmyId++;
  let cx = 0;
  let cz = 0;
  const counts: UnitCounts = {};
  const bySource = new Map<number, Army | undefined>();
  for (const u of chosen) {
    cx += u.x;
    cz += u.z;
    counts[u.type] = (counts[u.type] ?? 0) + 1;
    if (!bySource.has(u.group))
      bySource.set(
        u.group,
        state.armies.find((a) => a.id === u.group),
      );
    const src = bySource.get(u.group);
    if (src) {
      const left = (src.units[u.type] ?? 0) - 1;
      if (left <= 0) delete src.units[u.type];
      else src.units[u.type] = left;
    }
    u.group = newId;
  }
  cx /= chosen.length;
  cz /= chosen.length;
  const army: Army = {
    id: newId,
    ownerRealm: 0, // caller may only split its own units; the player is realm 0
    home,
    units: counts,
    x: cx,
    z: cz,
    prevX: cx,
    prevZ: cz,
    path: [[0, 0]], // caller routes immediately
    pathIdx: 0,
    cellProgress: 0,
    objective: null,
    phase: 'idle',
    battleStartStrength: 0,
  };
  state.armies.push(army);
  resequenceSlots(state, newId);
  for (const srcId of bySource.keys()) resequenceSlots(state, srcId);
  return army;
}
