import { CULTURE_IDS, CULTURES } from '../content/cultures';
import type { CultureId, Modifier } from '../content/schema';
import { makeStreams } from '../core/rng';
import { createArmies } from '../render/armiesMesh';
import { createConstructed } from '../render/constructedMesh';
import { createEffects } from '../render/effects';
import { createFog } from '../render/fogMesh';
import { createScaffolds } from '../render/scaffoldMesh';
import { createScene } from '../render/scene';
import { createUnitTracker } from '../render/unitTracker';
import type { Command, IssuedCommand } from '../sim/commands';
import type { SimEvent } from '../sim/events';
import { type GameState, initGameState } from '../sim/state';
import { advanceTick, type SimStreams } from '../sim/tick';
import { createArmyPanel } from '../ui/armyPanel';
import { createBuildMenu } from '../ui/buildMenu';
import { createChronicle } from '../ui/chronicle';
import { createHud } from '../ui/hud';
import { createTechMenu } from '../ui/techMenu';
import { createToasts } from '../ui/toasts';
import { generateWorld } from '../worldgen/world';
import { createInput, describeSelection } from './input';
import { SPEEDS, type Speed, startLoop } from './loop';
import { anySaveFor, clearSave, createRecorder, loadSave, replay } from './save';
import {
  accumulate,
  computeVisibility,
  isExploredAt,
  isVisibleAt,
  packExplored,
  unpackExplored,
} from './visibility';

function seedFromHash(): number {
  const m = location.hash.match(/seed=(\d+)/);
  if (m) return Number(m[1]);
  const seed = Math.floor(Math.random() * 100000);
  history.replaceState(null, '', `#seed=${seed}`);
  return seed;
}

function cultureFromHash(): CultureId | null {
  const m = location.hash.match(/culture=(\w+)/);
  return m && CULTURE_IDS.includes(m[1]) ? m[1] : null;
}

function setCultureInHash(id: CultureId): void {
  const clean = location.hash.replace(/&culture=\w+/, '');
  history.replaceState(null, '', `${clean}&culture=${id}`);
}

function bonusBlurb(bonuses: Modifier[]): string {
  return bonuses
    .map((b) => {
      const what = b.resource ?? b.unitTag ?? b.stat.replace(/([A-Z])/g, ' $1').toLowerCase();
      if (b.op === 'mul') return `+${Math.round((b.value - 1) * 100)}% ${what}`;
      return `+${b.value} ${what}`;
    })
    .join(' · ');
}

/**
 * Overlay with one card per culture (plus Continue when a save exists for
 * this seed); the choice joins the seed in the URL hash. Picking a culture
 * card starts a NEW game for that culture — any old save for it is cleared.
 */
function pickCulture(el: HTMLElement, seed: number): Promise<{ culture: CultureId; resume: boolean }> {
  return new Promise((resolve) => {
    el.style.display = 'flex';
    const box = document.createElement('div');
    box.className = 'cp-box';
    box.innerHTML = '<div class="cp-title">Choose your people</div><div class="cp-cards"></div>';
    const cards = box.querySelector('.cp-cards') as HTMLElement;

    const save = anySaveFor(seed);
    if (save) {
      const cont = document.createElement('button');
      cont.className = 'cp-card cp-continue';
      cont.innerHTML = `
        <b>⟳ Continue</b>
        <span>${CULTURES[save.culture]?.name ?? save.culture} · day ${Math.floor(save.tick / 10)}</span>
        <i>the chronicle picks up where it left off</i>
      `;
      cont.addEventListener('click', () => {
        setCultureInHash(save.culture);
        el.style.display = 'none';
        resolve({ culture: save.culture, resume: true });
      });
      cards.appendChild(cont);
    }

    for (const id of CULTURE_IDS) {
      const c = CULTURES[id];
      const card = document.createElement('button');
      card.className = 'cp-card';
      const trim = `#${c.architecture.palette.trim.toString(16).padStart(6, '0')}`;
      card.style.borderColor = trim;
      card.innerHTML = `
        <b style="color:${trim}">${c.name}</b>
        <span>${bonusBlurb(c.bonuses)}</span>
        <i>unique: ${c.uniqueUnit} · ${c.uniqueTechs.join(', ')}</i>
      `;
      card.addEventListener('click', () => {
        setCultureInHash(id);
        el.style.display = 'none';
        clearSave(seed, id); // an explicit pick is a fresh start
        resolve({ culture: id, resume: false });
      });
      cards.appendChild(card);
    }
    box.insertAdjacentHTML(
      'beforeend',
      `<div class="cp-help">Win by taking every rival capital, or by raising a Wonder and holding it. Lose your capital, lose everything.<br>
       Build (right panel) · Army &amp; Diplomacy (middle panel) · Tech (T) · Speed 1/2/3, Space pauses. The game saves itself each day.<br>
       Command armies on the map: left-click or drag to select, right-click to march or attack, middle-drag to orbit.</div>`,
    );
    el.appendChild(box);
  });
}

/** The end of the story, shown once; the world keeps turning behind it. */
function showEndScreen(el: HTMLElement, won: boolean, how: string): void {
  el.innerHTML = `
    <div class="es-box ${won ? 'es-win' : 'es-loss'}">
      <div class="es-title">${won ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="es-sub">${
        won
          ? how === 'conquest'
            ? 'Every capital bows to your banner. The realm has no rival left under heaven.'
            : 'The Wonder has stood its season unbroken. The age will bear your name.'
          : 'Your capital has fallen. The chronicle ends, written in another hand.'
      }</div>
      <div class="es-actions">
        <button id="es-watch">Keep watching the world</button>
        <button id="es-new">New world</button>
      </div>
    </div>
  `;
  el.style.display = 'flex';
  (el.querySelector('#es-watch') as HTMLElement).addEventListener('click', () => {
    el.style.display = 'none';
  });
  (el.querySelector('#es-new') as HTMLElement).addEventListener('click', () => {
    location.hash = `#seed=${Math.floor(Math.random() * 100000)}`; // hashchange reloads
  });
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const hudEl = document.getElementById('hud')!;
  const chronicleEl = document.getElementById('chronicle')!;
  const buildMenuEl = document.getElementById('buildmenu')!;
  const armyPanelEl = document.getElementById('armypanel')!;
  const techMenuEl = document.getElementById('techmenu')!;
  const toastsEl = document.getElementById('toasts')!;
  const loading = document.getElementById('loading')!;
  const pickerEl = document.getElementById('culturepicker')!;
  const endEl = document.getElementById('endscreen')!;
  const selBoxEl = document.getElementById('selbox')!;
  const selChipEl = document.getElementById('selchip')!;

  const seed = seedFromHash();
  const world = generateWorld(seed);
  const scene = createScene(world, canvas);
  loading.style.display = 'none';
  scene.render(); // one frame behind the picker, so the choice is made over a living world

  const fromHash = cultureFromHash();
  const picked = fromHash
    ? { culture: fromHash, resume: true } // a reload continues the reign
    : await pickCulture(pickerEl, seed);
  const culture = picked.culture;

  // resume from the save when there is one; otherwise a fresh founding
  const save = picked.resume ? loadSave(seed, culture) : null;
  let state: GameState;
  let streams: SimStreams;
  let restoredChronicle: SimEvent[] = [];
  if (save) {
    const restored = replay(save);
    state = restored.state;
    streams = restored.streams;
    restoredChronicle = restored.chronicleTail;
  } else {
    const { history: historyRng, combat, ai } = makeStreams(seed);
    streams = { history: historyRng, combat, ai };
    state = initGameState(world, culture);
  }
  const recorder = createRecorder(seed, culture, save?.commands ?? []);

  // the command queue — the ONLY path from input to sim state (save = seed + this log)
  let seq = save ? save.commands.length : 0;
  let pending: IssuedCommand[] = [];
  const enqueue = (cmd: Command) => {
    const issued: IssuedCommand = { tick: state.tick, realm: 0, seq: seq++, cmd };
    pending.push(issued);
    recorder.record(issued);
  };
  const drain = () => {
    const batch = pending;
    pending = [];
    return batch;
  };

  // fog of war (M7b): explored ground persists in the save; sight is live
  const fogMask = unpackExplored(save?.explored);
  const fogMesh = createFog(scene.scene, world);
  let fogVersion = 0;
  const refreshFog = () => {
    if (accumulate(fogMask, computeVisibility(state))) {
      fogVersion++;
      fogMesh.update(fogMask);
    }
  };
  refreshFog();
  const fogQueries = {
    visibleAt: (x: number, z: number) => isVisibleAt(fogMask, x, z),
    exploredAt: (x: number, z: number) => isExploredAt(fogMask, x, z),
    get version() {
      return fogVersion;
    },
  };

  const chronicle = createChronicle(chronicleEl);
  if (restoredChronicle.length) chronicle.push(restoredChronicle);
  const toasts = createToasts(toastsEl);
  const buildMenu = createBuildMenu(buildMenuEl, enqueue, (building) => input.setPlacement(building));
  const armyPanel = createArmyPanel(armyPanelEl, enqueue, culture);
  const techMenu = createTechMenu(techMenuEl, enqueue, culture);
  const constructed = createConstructed(scene.scene, world);
  const armies = createArmies(scene.scene, world);
  const tracker = createUnitTracker();
  const effects = createEffects(scene.scene, world);
  const scaffolds = createScaffolds(scene.scene, world);
  const input = createInput({
    scene,
    world,
    state,
    armies,
    boxEl: selBoxEl,
    enqueue,
    onSelection: () => {
      selChipEl.textContent = describeSelection(state, input.selection, input.unitSelection);
      selChipEl.style.display = input.selection.size || input.unitSelection.size ? 'block' : 'none';
    },
  });
  let ended = state.outcome !== null; // a replayed ending is not re-announced
  const loop = startLoop({
    simTick: () => {
      const events = advanceTick(state, drain(), streams);
      chronicle.push(events);
      toasts.push(events, state);
      refreshFog();
      // per tick, not per frame — at 12× thirty ticks can pass per rAF
      effects.spawnFromDiff(tracker.diff(state), state, fogQueries, loop.getSpeed());
      for (const e of events) {
        if (e.kind === 'dayEnd') recorder.autosave(state.tick, packExplored(fogMask));
        if (!ended && (e.kind === 'gameWon' || e.kind === 'gameLost')) {
          ended = true;
          recorder.autosave(state.tick, packExplored(fogMask));
          showEndScreen(endEl, e.kind === 'gameWon', e.kind === 'gameWon' ? e.how : '');
        }
      }
    },
    onFrame: (alpha, dtMs) => {
      hud.update(state, loop.getSpeed());
      buildMenu.update(state);
      armyPanel.update(state);
      techMenu.update(state);
      constructed.sync(state, fogQueries);
      scaffolds.sync(state, fogQueries);
      // prune the dead out of both selections so rings and orders stay honest
      for (const id of input.selection) {
        if (!state.armies.some((a) => a.id === id && a.ownerRealm === 0)) input.selection.delete(id);
      }
      if (input.unitSelection.size) {
        const liveIds = new Set(state.units.map((u) => u.id));
        for (const id of input.unitSelection) {
          if (!liveIds.has(id)) input.unitSelection.delete(id);
        }
      }
      armies.sync(state, alpha, input.selection, fogQueries, input.unitSelection, {
        maxHp: tracker.maxHp,
        camera: scene.camera,
      });
      if (input.selection.size || input.unitSelection.size)
        selChipEl.textContent = describeSelection(state, input.selection, input.unitSelection);
      else if (selChipEl.style.display !== 'none') selChipEl.style.display = 'none';
      effects.update(dtMs, loop.getSpeed());
      scene.render();
    },
  });
  const hud = createHud(
    hudEl,
    (s) => loop.setSpeed(s),
    () => techMenu.toggle(),
  );

  // debug/verification hook — the sim is still command-driven; this is a window for tests
  (window as unknown as Record<string, unknown>).__realms = {
    state,
    enqueue,
    scene,
    fog: fogQueries,
    effects,
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      loop.setSpeed(loop.getSpeed() === 0 ? 5 : 0);
    }
    if (e.code === 'KeyT') techMenu.toggle();
    const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (idx >= 0) loop.setSpeed(SPEEDS[idx + 1] as Speed);
  });
}

// the seed defines the world, so a hash change is a full rebirth
window.addEventListener('hashchange', () => location.reload());
boot();
