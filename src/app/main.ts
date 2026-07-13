import { createScene } from '../render/scene';
import { generateWorld } from '../worldgen/world';

function seedFromHash(): number {
  const m = location.hash.match(/seed=(\d+)/);
  if (m) return Number(m[1]);
  const seed = Math.floor(Math.random() * 100000);
  history.replaceState(null, '', `#seed=${seed}`);
  return seed;
}

function boot(): void {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const hud = document.getElementById('hud')!;
  const loading = document.getElementById('loading')!;

  const seed = seedFromHash();
  const world = generateWorld(seed);
  createScene(world, canvas);
  loading.style.display = 'none';

  const cap = world.capital;
  hud.innerHTML = `
    <span class="title">REALMS</span>
    <span>seed <b>${seed}</b></span>
    <span>capital <b>${cap.name}</b></span>
    <span>${world.settlements.length} settlements</span>
    <button id="reforge">new world</button>
  `;
  document.getElementById('reforge')!.addEventListener('click', () => {
    location.hash = `seed=${Math.floor(Math.random() * 100000)}`;
  });
}

// the seed defines the world, so a hash change is a full rebirth
window.addEventListener('hashchange', () => location.reload());
boot();
