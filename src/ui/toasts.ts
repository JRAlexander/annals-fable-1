import { AGES } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import { TECHS } from '../content/techs';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/state';

const TOAST_MS = 4000;

export interface Toasts {
  push(events: SimEvent[], state: GameState): void;
}

/**
 * Transient notices: command rejections (why an order failed) and completions.
 * PLAYER-ONLY — AI realms issue commands through the same queue, and their
 * rejections and completions are none of our business.
 */
export function createToasts(el: HTMLElement): Toasts {
  const show = (text: string, cls: 'bad' | 'good') => {
    const div = document.createElement('div');
    div.className = `toast ${cls}`;
    div.textContent = text;
    el.appendChild(div);
    setTimeout(() => div.remove(), TOAST_MS);
  };
  return {
    push(events, state) {
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
      }
    },
  };
}
