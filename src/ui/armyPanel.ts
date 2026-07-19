import { BUILDINGS } from '../content/buildings';
import { CULTURES } from '../content/cultures';
import { TRIBUTE_FRACTION } from '../content/diplomacy';
import { MARSHAL_ATTACK_RATIO } from '../content/rts';
import type { Cost, ResourceId, UnitId } from '../content/schema';
import { UNITS } from '../content/units';
import { campThreat, power, totalUnits } from '../sim/combat';
import type { Command } from '../sim/commands';
import { acceptsPeace, type Tribute } from '../sim/diplomacy';
import type { ArmyStance, GameState, Realm } from '../sim/state';
import { TICKS_PER_DAY } from '../sim/time';

const TRAIN_BATCH = 5;

/** A quarter of a treasury, floored, zeros omitted — the UI's tribute preset. */
function quarterOf(stock: Realm['stock']): Cost {
  const cost: Cost = {};
  for (const [res, amt] of Object.entries(stock) as [ResourceId, number][]) {
    const share = Math.floor((amt ?? 0) * TRIBUTE_FRACTION);
    if (share > 0) cost[res] = share;
  }
  return cost;
}

const STANCE_LABEL: Record<ArmyStance, string> = {
  defensive: '🛡 Defensive',
  aggressive: '⚔ Aggressive',
  standGround: '⚓ Stand ground',
};

/** App-layer hooks (M13b): rally-flag picking and the auto-explore roster. */
export interface ArmyPanelHooks {
  rallyPick(settlement: number): void;
  explore: { toggle(id: number): boolean; has(id: number): boolean };
}

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
  hooks?: ArmyPanelHooks,
): ArmyPanel {
  el.innerHTML = `
    <div class="bm-head"><select id="ap-settlement"></select><span id="ap-count"></span></div>
    <div class="bm-section">Train (×${TRAIN_BATCH})</div>
    <div id="ap-train"></div>
    <div id="ap-queue" class="ap-queue"></div>
    <div class="bm-section">Garrison</div>
    <div id="ap-garrison"><i>empty</i></div>
    <button id="ap-form" class="ap-form">Form army from garrison</button>
    <div class="bm-section">Rally <i class="bm-hint">where fresh troops go</i></div>
    <div id="ap-rally"></div>
    <div class="bm-section">Armies</div>
    <label id="ap-marshal-row" class="bm-governor"><input type="checkbox" id="ap-marshal" /> ⚜ Marshal <i class="bm-hint">runs the realm's defense for you</i></label>
    <div id="ap-armies"><i>none</i></div>
    <div class="bm-section">Diplomacy</div>
    <div id="ap-diplomacy"></div>
  `;
  const select = el.querySelector('#ap-settlement') as HTMLSelectElement;
  const trainEl = el.querySelector('#ap-train') as HTMLElement;
  const queueEl = el.querySelector('#ap-queue') as HTMLElement;
  const garrisonEl = el.querySelector('#ap-garrison') as HTMLElement;
  const armiesEl = el.querySelector('#ap-armies') as HTMLElement;
  const rallyEl = el.querySelector('#ap-rally') as HTMLElement;
  const diplomacyEl = el.querySelector('#ap-diplomacy') as HTMLElement;
  const formBtn = el.querySelector('#ap-form') as HTMLButtonElement;
  const marshalBox = el.querySelector('#ap-marshal') as HTMLInputElement;
  marshalBox.addEventListener('change', () => {
    enqueue({ kind: 'setMarshal', enabled: marshalBox.checked });
  });

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
        state.armies
          .map(
            (a) =>
              `${a.id}:${a.phase}:${totalUnits(a.units)}:${a.stance}:${hooks?.explore.has(a.id) ? 1 : 0}:${a.marshal ? 1 : 0}`,
          )
          .join(','),
        state.realms[0].atWarWith.join(','),
        ownSig,
        JSON.stringify(s.rally ?? null),
        state.realms[0].marshal ? 'M' : '',
        state.camps.map((c) => (c.cleared ? '' : totalUnits(c.defenders))).join(','),
        // diplomacy (M15b): every realm's wars + truces, and the day itself —
        // truce countdowns must repaint as the seasons pass
        state.realms.map((r) => `${r.id}:${r.atWarWith.join('.')}:${JSON.stringify(r.truceUntil)}`).join(';'),
        Math.floor(state.tick / TICKS_PER_DAY),
      ].join('|');
      if (sig === lastSig) return;
      lastSig = sig;

      if (marshalBox.checked !== state.realms[0].marshal) marshalBox.checked = state.realms[0].marshal;

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

      // rally (M13b): garrison (default) | reinforce a field army | a map flag
      rallyEl.innerHTML = '';
      const rallySel = document.createElement('select');
      const addOpt = (value: string, text: string) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        rallySel.appendChild(opt);
      };
      addOpt('garrison', '🏰 Garrison (hold at home)');
      for (const a of myArmies.filter((x) => !x.defending)) {
        addOpt(`army:${a.id}`, `⚔ Reinforce Army ${a.id} (${totalUnits(a.units)} troops)`);
      }
      if (s.rally?.kind === 'point') addOpt('flag-current', `📍 Flag at (${s.rally.i}, ${s.rally.j})`);
      if (hooks) addOpt('flag-new', '📍 Place rally flag — click the map');
      rallySel.value =
        s.rally === undefined
          ? 'garrison'
          : s.rally.kind === 'army'
            ? `army:${s.rally.army}`
            : 'flag-current';
      rallySel.addEventListener('change', () => {
        const v = rallySel.value;
        if (v === 'garrison') enqueue({ kind: 'setRally', settlement: s.id, rally: null });
        else if (v === 'flag-new') hooks?.rallyPick(s.id);
        else if (v.startsWith('army:'))
          enqueue({ kind: 'setRally', settlement: s.id, rally: { kind: 'army', army: Number(v.slice(5)) } });
      });
      rallyEl.appendChild(rallySel);
      armiesEl.innerHTML = myArmies.length ? '' : '<i>none</i>';
      for (const a of myArmies) {
        const row = document.createElement('div');
        row.className = 'ap-army';
        const label = document.createElement('span');
        // marshal armies wear the badge and show strength against their muster (M14b)
        label.textContent = `${a.marshal ? '⚜' : '⚔'} Army ${a.id} · ${totalUnits(a.units)}/${a.muster} troops · ${a.phase}`;
        row.appendChild(label);
        // stance (M13b): how the army occupies itself when idle
        const stanceSel = document.createElement('select');
        stanceSel.title = 'Stance: what this army does on its own';
        for (const [value, text] of Object.entries(STANCE_LABEL)) {
          const opt = document.createElement('option');
          opt.value = value;
          opt.textContent = text;
          stanceSel.appendChild(opt);
        }
        stanceSel.value = a.stance;
        stanceSel.addEventListener('change', () =>
          enqueue({ kind: 'setStance', army: a.id, stance: stanceSel.value as ArmyStance }),
        );
        row.appendChild(stanceSel);
        if (hooks && !a.marshal) {
          // marshal armies get no Explore toggle — the autopilot stations them
          const exploreBtn = document.createElement('button');
          const on = hooks.explore.has(a.id);
          exploreBtn.textContent = on ? '⌖ Exploring…' : '⌖ Explore';
          exploreBtn.title = 'Auto-explore: march to unexplored ground whenever idle';
          exploreBtn.classList.toggle('ap-explore-on', on);
          exploreBtn.addEventListener('click', () => hooks.explore.toggle(a.id));
          row.appendChild(exploreBtn);
        }
        if (a.phase === 'idle') {
          const targetSel = document.createElement('select');
          // the marshal's own arithmetic doubles as advice: ✓ = this army wins
          const myPower = power(state, 0, a.units);
          const hasRam = (a.units.ram ?? 0) > 0;
          for (const camp of state.camps) {
            if (camp.cleared) continue;
            const winnable = myPower >= MARSHAL_ATTACK_RATIO * campThreat(state, camp.id, hasRam);
            const opt = document.createElement('option');
            opt.value = `camp:${camp.id}`;
            opt.textContent = `Camp ${camp.id + 1} (${totalUnits(camp.defenders)} bandits)${winnable ? ' ✓' : ''}`;
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
      const today = Math.floor(state.tick / TICKS_PER_DAY);
      for (const realm of state.realms) {
        if (realm.isPlayer) continue;
        const row = document.createElement('div');
        row.className = 'ap-army';
        const label = document.createElement('span');
        const atWar = state.realms[0].atWarWith.includes(realm.id);
        const truceLeft = (state.realms[0].truceUntil[realm.id] ?? 0) - today;
        const standing = atWar ? 'at war' : truceLeft > 0 ? `truce, ${truceLeft} days` : 'at peace';
        label.textContent = `${atWar ? '🔥' : truceLeft > 0 ? '🤝' : '🕊'} ${realm.name} (${CULTURES[realm.culture ?? '']?.name ?? realm.culture}) — ${standing}`;
        row.appendChild(label);
        if (atWar) {
          // sue for peace (M15b): three presets, judged live by the same
          // arithmetic the realm itself will use
          const termsSel = document.createElement('select');
          for (const [value, text] of [
            ['white', '🕊 White peace'],
            ['offer', `🎁 Offer tribute (${Math.round(TRIBUTE_FRACTION * 100)}% of your stock)`],
            ['demand', `💰 Demand tribute (${Math.round(TRIBUTE_FRACTION * 100)}% of theirs)`],
          ]) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            termsSel.appendChild(opt);
          }
          const sue = document.createElement('button');
          const termsOf = (): Tribute =>
            termsSel.value === 'offer'
              ? { give: quarterOf(state.realms[0].stock) }
              : termsSel.value === 'demand'
                ? { demand: quarterOf(realm.stock) }
                : {};
          const refreshHint = () => {
            const willAccept = acceptsPeace(state, realm, state.realms[0], termsOf());
            sue.textContent = `Sue for peace ${willAccept ? '✓ they will accept' : '✗ they will refuse'}`;
          };
          refreshHint();
          termsSel.addEventListener('change', refreshHint);
          sue.addEventListener('click', () =>
            enqueue({ kind: 'offerPeace', target: realm.id, tribute: termsOf() }),
          );
          row.append(termsSel, sue);
        } else if (truceLeft > 0) {
          const declare = document.createElement('button');
          declare.textContent = 'Declare war';
          declare.disabled = true;
          declare.title = `the truce holds for ${truceLeft} more days`;
          row.appendChild(declare);
        } else {
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
