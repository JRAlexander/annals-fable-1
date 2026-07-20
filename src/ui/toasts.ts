import { AGES } from '../content/ages';
import { BUILDINGS } from '../content/buildings';
import { TECHS } from '../content/techs';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/state';

const TOAST_MS = 4000;
const ALERT_MS = 7000;
/** Suppress a repeated alert for the same subject within this window. */
const ALERT_COOLDOWN_MS = 10_000;

export interface Toasts {
  push(events: SimEvent[], state: GameState): void;
}

/**
 * Transient notices: command rejections (why an order failed), completions,
 * and — since M11 — under-attack ALERTS: red, clickable, and they jump the
 * camera to the trouble (plus a minimap ping). PLAYER-ONLY throughout.
 */
export function createToasts(
  el: HTMLElement,
  hooks?: { jumpTo?: (x: number, z: number) => void; ping?: (x: number, z: number) => void },
): Toasts {
  const show = (text: string, cls: 'bad' | 'good' | 'alert', onClick?: () => void) => {
    const div = document.createElement('div');
    div.className = `toast ${cls}`;
    div.textContent = text;
    if (onClick) {
      div.style.pointerEvents = 'auto';
      div.addEventListener('click', () => {
        onClick();
        div.remove();
      });
    }
    el.appendChild(div);
    setTimeout(() => div.remove(), cls === 'alert' ? ALERT_MS : TOAST_MS);
  };

  const recent = new Map<string, number>();
  const alert = (key: string, text: string, x: number, z: number) => {
    const now = performance.now();
    const last = recent.get(key);
    if (last !== undefined && now - last < ALERT_COOLDOWN_MS) return;
    recent.set(key, now);
    show(text, 'alert', () => hooks?.jumpTo?.(x, z));
    hooks?.ping?.(x, z);
  };

  return {
    push(events, state) {
      const siteOf = (id: number) => state.world.settlements[id];
      const mineSettlement = (id: number) => state.settlements[id]?.ownerRealm === 0;
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

        // --- diplomacy (M15b): treaties, declarations, and pacts ---
        if (e.kind === 'peaceMade' && (e.realm === 0 || e.target === 0)) {
          const other = state.realms[e.realm === 0 ? e.target : e.realm];
          const gained = e.realm === 0 ? e.demanded : e.gave; // what flows TO the player
          const gainedText = Object.entries(gained)
            .map(([res, amt]) => `${amt} ${res}`)
            .join(', ');
          show(
            `🤝 Peace with ${other.name}${gainedText ? ` — they pay tribute: ${gainedText}` : ''}`,
            'good',
          );
        }
        if (e.kind === 'warDeclared' && e.target === 0) {
          const seat = siteOf(state.realms[e.realm].capital);
          alert(`war:${e.realm}`, `⚔ ${state.realms[e.realm].name} declares war on you!`, seat.x, seat.z);
        }
        if (e.kind === 'coalitionFormed' && e.against === 0) {
          for (const member of e.members) {
            const seat = siteOf(state.realms[member].capital);
            alert(
              `pact:${member}`,
              `⚔ ${state.realms[member].name} joins a pact against you!`,
              seat.x,
              seat.z,
            );
          }
        }

        // --- espionage (M16b): dispatches, homecomings, and shame ---
        if (e.kind === 'spyDispatched' && e.realm === 0) {
          show(`🕵 An agent slips toward ${state.realms[e.target].name} (${e.mission})`, 'good');
        }
        if (e.kind === 'spyReport' && e.realm === 0) {
          show(`🗺 Maps of ${siteOf(e.settlement)?.name ?? 'their country'} are on your table`, 'good');
        }
        if (e.kind === 'spyIntel' && e.realm === 0) {
          show(`📜 A ledger smuggled out of ${state.realms[e.target].name} — see Diplomacy`, 'good');
        }
        if (e.kind === 'spySabotage' && e.realm === 0) {
          show(
            e.building
              ? `🔥 Their ${e.building} burns — construction set back`
              : `🕵 Your saboteur found nothing worth burning in ${state.realms[e.target].name}`,
            'good',
          );
        }
        if (e.kind === 'spySabotage' && e.target === 0 && e.building) {
          const s = siteOf(e.settlement);
          if (s)
            alert(
              `sabotage:${e.settlement}`,
              `🔥 Sabotage! The ${e.building} at ${s.name} is set back!`,
              s.x,
              s.z,
            );
        }
        if (e.kind === 'spyTheft' && e.realm === 0) {
          show(`💰 ${e.gold} gold lifted from ${state.realms[e.target].name}'s vaults`, 'good');
        }
        if (e.kind === 'spyTheft' && e.target === 0) {
          show(`💰 Thieves in the treasury — ${e.gold} gold is gone!`, 'bad');
        }
        if (e.kind === 'spyCaught' && e.realm === 0) {
          show(`🕵 Your agent was seized in ${state.realms[e.target].name} — the fee is lost`, 'bad');
        }
        if (e.kind === 'spyCaught' && e.target === 0) {
          show(`🕵 A spy of ${state.realms[e.realm].name} was taken within your walls`, 'good');
        }

        // --- trade (M17b): the first gold home, and roads that close ---
        if (e.kind === 'caravanArrived' && e.realm === 0 && e.trips === 1) {
          show(`🛒 First caravan home from ${siteOf(e.target)?.name ?? 'the road'}: ${e.gold} gold`, 'good');
        }
        if (e.kind === 'routeBroken' && e.realm === 0) {
          show(
            e.reason === 'war'
              ? `🛒 War closes the road — ${siteOf(e.settlement)?.name ?? 'your town'}'s caravans recalled`
              : `🛒 ${siteOf(e.settlement)?.name ?? 'A town'} has fallen — its caravans are lost`,
            'bad',
          );
        }

        // --- the war drums (M11): clickable, camera-jumping alerts ---
        if (e.kind === 'raidSpawned' && mineSettlement(e.settlement)) {
          const s = siteOf(e.settlement);
          alert(`raid:${e.settlement}`, `⚔ Raiders march on ${s.name}!`, s.x, s.z);
        }
        if (e.kind === 'siegeStarted' && mineSettlement(e.settlement)) {
          const s = siteOf(e.settlement);
          alert(`siege:${e.settlement}`, `⚔ ${s.name} is under siege!`, s.x, s.z);
        }
        if (e.kind === 'armiesEngaged') {
          const my = state.armies.find((x) => (x.id === e.a || x.id === e.b) && x.ownerRealm === 0);
          if (my) alert(`engaged:${my.id}`, '⚔ Your army is under attack!', my.x, my.z);
        }
        if (e.kind === 'settlementRaided' && mineSettlement(e.settlement)) {
          const s = siteOf(e.settlement);
          alert(`raided:${e.settlement}`, `⚔ ${s.name} has been plundered!`, s.x, s.z);
        }
        if (e.kind === 'dragonAwakened' && mineSettlement(e.settlement)) {
          const s = siteOf(e.settlement);
          alert(`dragon:${e.settlement}`, `🐉 A dragon descends upon ${s.name}!`, s.x, s.z);
        }
        if (e.kind === 'settlementCaptured' && e.from === 0) {
          const s = siteOf(e.settlement);
          alert(`fallen:${e.settlement}`, `⚔ ${s.name} has fallen!`, s.x, s.z);
        }
      }
    },
  };
}
