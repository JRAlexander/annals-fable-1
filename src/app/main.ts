import { CULTURE_IDS, CULTURES } from '../content/cultures';
import type { CultureId, Modifier } from '../content/schema';
import { makeStreams } from '../core/rng';
import { createArmies } from '../render/armiesMesh';
import { createConstructed } from '../render/constructedMesh';
import { createScene } from '../render/scene';
import type { Command, IssuedCommand } from '../sim/commands';
import { initGameState } from '../sim/state';
import { advanceTick } from '../sim/tick';
import { createArmyPanel } from '../ui/armyPanel';
import { createBuildMenu } from '../ui/buildMenu';
import { createChronicle } from '../ui/chronicle';
import { createHud } from '../ui/hud';
import { createTechMenu } from '../ui/techMenu';
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

function cultureFromHash(): CultureId | null {
  const m = location.hash.match(/culture=(\w+)/);
  return m && CULTURE_IDS.includes(m[1]) ? m[1] : null;
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

/** Overlay with one card per culture; the choice joins the seed in the URL hash. */
function pickCulture(el: HTMLElement): Promise<CultureId> {
  return new Promise((resolve) => {
    el.style.display = 'flex';
    const box = document.createElement('div');
    box.className = 'cp-box';
    box.innerHTML = '<div class="cp-title">Choose your people</div><div class="cp-cards"></div>';
    const cards = box.querySelector('.cp-cards') as HTMLElement;
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
        history.replaceState(null, '', `${location.hash}&culture=${id}`);
        el.style.display = 'none';
        resolve(id);
      });
      cards.appendChild(card);
    }
    el.appendChild(box);
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

  const seed = seedFromHash();
  const world = generateWorld(seed);
  const { history: historyRng, combat, ai } = makeStreams(seed);
  const streams = { history: historyRng, combat, ai };
  const scene = createScene(world, canvas);
  loading.style.display = 'none';
  scene.render(); // one frame behind the picker, so the choice is made over a living world
  const culture = cultureFromHash() ?? (await pickCulture(pickerEl));
  const state = initGameState(world, culture);

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
  const armyPanel = createArmyPanel(armyPanelEl, enqueue, culture);
  const techMenu = createTechMenu(techMenuEl, enqueue, culture);
  const constructed = createConstructed(scene.scene, world);
  const armies = createArmies(scene.scene, world);
  const loop = startLoop({
    simTick: () => {
      const events = advanceTick(state, drain(), streams);
      chronicle.push(events);
      toasts.push(events, state);
    },
    onFrame: (alpha) => {
      hud.update(state, loop.getSpeed());
      buildMenu.update(state);
      armyPanel.update(state);
      techMenu.update(state);
      constructed.sync(state);
      armies.sync(state, alpha);
      scene.render();
    },
  });
  const hud = createHud(
    hudEl,
    (s) => loop.setSpeed(s),
    () => techMenu.toggle(),
  );

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
