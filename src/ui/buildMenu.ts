import { AGES, ageIndex } from '../content/ages';
import { BUILDING_IDS, BUILDINGS } from '../content/buildings';
import { JOB_RESOURCE, WORK_JOBS, type WorkJob } from '../content/economy';
import type { ResourceId } from '../content/schema';
import { TECHS } from '../content/techs';
import { jobCapacity } from '../sim/buildings';
import type { Command } from '../sim/commands';
import type { GameState } from '../sim/state';

const JOB_LABEL: Record<WorkJob, string> = {
  farm: '🌾 Farm',
  forest: '🪵 Forest',
  quarry: '⛰ Quarry',
  trade: '🪙 Trade',
};

function costText(cost: Partial<Record<ResourceId, number>>): string {
  return Object.entries(cost)
    .map(([r, n]) => `${n} ${r}`)
    .join(', ');
}

export interface BuildMenu {
  update(state: GameState): void;
}

/**
 * The ruler's panel: pick a settlement, queue buildings, steer worker
 * allocation. All input funnels into enqueue() — the command queue is the
 * only path into the sim.
 */
export function createBuildMenu(el: HTMLElement, enqueue: (cmd: Command) => void): BuildMenu {
  el.innerHTML = `
    <div class="bm-head">
      <select id="bm-settlement"></select>
      <span id="bm-pop"></span>
    </div>
    <div class="bm-section">Construct</div>
    <div id="bm-buildings"></div>
    <div class="bm-section">Building queue</div>
    <div id="bm-queue" class="bm-queue"><i>empty</i></div>
    <div class="bm-section">Workers</div>
    <div id="bm-alloc"></div>
  `;
  const select = el.querySelector('#bm-settlement') as HTMLSelectElement;
  const popEl = el.querySelector('#bm-pop') as HTMLElement;
  const buildingsEl = el.querySelector('#bm-buildings') as HTMLElement;
  const queueEl = el.querySelector('#bm-queue') as HTMLElement;
  const allocEl = el.querySelector('#bm-alloc') as HTMLElement;

  let selected = 0;
  select.addEventListener('change', () => {
    selected = Number(select.value);
    syncSliders = true;
  });

  // build buttons
  const buttons = new Map<string, { btn: HTMLButtonElement; sub: HTMLElement }>();
  for (const id of BUILDING_IDS) {
    const def = BUILDINGS[id];
    const b = document.createElement('button');
    b.className = 'bm-build';
    b.innerHTML = `<b>${def.name}</b><span>${costText(def.cost)}</span>`;
    b.addEventListener('click', () => enqueue({ kind: 'queueBuilding', settlement: selected, building: id }));
    buildingsEl.appendChild(b);
    buttons.set(id, { btn: b, sub: b.querySelector('span') as HTMLElement });
  }

  // allocation sliders
  const sliders = new Map<WorkJob, { input: HTMLInputElement; cap: HTMLElement }>();
  let syncSliders = true; // pull values from state on next update (after settlement switch)
  let dragging = false;
  for (const job of WORK_JOBS) {
    const row = document.createElement('div');
    row.className = 'bm-slider';
    row.innerHTML = `<label>${JOB_LABEL[job]}</label><input type="range" min="0" max="100" step="1"><span class="cap"></span>`;
    const input = row.querySelector('input') as HTMLInputElement;
    input.addEventListener('pointerdown', () => {
      dragging = true;
    });
    input.addEventListener('change', () => {
      dragging = false;
      const alloc: Partial<Record<WorkJob, number>> = {};
      for (const [j, s] of sliders) alloc[j] = Number(s.input.value);
      enqueue({ kind: 'setWorkerAllocation', settlement: selected, alloc });
    });
    allocEl.appendChild(row);
    sliders.set(job, { input, cap: row.querySelector('.cap') as HTMLElement });
  }

  let optionsBuilt = false;
  let lastQueueSig = '';

  return {
    update(state) {
      if (!optionsBuilt) {
        for (const s of state.settlements) {
          const site = state.world.settlements[s.id];
          const opt = document.createElement('option');
          opt.value = String(s.id);
          opt.textContent = `${site.name} (${site.tier})`;
          select.appendChild(opt);
        }
        optionsBuilt = true;
      }

      const s = state.settlements[selected];
      if (!s) return;
      const realm = state.realms[0];
      popEl.textContent = `👥 ${Math.floor(s.pop)}/${Math.round(s.popCap)}`;

      for (const id of BUILDING_IDS) {
        const def = BUILDINGS[id];
        const ui = buttons.get(id);
        if (!ui) continue;
        // first unmet gate wins: age, then tech, then cost
        let reason: string | null = null;
        if (ageIndex(def.requiresAge) > ageIndex(realm.age)) reason = `needs ${AGES[def.requiresAge].name}`;
        else {
          const missingTech = (def.requiresTechs ?? []).find((t) => !realm.researchedTechs.includes(t));
          if (missingTech) reason = `needs ${TECHS[missingTech]?.name ?? missingTech}`;
          else if (!Object.entries(def.cost).every(([r, n]) => realm.stock[r as ResourceId] >= (n as number)))
            reason = 'cannot afford';
        }
        ui.btn.disabled = !!reason;
        const sub = reason && reason !== 'cannot afford' ? reason : costText(def.cost);
        if (ui.sub.textContent !== sub) ui.sub.textContent = sub;
      }

      const sig = s.buildQueue.map((q) => `${q.building}:${q.progress | 0}`).join(',');
      if (sig !== lastQueueSig) {
        lastQueueSig = sig;
        queueEl.innerHTML = s.buildQueue.length ? '' : '<i>empty</i>';
        s.buildQueue.forEach((q, i) => {
          const def = BUILDINGS[q.building];
          const pct = def ? Math.min(100, Math.floor((q.progress / def.buildTime) * 100)) : 0;
          const row = document.createElement('div');
          row.className = 'bm-qrow';
          row.innerHTML = `<span>${def?.name ?? q.building}</span><div class="bar"><div style="width:${i === 0 ? pct : 0}%"></div></div>`;
          queueEl.appendChild(row);
        });
      }

      const total = WORK_JOBS.reduce((t, j) => t + s.alloc[j], 0) || 1;
      for (const [job, ui] of sliders) {
        if (syncSliders && !dragging) ui.input.value = String(Math.round((s.alloc[job] / total) * 100));
        const workers = Math.floor(s.pop * s.workRatio);
        const want = Math.floor((workers * s.alloc[job]) / total);
        const cap = jobCapacity(s, job);
        ui.cap.textContent = `${Math.min(want, cap)}/${cap} → ${JOB_RESOURCE[job]}`;
      }
      syncSliders = false;
    },
  };
}
