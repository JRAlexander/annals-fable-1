import * as THREE from 'three';
import { BUILDINGS } from '../content/buildings';
import type { BuildingId } from '../content/schema';
import type { ArmiesHandle } from '../render/armiesMesh';
import { archGeo } from '../render/buildingsMesh';
import { BUILDING_ARCH } from '../render/constructedMesh';
import type { SceneHandle } from '../render/scene';
import { totalUnits } from '../sim/combat';
import type { Command } from '../sim/commands';
import type { GameState } from '../sim/state';
import { hidx, terrainHeight, worldToCell } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';
import { GRID, WORLD_SIZE } from '../worldgen/types';

const DRAG_THRESHOLD_PX = 5;
const CAMP_PICK_RADIUS = 80;

export interface InputHandle {
  /** Currently selected army ids (player-owned; pruned as armies die). */
  readonly selection: Set<number>;
  /** Individually selected soldier ids (M8a) — box-drag selects these. */
  readonly unitSelection: Set<number>;
  /** Arm (or disarm with null) free-placement mode for a building (M7b). */
  setPlacement(building: BuildingId | null): void;
  /** Programmatic army selection (control-group recall, M11). Fires onSelection. */
  selectArmies(ids: number[]): void;
  dispose(): void;
}

/**
 * The RTS mouse (M7a): left click/drag selects player armies, right click
 * orders them — enemy army → attackArmy, camp → attackCamp, enemy town at war
 * → attackSettlement, open ground → moveTo. Camera orbit moves to the middle
 * button; every order goes through the command queue like any other.
 */
export function createInput(opts: {
  scene: SceneHandle;
  world: WorldData;
  state: GameState;
  armies: ArmiesHandle;
  boxEl: HTMLElement;
  enqueue: (cmd: Command) => void;
  onSelection: (ids: number[]) => void;
}): InputHandle {
  const { scene, world, state, armies, boxEl, enqueue, onSelection } = opts;
  const canvas = scene.renderer.domElement;

  // the left and right buttons now belong to the player; camera keeps middle + wheel
  scene.controls.mouseButtons = {
    LEFT: null as unknown as THREE.MOUSE,
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: null as unknown as THREE.MOUSE,
  };

  const selection = new Set<number>();
  const unitSelection = new Set<number>();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // --- free placement mode (M7b): a ghost follows the ground until placed ---
  let placing: BuildingId | null = null;
  let ghost: THREE.Mesh | null = null;
  let ghostValid = false;
  const ghostMaterial = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.6 });

  /** Mirror of the sim's placement validation, for live ghost feedback. */
  const placementValid = (building: BuildingId, x: number, z: number): boolean => {
    const { i, j } = worldToCell(x, z);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return false;
    if (!Number.isFinite(world.navCost[hidx(i, j)])) return false;
    const def = BUILDINGS[building];
    if (!def) return false;
    let inInfluence = false;
    for (const s of state.settlements) {
      if (s.ownerRealm !== 0) continue;
      const site = world.settlements[s.id];
      const d = Math.hypot(site.x - x, site.z - z);
      if (d <= site.radius * 2.5) inInfluence = true;
    }
    if (!inInfluence) return false;
    const cellW = WORLD_SIZE / (GRID - 1);
    const half = (fp: { w: number; d: number }) => (Math.max(fp.w, fp.d) * cellW) / 4;
    for (const s of state.settlements) {
      if (s.ownerRealm !== 0) continue;
      const spots = [
        ...s.placed.map((pb) => ({
          x: pb.x,
          z: pb.z,
          fp: BUILDINGS[pb.building]?.footprint ?? { w: 1, d: 1 },
        })),
        ...s.buildQueue
          .filter((jb) => jb.at)
          .map((jb) => ({
            x: (jb.at as { x: number; z: number }).x,
            z: (jb.at as { x: number; z: number }).z,
            fp: BUILDINGS[jb.building]?.footprint ?? { w: 1, d: 1 },
          })),
      ];
      if (spots.some((pb) => Math.hypot(pb.x - x, pb.z - z) < half(pb.fp) + half(def.footprint)))
        return false;
    }
    return true;
  };

  const clearGhost = () => {
    if (ghost) scene.scene.remove(ghost);
    ghost = null;
    placing = null;
  };

  const setPlacement = (building: BuildingId | null): void => {
    clearGhost();
    if (!building) return;
    const arch = BUILDING_ARCH[building];
    if (!arch) return;
    placing = building;
    ghost = new THREE.Mesh(archGeo(arch), ghostMaterial);
    ghost.name = 'placement-ghost';
    const sc = 1.6 * (building === 'wonder' ? 3.2 : 1);
    ghost.scale.set(sc, sc, sc);
    ghost.raycast = () => {};
    ghost.visible = false;
    scene.scene.add(ghost);
  };

  const setSelection = (ids: number[]) => {
    selection.clear();
    unitSelection.clear();
    for (const id of ids) selection.add(id);
    onSelection([...selection]);
  };

  const setUnitSelection = (ids: number[]) => {
    selection.clear();
    unitSelection.clear();
    for (const id of ids) unitSelection.add(id);
    onSelection(ids);
  };

  const castArmies = (ev: PointerEvent | MouseEvent): number | null => {
    const pick = armies.getPickTargets();
    if (!pick) return null;
    ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, scene.camera);
    const hits = raycaster.intersectObject(pick.mesh, false);
    const hit = hits.find((h) => h.instanceId !== undefined);
    return hit ? (pick.ids[hit.instanceId as number] ?? null) : null;
  };

  const castGround = (ev: PointerEvent | MouseEvent): THREE.Vector3 | null => {
    ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, scene.camera);
    const hits = raycaster.intersectObjects(scene.scene.children, false);
    const hit = hits.find(
      (h) =>
        h.object.name !== 'sky' &&
        h.object.name !== 'army-banners' &&
        h.object.name !== 'selection-rings' &&
        h.object.type !== 'Points',
    );
    return hit ? hit.point : null;
  };

  // --- left button: select (click) or box-select (drag) ---
  let downX = 0;
  let downY = 0;
  let dragging = false;

  const updateBox = (ev: PointerEvent) => {
    const x = Math.min(downX, ev.clientX);
    const y = Math.min(downY, ev.clientY);
    boxEl.style.left = `${x}px`;
    boxEl.style.top = `${y}px`;
    boxEl.style.width = `${Math.abs(ev.clientX - downX)}px`;
    boxEl.style.height = `${Math.abs(ev.clientY - downY)}px`;
  };

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0 || ev.target !== canvas) return;
    downX = ev.clientX;
    downY = ev.clientY;
    dragging = true;
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (placing && ghost) {
      const point = castGround(ev);
      if (point) {
        ghost.visible = true;
        ghost.position.set(point.x, terrainHeight(world.heightmap, point.x, point.z), point.z);
        ghostValid = placementValid(placing, point.x, point.z);
        ghostMaterial.color.set(ghostValid ? 0x67c96a : 0xc94a3a);
      } else {
        ghost.visible = false;
      }
    }
    if (!dragging) return;
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) >= DRAG_THRESHOLD_PX) {
      boxEl.style.display = 'block';
      updateBox(ev);
    }
  };

  const projected = new THREE.Vector3();
  const onPointerUp = (ev: PointerEvent) => {
    if (ev.button !== 0 || !dragging) return;
    dragging = false;
    if (placing) {
      boxEl.style.display = 'none';
      const point = castGround(ev);
      if (point && ghostValid) {
        enqueue({ kind: 'placeBuilding', building: placing, at: { x: point.x, z: point.z } });
        clearGhost(); // one placement per arming — click the card again for more
      }
      return;
    }
    const wasBox = boxEl.style.display === 'block';
    boxEl.style.display = 'none';
    if (wasBox) {
      // box select picks SOLDIERS (M8a): every player unit projected inside
      const x0 = Math.min(downX, ev.clientX);
      const x1 = Math.max(downX, ev.clientX);
      const y0 = Math.min(downY, ev.clientY);
      const y1 = Math.max(downY, ev.clientY);
      const inBox = (wx: number, wz: number): boolean => {
        projected.set(wx, terrainHeight(world.heightmap, wx, wz), wz).project(scene.camera);
        const sx = ((projected.x + 1) / 2) * window.innerWidth;
        const sy = ((1 - projected.y) / 2) * window.innerHeight;
        return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      };
      const owners = new Map(state.armies.map((a) => [a.id, a.ownerRealm]));
      const ids: number[] = [];
      for (const u of state.units) {
        if (owners.get(u.group) !== 0) continue;
        if (inBox(u.x, u.z)) ids.push(u.id);
      }
      setUnitSelection(ids);
      return;
    }
    const hitId = castArmies(ev);
    const hit = hitId !== null ? state.armies.find((a) => a.id === hitId) : undefined;
    if (hit && hit.ownerRealm === 0) {
      if (ev.shiftKey) {
        selection.add(hit.id);
        onSelection([...selection]);
      } else {
        setSelection([hit.id]);
      }
    } else if (!ev.shiftKey) {
      setSelection([]);
    }
  };

  // --- right button: order the selection ---
  const onContextMenu = (ev: MouseEvent) => {
    ev.preventDefault();
    if (placing) {
      clearGhost();
      return;
    }
    if (unitSelection.size > 0) {
      // soldier micro (M8a): split-and-command through the same queue
      const owners = new Map(state.armies.map((a) => [a.id, a]));
      const ids = [...unitSelection].filter((id) => {
        const u = state.units.find((x) => x.id === id);
        return u && owners.get(u.group)?.ownerRealm === 0 && owners.get(u.group)?.phase !== 'fighting';
      });
      if (ids.length === 0) return;
      const hitArmy = castArmies(ev);
      const enemy = hitArmy !== null ? state.armies.find((a) => a.id === hitArmy) : undefined;
      if (enemy && enemy.ownerRealm !== 0) {
        enqueue({ kind: 'attackTarget', units: ids, target: enemy.id, targetKind: 'army' });
        return;
      }
      const point = castGround(ev);
      if (!point) return;
      const camp = state.camps.find(
        (c) =>
          !c.cleared &&
          Math.hypot(world.camps[c.id].x - point.x, world.camps[c.id].z - point.z) < CAMP_PICK_RADIUS,
      );
      if (camp) {
        enqueue({ kind: 'attackTarget', units: ids, target: camp.id, targetKind: 'camp' });
        return;
      }
      const town = state.settlements.find((t) => {
        if (t.ownerRealm === 0) return false;
        const site = world.settlements[t.id];
        return (
          Math.hypot(site.x - point.x, site.z - point.z) < site.radius * 1.2 &&
          state.realms[0].atWarWith.includes(t.ownerRealm)
        );
      });
      if (town) {
        enqueue({ kind: 'attackTarget', units: ids, target: town.id, targetKind: 'settlement' });
        return;
      }
      enqueue({ kind: 'moveUnits', units: ids, to: { x: point.x, z: point.z } });
      return;
    }
    if (selection.size === 0) return;
    const targets = [...selection].filter((id) =>
      state.armies.some((a) => a.id === id && a.ownerRealm === 0),
    );
    if (targets.length === 0) return;

    const hitId = castArmies(ev);
    const enemy = hitId !== null ? state.armies.find((a) => a.id === hitId) : undefined;
    if (enemy && enemy.ownerRealm !== 0) {
      for (const id of targets)
        enqueue({ kind: 'orderArmy', army: id, objective: { kind: 'attackArmy', army: enemy.id } });
      return;
    }

    const point = castGround(ev);
    if (!point) return;

    // a camp under the click?
    const camp = state.camps.find(
      (c) =>
        !c.cleared &&
        Math.hypot(world.camps[c.id].x - point.x, world.camps[c.id].z - point.z) < CAMP_PICK_RADIUS,
    );
    if (camp) {
      for (const id of targets)
        enqueue({ kind: 'orderArmy', army: id, objective: { kind: 'attackCamp', camp: camp.id } });
      return;
    }

    // an enemy settlement we are at war with?
    const settlement = state.settlements.find((s) => {
      if (s.ownerRealm === 0) return false;
      const site = world.settlements[s.id];
      return (
        Math.hypot(site.x - point.x, site.z - point.z) < site.radius * 1.2 &&
        (s.ownerRealm < 0 || state.realms[0].atWarWith.includes(s.ownerRealm))
      );
    });
    if (settlement) {
      for (const id of targets) {
        enqueue({
          kind: 'orderArmy',
          army: id,
          objective: { kind: 'attackSettlement', settlement: settlement.id },
        });
      }
      return;
    }

    // open ground: march there and hold
    const { i, j } = worldToCell(point.x, point.z);
    for (const id of targets) enqueue({ kind: 'orderArmy', army: id, objective: { kind: 'moveTo', i, j } });
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.code === 'Escape') {
      if (placing) clearGhost();
      else setSelection([]);
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return {
    selection,
    unitSelection,
    setPlacement,
    selectArmies: setSelection,
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}

/** One line describing the selection, for the HUD chip. */
export function describeSelection(
  state: GameState,
  armyIds: ReadonlySet<number>,
  unitIds?: ReadonlySet<number>,
): string {
  if (unitIds && unitIds.size > 0) {
    const chosen = state.units.filter((u) => unitIds.has(u.id));
    const groups = new Set(chosen.map((u) => u.group));
    return `⚔ ${chosen.length} ${chosen.length === 1 ? 'soldier' : 'soldiers'} from ${groups.size} ${groups.size === 1 ? 'army' : 'armies'} — right-click to detach & command`;
  }
  const mine = state.armies.filter((a) => armyIds.has(a.id) && a.ownerRealm === 0);
  if (mine.length === 0) return '';
  const troops = mine.reduce((t, a) => t + totalUnits(a.units), 0);
  const phases = [...new Set(mine.map((a) => a.phase))].join(', ');
  return `⚔ ${mine.length} ${mine.length === 1 ? 'army' : 'armies'} · ${troops} troops · ${phases}`;
}
