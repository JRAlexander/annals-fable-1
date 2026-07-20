import { AGES, ageIndex } from '../content/ages';
import { BUILDING_IDS, BUILDINGS } from '../content/buildings';
import { RESOURCE_VALUE } from '../content/diplomacy';
import { JOB_RESOURCE, VILLAGER_COST, VILLAGER_JOBS, type VillagerJob } from '../content/economy';
import type { BuildingId, ResourceId } from '../content/schema';
import { TECHS } from '../content/techs';
import { FOREIGN_TRADE_BONUS, TRADE_SPREAD } from '../content/trade';
import { workplaceSlots } from '../sim/buildings';
import type { Command } from '../sim/commands';
import { findPath } from '../sim/pathfind';
import type { GameState } from '../sim/state';
import { routeGold } from '../sim/systems/caravans';

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
    <div class="bm-section" id="bm-trade-head">Trade <i class="bm-hint">the market deals in gold</i></div>
    <div id="bm-trade"></div>
  `;
  const select = el.querySelector('#bm-settlement') as HTMLSelectElement;
  const popEl = el.querySelector('#bm-pop') as HTMLElement;
  const buildingsEl = el.querySelector('#bm-buildings') as HTMLElement;
  const queueEl = el.querySelector('#bm-queue') as HTMLElement;
  const villagersEl = el.querySelector('#bm-villagers') as HTMLElement;
  const tradeHeadEl = el.querySelector('#bm-trade-head') as HTMLElement;
  const tradeEl = el.querySelector('#bm-trade') as HTMLElement;

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

  // governor (M13b): hand this town's villager economy to the AI's book
  const governorRow = document.createElement('label');
  governorRow.className = 'bm-qrow bm-governor';
  governorRow.innerHTML = `<input type="checkbox" id="bm-governor" /> 🏛 Governor <i class="bm-hint">runs villagers for you</i>`;
  villagersEl.appendChild(governorRow);
  const governorBox = governorRow.querySelector('input') as HTMLInputElement;
  governorBox.addEventListener('change', () => {
    enqueue({ kind: 'setGovernor', settlement: selected, enabled: governorBox.checked });
  });

  // steward (M14b): the town also queues buildings & research by the book.
  // Construct cards stay live — the steward only acts on an empty queue, so
  // anything the player queues simply pre-empts it.
  const stewardRow = document.createElement('label');
  stewardRow.className = 'bm-qrow bm-governor';
  stewardRow.innerHTML = `<input type="checkbox" id="bm-steward" /> ⚖ Steward <i class="bm-hint">queues buildings &amp; research</i>`;
  villagersEl.appendChild(stewardRow);
  const stewardBox = stewardRow.querySelector('input') as HTMLInputElement;
  stewardBox.addEventListener('change', () => {
    enqueue({ kind: 'setSteward', settlement: selected, enabled: stewardBox.checked });
  });

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

  // --- trade (M17b): exchange rows, a caravan route select, a status line ---
  // Exchange rates are fixed content (RESOURCE_VALUE ± spread), so the row
  // labels are computed ONCE; only disabled-ness tracks the live stock.
  const TRADE_LOT = 100;
  const sellGets = (res: ResourceId) =>
    Math.floor(((TRADE_LOT * RESOURCE_VALUE[res]) / RESOURCE_VALUE.gold) * (1 - TRADE_SPREAD));
  const buyGets = (res: ResourceId) =>
    Math.floor(((TRADE_LOT * RESOURCE_VALUE.gold) / RESOURCE_VALUE[res]) * (1 - TRADE_SPREAD));
  const exchangeRows = new Map<ResourceId, { sell: HTMLButtonElement; buy: HTMLButtonElement }>();
  for (const res of ['food', 'wood', 'stone'] as ResourceId[]) {
    const row = document.createElement('div');
    row.className = 'bm-qrow';
    const sell = document.createElement('button');
    sell.className = 'bm-step bm-trade-btn';
    sell.textContent = `sell ${TRADE_LOT} ${res} → ${sellGets(res)}g`;
    sell.addEventListener('click', () =>
      enqueue({ kind: 'marketTrade', give: res, get: 'gold', amount: TRADE_LOT }),
    );
    const buy = document.createElement('button');
    buy.className = 'bm-step bm-trade-btn';
    buy.textContent = `${TRADE_LOT}g → ${buyGets(res)} ${res}`;
    buy.addEventListener('click', () =>
      enqueue({ kind: 'marketTrade', give: 'gold', get: res, amount: TRADE_LOT }),
    );
    row.append(sell, buy);
    tradeEl.appendChild(row);
    exchangeRows.set(res, { sell, buy });
  }
  const routeSel = document.createElement('select');
  routeSel.title = 'Caravans run to this town and back, minting gold by the mile';
  routeSel.addEventListener('change', () => {
    enqueue({
      kind: 'setTradeRoute',
      settlement: selected,
      target: routeSel.value === '' ? null : Number(routeSel.value),
    });
  });
  tradeEl.appendChild(routeSel);
  const tradeStatusEl = document.createElement('div');
  tradeStatusEl.className = 'bm-qrow';
  tradeEl.appendChild(tradeStatusEl);
  // route lengths never change (the world is static) — cache per pair
  const routeCells = new Map<string, number>();
  const cellsBetween = (state: GameState, a: number, b: number): number => {
    const key = `${a}:${b}`;
    let cells = routeCells.get(key);
    if (cells === undefined) {
      const sa = state.world.settlements[a];
      const sb = state.world.settlements[b];
      cells = findPath(state.world, sa.i, sa.j, sb.i, sb.j).length - 1;
      routeCells.set(key, cells);
    }
    return cells;
  };

  let lastOwnSig = '';
  let lastQueueSig = '';
  let lastTradeSig = '';

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
      if (governorBox.checked !== s.governor) governorBox.checked = s.governor;
      if (stewardBox.checked !== s.steward) stewardBox.checked = s.steward;
      governorRow.title = s.governor ? 'the governor manages this town’s villagers' : '';
      const villagers = state.villagers.filter((v) => v.settlement === s.id);
      const idle = villagers.filter((v) => v.job === 'idle').length;
      const training = s.villagerQueue.remaining;
      idleEl.textContent = `${villagers.length} villagers · ${idle} idle${training ? ` · ${training} training` : ''}`;
      trainBtn.disabled =
        s.governor ||
        s.pop - 1 < 30 ||
        !Object.entries(VILLAGER_COST).every(([r, n]) => realm.stock[r as ResourceId] >= (n as number));
      for (const [job, ui] of jobRows) {
        const assigned = villagers.filter((v) => v.job === job).length;
        const cap = job === 'wood' || job === 'stone' ? null : workplaceSlots(s, JOB_RESOURCE[job]);
        ui.label.textContent = `${assigned}/${s.jobTargets[job]}${cap !== null ? ` (cap ${cap})` : ''}`;
        ui.plus.disabled = s.governor || (cap !== null && s.jobTargets[job] >= cap);
        ui.minus.disabled = s.governor || s.jobTargets[job] <= 0;
      }

      // --- trade (M17b) ---
      const realmTrades = state.settlements.some(
        (x) => x.ownerRealm === 0 && (x.buildings.market ?? 0) + (x.buildings.guildhall ?? 0) > 0,
      );
      const show = realmTrades ? '' : 'none';
      if (tradeHeadEl.style.display !== show) {
        tradeHeadEl.style.display = show;
        tradeEl.style.display = show;
      }
      if (realmTrades) {
        // exchange buttons: labels are fixed, only affordability moves
        for (const [res, ui] of exchangeRows) {
          ui.sell.disabled = realm.stock[res] < TRADE_LOT;
          ui.buy.disabled = realm.stock.gold < TRADE_LOT;
        }
        const marketsHere = (s.buildings.market ?? 0) + (s.buildings.guildhall ?? 0);
        // rebuild the route options only when the world of choices moves —
        // NOT on gold ticks, so an open dropdown is never yanked shut
        const tradeSig = [
          selected,
          marketsHere,
          JSON.stringify(s.trade ?? null),
          state.realms[0].atWarWith.join('.'),
          state.settlements.map((t) => t.ownerRealm).join(''),
        ].join('|');
        if (tradeSig !== lastTradeSig) {
          lastTradeSig = tradeSig;
          routeSel.innerHTML = '';
          const none = document.createElement('option');
          none.value = '';
          none.textContent = marketsHere > 0 ? '🛒 no caravan route' : '🛒 route needs a market here';
          routeSel.appendChild(none);
          if (marketsHere > 0) {
            for (const t of state.settlements) {
              if (t.id === s.id || state.realms[0].atWarWith.includes(t.ownerRealm)) continue;
              const site = state.world.settlements[t.id];
              const foreign = t.ownerRealm !== 0;
              const per = Math.floor(
                routeGold(cellsBetween(state, s.id, t.id)) * (foreign ? FOREIGN_TRADE_BONUS : 1),
              );
              const opt = document.createElement('option');
              opt.value = String(t.id);
              opt.textContent = `🛒 ${site.name}${foreign ? ` (${state.realms[t.ownerRealm]?.name ?? '?'})` : ''} · ~${per}g/trip`;
              routeSel.appendChild(opt);
            }
          }
          routeSel.disabled = marketsHere <= 0;
          routeSel.value = s.trade ? String(s.trade.target) : '';
        }
        const carts = state.caravans.filter((c) => c.home === s.id).length;
        const status = s.trade
          ? `🛒 ${carts} cart${carts === 1 ? '' : 's'} · ${s.trade.trips} trip${s.trade.trips === 1 ? '' : 's'}${s.trade.lastGold ? ` · last ${s.trade.lastGold}g` : ''}`
          : marketsHere > 0
            ? '🛒 the road awaits a route'
            : '';
        if (tradeStatusEl.textContent !== status) tradeStatusEl.textContent = status;
      }
    },
  };
}
