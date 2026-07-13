import * as THREE from 'three';
import type { ArmiesHandle } from '../render/armiesMesh';
import type { SceneHandle } from '../render/scene';
import { totalUnits } from '../sim/combat';
import type { Command } from '../sim/commands';
import type { GameState } from '../sim/state';
import { terrainHeight, worldToCell } from '../worldgen/coords';
import type { WorldData } from '../worldgen/types';

const DRAG_THRESHOLD_PX = 5;
const CAMP_PICK_RADIUS = 80;

export interface InputHandle {
  /** Currently selected army ids (player-owned; pruned as armies die). */
  readonly selection: Set<number>;
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
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const setSelection = (ids: number[]) => {
    selection.clear();
    for (const id of ids) selection.add(id);
    onSelection([...selection]);
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
    const wasBox = boxEl.style.display === 'block';
    boxEl.style.display = 'none';
    if (wasBox) {
      // box select: every player army whose projected position is inside
      const x0 = Math.min(downX, ev.clientX);
      const x1 = Math.max(downX, ev.clientX);
      const y0 = Math.min(downY, ev.clientY);
      const y1 = Math.max(downY, ev.clientY);
      const ids: number[] = [];
      for (const a of state.armies) {
        if (a.ownerRealm !== 0) continue;
        projected.set(a.x, terrainHeight(world.heightmap, a.x, a.z), a.z).project(scene.camera);
        const sx = ((projected.x + 1) / 2) * window.innerWidth;
        const sy = ((1 - projected.y) / 2) * window.innerHeight;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(a.id);
      }
      setSelection(ids);
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
    if (ev.code === 'Escape') setSelection([]);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return {
    selection,
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
export function describeSelection(state: GameState, ids: ReadonlySet<number>): string {
  const mine = state.armies.filter((a) => ids.has(a.id) && a.ownerRealm === 0);
  if (mine.length === 0) return '';
  const troops = mine.reduce((t, a) => t + totalUnits(a.units), 0);
  const phases = [...new Set(mine.map((a) => a.phase))].join(', ');
  return `⚔ ${mine.length} ${mine.length === 1 ? 'army' : 'armies'} · ${troops} troops · ${phases}`;
}
