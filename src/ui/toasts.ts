import { AGES } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import { TECHS } from '../content/techs';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/state';

const TOAST_MS = 4000;
const ALERT_MS = 7000;
/** Suppress a repeated alert for the same subject within this window. */
const ALERT_COOLDOWN_MS = 10_000;

export interface Toasts {
  push(events: SimEvent[], state: GameState): void;
}

/**
 * Transient notices: command rejections (why an order failed), completions,
 * and — since M11 — under-attack ALERTS: red, clickable, and they jump the
 * camera to the trouble (plus a minimap ping). PLAYER-ONLY throughout.
 */
export function createToasts(
  el: HTMLElement,
  hooks?: { jumpTo?: (x: number, z: number) => void; ping?: (x: number, z: number) => void },
): Toasts {
  const show = (text: string, cls: 'bad' | 'good' | 'alert', onClick?: () => void) => {
    const div = document.createElement('div');
    div.className = `toast ${cls}`;
    div.textContent = text;
    if (onClick) {
      div.style.pointerEvents = 'auto';
      div.addEventListener('click', () => {
        onClick();
        div.remove();
      });
    }
    el.appendChild(div);
    setTimeout(() => div.remove(), cls === 'alert' ? ALERT_MS : TOAST_MS);
  };

  const recent = new Map<string, number>();
  const alert = (key: string, text: string, x: number, z: number) => {
    const now = performance.now();
    const last = recent.get(key);
    if (last !== undefined && now - last < ALERT_COOLDOWN_MS) return;
    recent.set(key, now);
    show(text, 'alert', () => hooks?.jumpTo?.(x, z));
    hooks?.ping?.(x, z);
  };

  return {
    push(events, state) {
      const siteOf = (id: number) => state.world.settlements[id];
      const mineSettlement = (id: number) => state.settlements[id]?.ownerRealm === 0;
      for (const e of events) {
        if (e.kind === 'commandRejected' && e.realm === 0) show(e.reason, 'bad');
        if (e.kind === 'buildingCompleted' && state.settlements[e.settlement]?.ownerRealm === 0) {
          show(`${BUILDINGS[e.building]?.name ?? e.building} completed`, 'good');
        }
        if (e.kind === 'researchCompleted' && e.realm === 0) {
          show(`${TECHS[e.tech]?.name ?? e.tech} researched`, 'good');
        }
        if (e.kind === 'ageAdvanced' && e.realm === 0) {
          show(`The realm enters ${AGES[e.age].name}!`, 'good');
        }

        // --- the war drums (M11): clickable, camera-jumping alerts ---
        if (e.kind === 'raidSpawned' && mineSettlement(e.settlement)) {
          const s = siteOf(e.settlement);
          alert(`raid:${e.settlement}`, `⚔ Raiders march on ${s.name}!`, s.x, s.z);
        }
        if (e.kind === 'siegeStarted' && mineSettlement(e.settlement)) {
          const s = siteOf(e.settlement);
          alert(`siege:${e.settlement}`, `⚔ ${s.name} is under siege!`, s.x, s.z);
        }
        if (e.kind === 'armiesEngaged') {
          const my = state.armies.find((x) => (x.id === e.a || x.id === e.b) && x.ownerRealm === 0);
          if (my) alert(`engaged:${my.id}`, '⚔ Your army is under attack!', my.x, my.z);
        }
        if (e.kind === 'settlementRaided' && mineSettlement(e.settlement)) {
          const s = siteOf(e.settlement);
          alert(`raided:${e.settlement}`, `⚔ ${s.name} has been plundered!`, s.x, s.z);
        }
        if (e.kind === 'dragonAwakened' && mineSettlement(e.settlement)) {
          const s = siteOf(e.settlement);
          alert(`dragon:${e.settlement}`, `🐉 A dragon descends upon ${s.name}!`, s.x, s.z);
        }
        if (e.kind === 'settlementCaptured' && e.from === 0) {
          const s = siteOf(e.settlement);
          alert(`fallen:${e.settlement}`, `⚔ ${s.name} has fallen!`, s.x, s.z);
        }
      }
    },
  };
}
