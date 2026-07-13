import { BUILDINGS } from '../content/buildings';
import { CULTURES } from '../content/cultures';
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
export function createArmyPanel(
  el: HTMLElement,
  enqueue: (cmd: Command) => void,
  culture?: string,
): ArmyPanel {
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
    <div class="bm-section">Diplomacy</div>
    <div id="ap-diplomacy"></div>
  `;
  const select = el.querySelector('#ap-settlement') as HTMLSelectElement;
  const trainEl = el.querySelector('#ap-train') as HTMLElement;
  const queueEl = el.querySelector('#ap-queue') as HTMLElement;
  const garrisonEl = el.querySelector('#ap-garrison') as HTMLElement;
  const armiesEl = el.querySelector('#ap-armies') as HTMLElement;
  const diplomacyEl = el.querySelector('#ap-diplomacy') as HTMLElement;
  const formBtn = el.querySelector('#ap-form') as HTMLButtonElement;

  let selected = -1;
  select.addEventListener('change', () => {
    selected = Number(select.value);
  });

  const trainButtons = new Map<UnitId, { btn: HTMLButtonElement; sub: HTMLElement }>();
  for (const id of Object.keys(UNITS) as UnitId[]) {
    const def = UNITS[id];
    if (def.culture && def.culture !== culture) continue; // another people's pride
    if (def.tags.includes('monster')) continue; // the wilds train their own
    const b = document.createElement('button');
    b.className = 'bm-build';
    b.innerHTML = `<b>${def.name}</b><span>${costText(id)}</span>`;
    b.addEventListener('click', () =>
      enqueue({ kind: 'trainUnits', settlement: selected, unit: id, count: TRAIN_BATCH }),
    );
    trainEl.appendChild(b);
    trainButtons.set(id, { btn: b, sub: b.querySelector('span') as HTMLElement });
  }

  formBtn.addEventListener('click', () => {
    formBtn.dataset.formAll = '1'; // resolved in update() where state is visible
  });

  let lastOwnSig = '';
  let lastSig = '';

  return {
    update(state) {
      // the roster of OUR settlements — rebuilt when a capture changes it
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
        if (!mine.some((x) => x.id === selected)) selected = mine[0]?.id ?? -1;
        select.value = String(selected);
      }
      const s = state.settlements.find((x) => x.id === selected && x.ownerRealm === 0);
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
        state.realms[0].atWarWith.join(','),
        ownSig,
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

      const myArmies = state.armies.filter((a) => a.ownerRealm === 0);
      armiesEl.innerHTML = myArmies.length ? '' : '<i>none</i>';
      for (const a of myArmies) {
        const row = document.createElement('div');
        row.className = 'ap-army';
        const label = document.createElement('span');
        label.textContent = `⚔ Army ${a.id} · ${totalUnits(a.units)} troops · ${a.phase}`;
        row.appendChild(label);
        if (a.phase === 'idle') {
          const targetSel = document.createElement('select');
          for (const camp of state.camps) {
            if (camp.cleared) continue;
            const opt = document.createElement('option');
            opt.value = `camp:${camp.id}`;
            opt.textContent = `Camp ${camp.id + 1} (${totalUnits(camp.defenders)} bandits)`;
            targetSel.appendChild(opt);
          }
          // enemy settlements join the target list once the war is on
          for (const t of state.settlements) {
            if (t.ownerRealm === 0 || !state.realms[0].atWarWith.includes(t.ownerRealm)) continue;
            const site = state.world.settlements[t.id];
            const opt = document.createElement('option');
            opt.value = `settlement:${t.id}`;
            opt.textContent = `⚑ ${site.name} (${state.realms[t.ownerRealm]?.name ?? 'enemy'})`;
            targetSel.appendChild(opt);
          }
          const go = document.createElement('button');
          go.textContent = 'March';
          go.disabled = targetSel.options.length === 0;
          go.addEventListener('click', () => {
            const [kind, id] = targetSel.value.split(':');
            enqueue({
              kind: 'orderArmy',
              army: a.id,
              objective:
                kind === 'camp'
                  ? { kind: 'attackCamp', camp: Number(id) }
                  : { kind: 'attackSettlement', settlement: Number(id) },
            });
          });
          const home = document.createElement('button');
          home.textContent = 'Disband';
          home.addEventListener('click', () =>
            enqueue({ kind: 'orderArmy', army: a.id, objective: { kind: 'returnHome' } }),
          );
          row.append(targetSel, go, home);
        }
        armiesEl.appendChild(row);
      }

      diplomacyEl.innerHTML = '';
      for (const realm of state.realms) {
        if (realm.isPlayer) continue;
        const row = document.createElement('div');
        row.className = 'ap-army';
        const label = document.createElement('span');
        const atWar = state.realms[0].atWarWith.includes(realm.id);
        label.textContent = `${atWar ? '🔥' : '🕊'} ${realm.name} (${CULTURES[realm.culture ?? '']?.name ?? realm.culture}) — ${atWar ? 'at war' : 'at peace'}`;
        row.appendChild(label);
        if (!atWar) {
          const declare = document.createElement('button');
          declare.textContent = 'Declare war';
          declare.addEventListener('click', () => enqueue({ kind: 'declareWar', target: realm.id }));
          row.appendChild(declare);
        }
        diplomacyEl.appendChild(row);
      }
    },
  };
}
