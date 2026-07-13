import { AGE_ORDER, AGES, ageIndex, nextAge } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import type { Cost, Modifier, ResourceId, TechDef } from '../content/schema';
import { TECHS } from '../content/techs';
import type { Command } from '../sim/commands';
import type { GameState, Realm } from '../sim/state';

const RES_GLYPH: Record<ResourceId, string> = { food: '🌾', wood: '🪵', stone: '⛰', gold: '🪙' };

function costText(cost: Cost): string {
  const parts = Object.entries(cost).map(([r, n]) => `${n}${RES_GLYPH[r as ResourceId]}`);
  return parts.join(' ') || 'free';
}

const STAT_LABEL: Record<string, string> = {
  gatherRate: 'gathering',
  buildSpeed: 'build speed',
  researchSpeed: 'research speed',
  housingCap: 'housing',
  storageCap: 'storage',
  popGrowth: 'growth',
  wallHp: 'wall strength',
  unrest: 'unrest',
};

function effectText(effects: Modifier[]): string {
  return effects
    .map((m) => {
      const what = m.resource
        ? `${m.resource} ${STAT_LABEL[m.stat] ?? m.stat}`
        : (STAT_LABEL[m.stat] ?? m.stat);
      if (m.op === 'mul') {
        const pct = Math.round((m.value - 1) * 100);
        return `${pct >= 0 ? '+' : ''}${pct}% ${what}`;
      }
      return `${m.value >= 0 ? '+' : ''}${m.value} ${what}`;
    })
    .join(', ');
}

/** First unmet requirement, or null if researchable right now. */
function lockReason(state: GameState, realm: Realm, def: TechDef): string | null {
  if (ageIndex(def.age) > ageIndex(realm.age)) return `needs ${AGES[def.age].name}`;
  const missing = def.prereqs.find((p) => !realm.researchedTechs.includes(p));
  if (missing) return `needs ${TECHS[missing]?.name ?? missing}`;
  const hasBuilding = state.settlements.some(
    (s) => s.ownerRealm === realm.id && (s.buildings[def.researchedAt] ?? 0) > 0,
  );
  if (!hasBuilding) return `needs a ${BUILDINGS[def.researchedAt]?.name ?? def.researchedAt}`;
  if (realm.research) return 'research slot busy';
  const short = (Object.entries(def.cost) as [ResourceId, number][]).find(([r, n]) => realm.stock[r] < n);
  if (short) return `needs ${short[1]} ${short[0]}`;
  return null;
}

export interface TechMenu {
  update(state: GameState): void;
  toggle(): void;
}

/** The realm's book of knowledge: four age columns, one research slot, one Advance button. */
export function createTechMenu(el: HTMLElement, enqueue: (cmd: Command) => void, culture?: string): TechMenu {
  el.innerHTML = `
    <div class="tm-head">
      <span id="tm-age" class="tm-age"></span>
      <span id="tm-research"></span>
      <button id="tm-close">✕</button>
    </div>
    <div class="tm-advance">
      <span id="tm-adv-info"></span>
      <button id="tm-adv-btn">Advance</button>
    </div>
    <div class="tm-cols" id="tm-cols"></div>
  `;
  el.style.display = 'none';
  (el.querySelector('#tm-close') as HTMLElement).addEventListener('click', () => {
    el.style.display = 'none';
  });
  (el.querySelector('#tm-adv-btn') as HTMLElement).addEventListener('click', () =>
    enqueue({ kind: 'advanceAge' }),
  );

  const cols = el.querySelector('#tm-cols') as HTMLElement;
  const cards = new Map<
    string,
    { root: HTMLElement; btn: HTMLButtonElement; sub: HTMLElement; bar: HTMLElement }
  >();
  for (const age of AGE_ORDER) {
    const col = document.createElement('div');
    col.className = 'tm-col';
    col.innerHTML = `<div class="tm-colhead">${AGES[age].name}</div>`;
    // another culture's unique techs are not for us — they never appear
    const visible = Object.values(TECHS).filter(
      (t) => t.age === age && (!t.culture || t.culture === culture),
    );
    for (const def of visible) {
      const card = document.createElement('div');
      card.className = 'tm-card';
      card.innerHTML = `
        <button class="tm-research-btn"><b>${def.name}</b> <span class="cost">${costText(def.cost)}</span></button>
        <div class="fx">${effectText(def.effects)}</div>
        <div class="sub"></div>
        <div class="bar"><div></div></div>
      `;
      const btn = card.querySelector('button') as HTMLButtonElement;
      btn.addEventListener('click', () => enqueue({ kind: 'setResearch', tech: def.id }));
      col.appendChild(card);
      cards.set(def.id, {
        root: card,
        btn,
        sub: card.querySelector('.sub') as HTMLElement,
        bar: card.querySelector('.bar div') as HTMLElement,
      });
    }
    cols.appendChild(col);
  }

  const ageEl = el.querySelector('#tm-age') as HTMLElement;
  const researchEl = el.querySelector('#tm-research') as HTMLElement;
  const advInfo = el.querySelector('#tm-adv-info') as HTMLElement;
  const advBtn = el.querySelector('#tm-adv-btn') as HTMLButtonElement;

  const setText = (n: HTMLElement, t: string) => {
    if (n.textContent !== t) n.textContent = t;
  };

  return {
    toggle() {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    },
    update(state) {
      if (el.style.display === 'none') return;
      const realm = state.realms[0];
      setText(ageEl, AGES[realm.age].name);

      if (realm.research?.kind === 'tech') {
        const def = TECHS[realm.research.tech];
        const pct = def ? Math.floor((realm.research.progress / def.researchTime) * 100) : 0;
        setText(researchEl, `researching ${def?.name ?? '…'} — ${pct}%`);
      } else if (realm.research?.kind === 'age') {
        const target = nextAge(realm.age);
        const pct = target ? Math.floor((realm.research.progress / AGES[target].advanceTime) * 100) : 0;
        setText(researchEl, `advancing to ${target ? AGES[target].name : '…'} — ${pct}%`);
      } else {
        setText(researchEl, 'the scholars are idle');
      }

      const target = nextAge(realm.age);
      if (!target) {
        setText(advInfo, 'The realm stands in its final, golden age.');
        advBtn.style.display = 'none';
      } else {
        const targetDef = AGES[target];
        const types = new Set<string>();
        for (const s of state.settlements) {
          if (s.ownerRealm !== realm.id) continue;
          for (const [id, n] of Object.entries(s.buildings)) {
            if ((n ?? 0) > 0 && BUILDINGS[id]?.requiresAge === realm.age) types.add(id);
          }
        }
        const need = targetDef.requires.buildingsFromCurrentAge;
        setText(
          advInfo,
          `Advance to ${targetDef.name}: ${costText(targetDef.advanceCost)} · ${AGES[realm.age].name} buildings ${Math.min(types.size, need)}/${need}`,
        );
        advBtn.disabled = realm.research !== null || types.size < need;
      }

      for (const [id, ui] of cards) {
        const def = TECHS[id];
        const done = realm.researchedTechs.includes(id);
        const active = realm.research?.kind === 'tech' && realm.research.tech === id;
        const reason = done || active ? null : lockReason(state, realm, def);
        ui.root.classList.toggle('done', done);
        ui.root.classList.toggle('active', active);
        ui.root.classList.toggle('locked', !!reason);
        ui.btn.disabled = done || active || !!reason;
        setText(ui.sub, done ? '✓ researched' : active ? 'researching…' : (reason ?? 'ready'));
        ui.bar.style.width = active
          ? `${Math.floor(((realm.research as { progress: number }).progress / def.researchTime) * 100)}%`
          : done
            ? '100%'
            : '0%';
      }
    },
  };
}
