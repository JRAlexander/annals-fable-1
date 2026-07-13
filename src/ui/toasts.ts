import { AGES } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import { TECHS } from '../content/techs';
import type { SimEvent } from '../sim/events';

const TOAST_MS = 4000;

export interface Toasts {
  push(events: SimEvent[]): void;
}

/** Transient notices: command rejections (why an order failed) and completions. */
export function createToasts(el: HTMLElement): Toasts {
  const show = (text: string, cls: 'bad' | 'good') => {
    const div = document.createElement('div');
    div.className = `toast ${cls}`;
    div.textContent = text;
    el.appendChild(div);
    setTimeout(() => div.remove(), TOAST_MS);
  };
  return {
    push(events) {
      for (const e of events) {
        if (e.kind === 'commandRejected') show(e.reason, 'bad');
        if (e.kind === 'buildingCompleted') {
          show(`${BUILDINGS[e.building]?.name ?? e.building} completed`, 'good');
        }
        if (e.kind === 'researchCompleted') {
          show(`${TECHS[e.tech]?.name ?? e.tech} researched`, 'good');
        }
        if (e.kind === 'ageAdvanced') {
          show(`The realm enters ${AGES[e.age].name}!`, 'good');
        }
      }
    },
  };
}
