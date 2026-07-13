import type { SimEvent } from '../sim/events';
import { dateOf } from '../sim/time';

const MAX_ENTRIES = 200;

export interface ChroniclePanel {
  push(events: SimEvent[]): void;
}

/** Scrolling annalist log. Sticks to the bottom unless the user scrolled up. */
export function createChronicle(el: HTMLElement): ChroniclePanel {
  return {
    push(events) {
      let added = false;
      for (const e of events) {
        if (e.kind !== 'chronicle') continue;
        const d = dateOf(e.tick);
        const div = document.createElement('div');
        div.className = `entry tone-${e.tone}`;
        div.textContent = `Y${d.year}·D${d.dayOfYear}  ${e.text}`;
        el.appendChild(div);
        added = true;
      }
      if (!added) return;
      while (el.childNodes.length > MAX_ENTRIES) el.removeChild(el.firstChild as Node);
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    },
  };
}
