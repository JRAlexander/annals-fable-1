import { AGES, ageIndex } from '../content/ages';
import { BUILDING_IDS, BUILDINGS } from '../content/buildings';
import { JOB_RESOURCE, VILLAGER_COST, VILLAGER_JOBS, type VillagerJob } from '../content/economy';
import type { BuildingId, ResourceId } from '../content/schema';
import { TECHS } from '../content/techs';
import { workplaceSlots } from '../sim/buildings';
import type { Command } from '../sim/commands';
import type { GameState } from '../sim/state';

const JOB_LABEL: Record<VillagerJob, string> = {
  farm: '🌾 Farms',
  wood: '🪵 Forest',
  stone: '⛰ Stone',
  gold: '🪙 Stalls',
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
export function createBuildMenu(
  el: HTMLElement,
  enqueue: (cmd: Command) => void,
  /** M7b: when provided, card clicks arm map placement instead of auto-queueing. */
  onPlace?: (building: BuildingId) => void,
): BuildMenu {
  el.innerHTML = `
    <div class="bm-head">
      <select id="bm-settlement"></select>
      <span id="bm-pop"></span>
    </div>
    <div class="bm-section">Construct <i class="bm-hint">click a card, then the map</i></div>
    <div id="bm-buildings"></div>
    <div class="bm-section">Building queue</div>
    <div id="bm-queue" class="bm-queue"><i>empty</i></div>
    <div class="bm-section">Villagers</div>
    <div id="bm-villagers"></div>
  `;
  const select = el.querySelector('#bm-settlement') as HTMLSelectElement;
  const popEl = el.querySelector('#bm-pop') as HTMLElement;
  const buildingsEl = el.querySelector('#bm-buildings') as HTMLElement;
  const queueEl = el.querySelector('#bm-queue') as HTMLElement;
  const villagersEl = el.querySelector('#bm-villagers') as HTMLElement;

  let selected = -1;
  select.addEventListener('change', () => {
    selected = Number(select.value);
  });

  // build buttons
  const buttons = new Map<string, { btn: HTMLButtonElement; sub: HTMLElement }>();
  for (const id of BUILDING_IDS) {
    const def = BUILDINGS[id];
    if (def.seedOnly) continue; // town centers are founded, never built
    const b = document.createElement('button');
    b.className = 'bm-build';
    b.innerHTML = `<b>${def.name}</b><span>${costText(def.cost)}</span>`;
    b.addEventListener('click', () => {
      if (onPlace)
        onPlace(id); // pick the ground on the map (M7b)
      else enqueue({ kind: 'queueBuilding', settlement: selected, building: id });
    });
    buildingsEl.appendChild(b);
    buttons.set(id, { btn: b, sub: b.querySelector('span') as HTMLElement });
  }

  // villager job rows (M12): counts + −/+ buttons, the sliders are history
  const trainBtn = document.createElement('button');
  trainBtn.className = 'bm-build';
  trainBtn.innerHTML = `<b>👤 Train villager</b><span>${costText(VILLAGER_COST)}</span>`;
  villagersEl.appendChild(trainBtn);
  const idleEl = document.createElement('div');
  idleEl.className = 'bm-qrow';
  villagersEl.appendChild(idleEl);
  const jobRows = new Map<
    VillagerJob,
    { minus: HTMLButtonElement; plus: HTMLButtonElement; label: HTMLElement }
  >();
  for (const job of VILLAGER_JOBS) {
    const row = document.createElement('div');
    row.className = 'bm-slider';
    row.innerHTML = `<label>${JOB_LABEL[job]}</label><button class="bm-step">−</button><span class="cap"></span><button class="bm-step">+</button>`;
    const [minus, plus] = row.querySelectorAll('button');
    villagersEl.appendChild(row);
    jobRows.set(job, {
      minus: minus as HTMLButtonElement,
      plus: plus as HTMLButtonElement,
      label: row.querySelector('.cap') as HTMLElement,
    });
  }
  const bump = (job: VillagerJob, d: number, state: GameState) => {
    const s = state.settlements.find((x) => x.id === selected && x.ownerRealm === 0);
    if (!s) return;
    enqueue({
      kind: 'assignVillagers',
      settlement: selected,
      job,
      count: Math.max(0, s.jobTargets[job] + d),
    });
  };
  let lastState: GameState | null = null;
  trainBtn.addEventListener('click', () => {
    enqueue({ kind: 'trainVillagers', settlement: selected, count: 1 });
  });
  for (const [job, ui] of jobRows) {
    ui.minus.addEventListener('click', () => lastState && bump(job, -1, lastState));
    ui.plus.addEventListener('click', () => lastState && bump(job, +1, lastState));
  }

  let lastOwnSig = '';
  let lastQueueSig = '';

  return {
    update(state) {
      // only OUR settlements are governable; the roster shifts with captures
      const mine = state.settlements.filter((x) => x.ownerRealm === 0);
      const ownSig = mine.map((x) => x.id).join(',');
      if (ownSig !== lastOwnSig) {
        lastOwnSig = ownSig;
        select.innerHTML = '';
        for (const x of mine) {
          const site = state.world.settlements[x.id];
          const opt = document.createElement('option');
          opt.value = String(x.id);
          opt.textContent = `${site.name} (${site.tier})`;
          select.appendChild(opt);
        }
        if (!mine.some((x) => x.id === selected)) {
          selected = mine[0]?.id ?? -1;
        }
        select.value = String(selected);
      }

      const s = state.settlements.find((x) => x.id === selected && x.ownerRealm === 0);
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

      lastState = state;
      const villagers = state.villagers.filter((v) => v.settlement === s.id);
      const idle = villagers.filter((v) => v.job === 'idle').length;
      const training = s.villagerQueue.remaining;
      idleEl.textContent = `${villagers.length} villagers · ${idle} idle${training ? ` · ${training} training` : ''}`;
      trainBtn.disabled =
        s.pop - 1 < 30 ||
        !Object.entries(VILLAGER_COST).every(([r, n]) => realm.stock[r as ResourceId] >= (n as number));
      for (const [job, ui] of jobRows) {
        const assigned = villagers.filter((v) => v.job === job).length;
        const cap = job === 'wood' || job === 'stone' ? null : workplaceSlots(s, JOB_RESOURCE[job]);
        ui.label.textContent = `${assigned}/${s.jobTargets[job]}${cap !== null ? ` (cap ${cap})` : ''}`;
        ui.plus.disabled = cap !== null && s.jobTargets[job] >= cap;
        ui.minus.disabled = s.jobTargets[job] <= 0;
      }
    },
  };
}
