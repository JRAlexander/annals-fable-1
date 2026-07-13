import { makeStreams } from '../core/rng';
import { createConstructed } from '../render/constructedMesh';
import { createScene } from '../render/scene';
import type { Command, IssuedCommand } from '../sim/commands';
import { initGameState } from '../sim/state';
import { advanceTick } from '../sim/tick';
import { createBuildMenu } from '../ui/buildMenu';
import { createChronicle } from '../ui/chronicle';
import { createHud } from '../ui/hud';
import { createToasts } from '../ui/toasts';
import { generateWorld } from '../worldgen/world';
import { SPEEDS, type Speed, startLoop } from './loop';

function seedFromHash(): number {
  const m = location.hash.match(/seed=(\d+)/);
  if (m) return Number(m[1]);
  const seed = Math.floor(Math.random() * 100000);
  history.replaceState(null, '', `#seed=${seed}`);
  return seed;
}

function boot(): void {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const hudEl = document.getElementById('hud')!;
  const chronicleEl = document.getElementById('chronicle')!;
  const buildMenuEl = document.getElementById('buildmenu')!;
  const toastsEl = document.getElementById('toasts')!;
  const loading = document.getElementById('loading')!;

  const seed = seedFromHash();
  const world = generateWorld(seed);
  const { history: historyRng, combat, ai } = makeStreams(seed);
  const streams = { history: historyRng, combat, ai };
  const state = initGameState(world);
  const scene = createScene(world, canvas);
  loading.style.display = 'none';

  // the command queue — the ONLY path from input to sim state (save = seed + this log)
  let seq = 0;
  let pending: IssuedCommand[] = [];
  const enqueue = (cmd: Command) => {
    pending.push({ tick: state.tick, realm: 0, seq: seq++, cmd });
  };
  const drain = () => {
    const batch = pending;
    pending = [];
    return batch;
  };

  const chronicle = createChronicle(chronicleEl);
  const toasts = createToasts(toastsEl);
  const buildMenu = createBuildMenu(buildMenuEl, enqueue);
  const constructed = createConstructed(scene.scene, world);
  const loop = startLoop({
    simTick: () => {
      const events = advanceTick(state, drain(), streams);
      chronicle.push(events);
      toasts.push(events);
    },
    onFrame: () => {
      hud.update(state, loop.getSpeed());
      buildMenu.update(state);
      constructed.sync(state);
      scene.render();
    },
  });
  const hud = createHud(hudEl, (s) => loop.setSpeed(s));

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      loop.setSpeed(loop.getSpeed() === 0 ? 5 : 0);
    }
    const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (idx >= 0) loop.setSpeed(SPEEDS[idx + 1] as Speed);
  });
}

// the seed defines the world, so a hash change is a full rebirth
window.addEventListener('hashchange', () => location.reload());
boot();
