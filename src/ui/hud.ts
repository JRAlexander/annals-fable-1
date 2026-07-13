import type { Speed } from '../app/loop';
import { AGES } from '../content/ages';
import type { AgeId, ResourceId } from '../content/schema';
import type { GameState } from '../sim/state';
import { DAYS_PER_YEAR, dateOf, TICKS_PER_DAY } from '../sim/time';

const AGE_GLYPH: Record<AgeId, string> = { founding: '🌱', flowering: '🌸', highKingdom: '🏰', golden: '👑' };

const RESOURCES: { id: ResourceId; glyph: string }[] = [
  { id: 'food', glyph: '🌾' },
  { id: 'wood', glyph: '🪵' },
  { id: 'stone', glyph: '⛰' },
  { id: 'gold', glyph: '🪙' },
];

const SPEED_BUTTONS: { speed: Speed; label: string }[] = [
  { speed: 0, label: '❚❚' },
  { speed: 5, label: '1×' },
  { speed: 20, label: '4×' },
  { speed: 60, label: '12×' },
];

export interface Hud {
  update(state: GameState, speed: Speed): void;
}

export function createHud(el: HTMLElement, onSpeed: (s: Speed) => void, onTechToggle: () => void): Hud {
  el.innerHTML = `
    <span class="title">REALMS</span>
    <span id="hud-res"></span>
    <span id="hud-pop"></span>
    <span id="hud-age"></span>
    <span id="hud-date"></span>
    <span id="hud-speed"></span>
  `;
  const resEl = el.querySelector('#hud-res') as HTMLElement;
  const popEl = el.querySelector('#hud-pop') as HTMLElement;
  const dateEl = el.querySelector('#hud-date') as HTMLElement;
  const speedEl = el.querySelector('#hud-speed') as HTMLElement;

  const resSpans = new Map<ResourceId, { value: HTMLElement; rate: HTMLElement }>();
  for (const r of RESOURCES) {
    const wrap = document.createElement('span');
    wrap.className = 'res';
    wrap.innerHTML = `${r.glyph} <b></b><i></i>`;
    resEl.appendChild(wrap);
    resSpans.set(r.id, {
      value: wrap.querySelector('b') as HTMLElement,
      rate: wrap.querySelector('i') as HTMLElement,
    });
  }

  const ageEl = el.querySelector('#hud-age') as HTMLElement;

  const buttons = new Map<Speed, HTMLButtonElement>();
  const techBtn = document.createElement('button');
  techBtn.textContent = '⚗ Tech';
  techBtn.addEventListener('click', onTechToggle);
  speedEl.appendChild(techBtn);
  for (const { speed, label } of SPEED_BUTTONS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => onSpeed(speed));
    speedEl.appendChild(b);
    buttons.set(speed, b);
  }

  // per-day rates, computed UI-side from a one-day-ago snapshot
  let snapTick = -1;
  let snapStock: Record<ResourceId, number> | null = null;
  const rates: Partial<Record<ResourceId, number>> = {};

  const setText = (n: HTMLElement, t: string) => {
    if (n.textContent !== t) n.textContent = t;
  };

  return {
    update(state, speed) {
      const realm = state.realms[0];
      if (snapStock && state.tick > snapTick) {
        const days = (state.tick - snapTick) / TICKS_PER_DAY;
        if (days >= 1) {
          for (const r of RESOURCES) rates[r.id] = (realm.stock[r.id] - snapStock[r.id]) / days;
          snapTick = state.tick;
          snapStock = { ...realm.stock };
        }
      } else if (!snapStock) {
        snapTick = state.tick;
        snapStock = { ...realm.stock };
      }

      for (const r of RESOURCES) {
        const s = resSpans.get(r.id);
        if (!s) continue;
        setText(s.value, `${Math.floor(realm.stock[r.id])}`);
        const rate = rates[r.id];
        setText(s.rate, rate === undefined ? '' : ` ${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/d`);
      }

      const pop = state.settlements.reduce((t, s) => t + s.pop, 0);
      setText(popEl, `👥 ${Math.floor(pop)}`);
      const age = state.realms[0].age;
      setText(ageEl, `${AGE_GLYPH[age]} ${AGES[age].name}`);
      const d = dateOf(state.tick);
      setText(dateEl, `Year ${d.year} · Day ${((d.day % DAYS_PER_YEAR) + 1).toString()}`);

      for (const [s, b] of buttons) b.classList.toggle('active', s === speed);
    },
  };
}
