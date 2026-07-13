import { BUILDINGS } from '../content/buildings';
import type { UnitId } from '../content/schema';
import { UNITS } from '../content/units';
import { totalUnits } from '../sim/combat';
import type { Command } from '../sim/commands';
import type { GameState } from '../sim/state';

const TRAIN_BATCH = 5;

function costText(unit: UnitId): string {
  return Object.entries(UNITS[unit].cost)
    .map(([r, n]) => `${n} ${r}`)
    .join(', ');
}

export interface ArmyPanel {
  update(state: GameState): void;
}

/**
 * The war ministry: train from the garrison's settlement, form armies, and
 * send them at bandit camps. Every button is a command — nothing here touches
 * sim state directly.
 */
export function createArmyPanel(el: HTMLElement, enqueue: (cmd: Command) => void): ArmyPanel {
  el.innerHTML = `
    <div class="bm-head"><select id="ap-settlement"></select><span id="ap-count"></span></div>
    <div class="bm-section">Train (×${TRAIN_BATCH})</div>
    <div id="ap-train"></div>
    <div id="ap-queue" class="ap-queue"></div>
    <div class="bm-section">Garrison</div>
    <div id="ap-garrison"><i>empty</i></div>
    <button id="ap-form" class="ap-form">Form army from garrison</button>
    <div class="bm-section">Armies</div>
    <div id="ap-armies"><i>none</i></div>
  `;
  const select = el.querySelector('#ap-settlement') as HTMLSelectElement;
  const trainEl = el.querySelector('#ap-train') as HTMLElement;
  const queueEl = el.querySelector('#ap-queue') as HTMLElement;
  const garrisonEl = el.querySelector('#ap-garrison') as HTMLElement;
  const armiesEl = el.querySelector('#ap-armies') as HTMLElement;
  const formBtn = el.querySelector('#ap-form') as HTMLButtonElement;

  let selected = 0;
  select.addEventListener('change', () => {
    selected = Number(select.value);
  });

  const trainButtons = new Map<UnitId, { btn: HTMLButtonElement; sub: HTMLElement }>();
  for (const id of Object.keys(UNITS) as UnitId[]) {
    const b = document.createElement('button');
    b.className = 'bm-build';
    b.innerHTML = `<b>${UNITS[id].name}</b><span>${costText(id)}</span>`;
    b.addEventListener('click', () =>
      enqueue({ kind: 'trainUnits', settlement: selected, unit: id, count: TRAIN_BATCH }),
    );
    trainEl.appendChild(b);
    trainButtons.set(id, { btn: b, sub: b.querySelector('span') as HTMLElement });
  }

  formBtn.addEventListener('click', () => {
    formBtn.dataset.formAll = '1'; // resolved in update() where state is visible
  });

  let optionsBuilt = false;
  let lastSig = '';

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

      // deferred "form army from everything in the garrison"
      if (formBtn.dataset.formAll) {
        delete formBtn.dataset.formAll;
        if (totalUnits(s.garrison) > 0) {
          enqueue({ kind: 'formArmy', settlement: selected, units: { ...s.garrison } });
        }
      }

      // trainable set for this settlement (buildings present + unit gates via rejection)
      const trainableHere = new Set<string>();
      for (const [bid, count] of Object.entries(s.buildings)) {
        if ((count ?? 0) <= 0) continue;
        for (const fn of BUILDINGS[bid]?.functions ?? []) {
          if (fn.kind === 'training') for (const u of fn.units) trainableHere.add(u);
        }
      }
      for (const [id, ui] of trainButtons) {
        const usable = trainableHere.has(id);
        ui.btn.disabled = !usable;
        ui.btn.style.display = usable || trainableHere.size === 0 ? '' : 'none';
      }

      const sig = [
        s.trainQueue.map((q) => `${q.unit}:${q.remaining}:${q.progress | 0}`).join(','),
        JSON.stringify(s.garrison),
        state.armies.map((a) => `${a.id}:${a.phase}:${totalUnits(a.units)}`).join(','),
      ].join('|');
      if (sig === lastSig) return;
      lastSig = sig;

      queueEl.textContent = s.trainQueue.length
        ? `training: ${s.trainQueue.map((q) => `${q.remaining}× ${UNITS[q.unit]?.name ?? q.unit}`).join(', ')}`
        : '';

      const garrisonRows = Object.entries(s.garrison).filter(([, n]) => (n ?? 0) > 0);
      garrisonEl.innerHTML = garrisonRows.length ? '' : '<i>empty</i>';
      for (const [id, n] of garrisonRows) {
        const row = document.createElement('div');
        row.className = 'ap-row';
        row.textContent = `${UNITS[id]?.name ?? id} × ${n}`;
        garrisonEl.appendChild(row);
      }
      formBtn.disabled = garrisonRows.length === 0;

      armiesEl.innerHTML = state.armies.length ? '' : '<i>none</i>';
      for (const a of state.armies) {
        const row = document.createElement('div');
        row.className = 'ap-army';
        const label = document.createElement('span');
        label.textContent = `⚔ Army ${a.id} · ${totalUnits(a.units)} troops · ${a.phase}`;
        row.appendChild(label);
        if (a.phase === 'idle') {
          const campSel = document.createElement('select');
          for (const camp of state.camps) {
            if (camp.cleared) continue;
            const opt = document.createElement('option');
            opt.value = String(camp.id);
            opt.textContent = `Camp ${camp.id + 1} (${totalUnits(camp.defenders)} bandits)`;
            campSel.appendChild(opt);
          }
          const go = document.createElement('button');
          go.textContent = 'March';
          go.disabled = campSel.options.length === 0;
          go.addEventListener('click', () =>
            enqueue({
              kind: 'orderArmy',
              army: a.id,
              objective: { kind: 'attackCamp', camp: Number(campSel.value) },
            }),
          );
          const home = document.createElement('button');
          home.textContent = 'Disband';
          home.addEventListener('click', () =>
            enqueue({ kind: 'orderArmy', army: a.id, objective: { kind: 'returnHome' } }),
          );
          row.append(campSel, go, home);
        }
        armiesEl.appendChild(row);
      }
    },
  };
}
