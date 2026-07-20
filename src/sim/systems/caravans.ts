import { CART_RATE, FOREIGN_TRADE_BONUS, TRADE_BASE, TRADE_PER_CELL } from '../../content/trade';
import { cellPos, hidx } from '../../worldgen/coords';
import type { SimEvent } from '../events';
import { resolveStat } from '../modifiers';
import { findPath, pathReaches } from '../pathfind';
import type { Caravan, GameState } from '../state';
import { isDayEnd } from '../time';

/**
 * Caravans (M17): trade carts walking settlement-to-settlement routes over
 * the same road-discounted nav grid as armies. Everything is rng-free and a
 * pure function of state, so replays regenerate every cart exactly:
 * - Spawn is day-boundary only, at most one cart per settlement per day,
 *   toward a cap of markets + guildhalls standing there.
 * - ONE recall rule: a cart whose `target` snapshot disagrees with its home
 *   settlement's live route turns around — that single check covers routes
 *   cleared, replaced, and broken by war. Recalled carts come home unpaid.
 * - Payouts land in halves (half at the target, half back home) so early
 *   gold caps don't swallow whole trips; the foreign bonus and gatherRate
 *   modifiers are evaluated at each deposit from CURRENT state.
 */

/** One-way trip gold for a route of `cells` path cells, before bonuses. */
export function routeGold(cells: number): number {
  return TRADE_BASE + TRADE_PER_CELL * cells;
}

/** Half-trip payout deposited at one endpoint, with live bonus + modifiers. */
function deposit(state: GameState, c: Caravan): number {
  const home = state.settlements[c.home];
  const target = state.settlements[c.target];
  if (!home || !target) return 0;
  const foreign = target.ownerRealm !== home.ownerRealm ? FOREIGN_TRADE_BONUS : 1;
  const full = resolveStat(
    { state, realm: home.ownerRealm, settlement: c.home },
    routeGold(c.path.length - 1) * foreign,
    { stat: 'gatherRate', resource: 'gold' },
  );
  const half = Math.floor(full / 2);
  state.realms[home.ownerRealm].stock.gold += half; // storage clamp trims overflow
  return half;
}

/** Fresh outbound cart state for the CURRENT route, or null if unroutable. */
function depart(state: GameState, c: Caravan): boolean {
  const home = state.settlements[c.home];
  if (!home?.trade) return false;
  const a = state.world.settlements[c.home];
  const b = state.world.settlements[home.trade.target];
  const path = findPath(state.world, a.i, a.j, b.i, b.j);
  if (!pathReaches(path, b.i, b.j)) return false;
  c.target = home.trade.target;
  c.phase = 'outbound';
  c.laden = false;
  c.banked = 0;
  c.path = path;
  c.pathIdx = 0;
  c.cellProgress = 0;
  const at = cellPos(a.i, a.j);
  c.x = at.x;
  c.z = at.z;
  return true;
}

export function caravansSystem(state: GameState, out: SimEvent[]): void {
  // war breaks routes — target owner checks run every tick so a declaration
  // mid-trip strands no cart in enemy country for long
  for (const s of state.settlements) {
    if (!s.trade) continue;
    const target = state.settlements[s.trade.target];
    if (!target || state.realms[s.ownerRealm].atWarWith.includes(target.ownerRealm)) {
      delete s.trade;
      out.push({ kind: 'routeBroken', realm: s.ownerRealm, settlement: s.id, reason: 'war' });
    }
  }

  const survivors: Caravan[] = [];
  for (const c of state.caravans) {
    c.prevX = c.x;
    c.prevZ = c.z;
    const home = state.settlements[c.home];
    if (!home) continue; // home gone entirely — the cart is lost with it

    // the one recall rule: any disagreement with the live route turns the
    // cart around on the ground it has already covered, cargo unpaid
    if (c.phase === 'outbound' && home.trade?.target !== c.target) {
      c.path = c.path.slice(0, c.pathIdx + 1).reverse();
      c.pathIdx = 0;
      c.cellProgress = 0;
      c.phase = 'returning';
      c.laden = false;
    }

    // movement — the armies' cell walk at cart pace
    const [ci, cj] = c.path[Math.min(c.pathIdx, c.path.length - 1)];
    const nav = Math.max(0.5, state.world.navCost[hidx(ci, cj)] || 1);
    c.cellProgress += CART_RATE / nav;
    while (c.cellProgress >= 1 && c.pathIdx < c.path.length - 1) {
      c.cellProgress -= 1;
      c.pathIdx += 1;
    }
    const [i, j] = c.path[c.pathIdx];
    const [ni, nj] = c.path[Math.min(c.pathIdx + 1, c.path.length - 1)];
    const p0 = cellPos(i, j);
    const p1 = cellPos(ni, nj);
    const t = Math.min(c.cellProgress, 1);
    c.x = p0.x + (p1.x - p0.x) * t;
    c.z = p0.z + (p1.z - p0.z) * t;

    if (c.pathIdx >= c.path.length - 1) {
      if (c.phase === 'outbound') {
        // goods sold at the far market: first half banked, walk it home
        c.banked = deposit(state, c);
        c.path = [...c.path].reverse();
        c.pathIdx = 0;
        c.cellProgress = 0;
        c.phase = 'returning';
        c.laden = true;
      } else {
        if (c.laden) {
          // the sale already happened out there — the proceeds come home even
          // if the route was replaced meanwhile (trips only track a live match)
          const half = deposit(state, c);
          const live = home.trade?.target === c.target ? home.trade : null;
          if (live) {
            live.trips += 1;
            live.lastGold = c.banked + half;
          }
          out.push({
            kind: 'caravanArrived',
            realm: home.ownerRealm,
            settlement: c.home,
            target: c.target,
            gold: c.banked + half,
            trips: live?.trips ?? 0,
          });
        }
        // re-read the CURRENT route: re-depart (handles replacement) or retire
        if (!depart(state, c)) continue;
      }
    }
    survivors.push(c);
  }
  state.caravans = survivors;

  // day-boundary spawn: one fresh cart per settlement per day toward the cap
  if (!isDayEnd(state.tick)) return;
  for (const s of state.settlements) {
    if (!s.trade) continue;
    const cap = (s.buildings.market ?? 0) + (s.buildings.guildhall ?? 0);
    const homed = state.caravans.reduce((n, c) => n + (c.home === s.id ? 1 : 0), 0);
    if (homed >= cap) continue;
    const cart: Caravan = {
      id: state.nextCaravanId++,
      home: s.id,
      target: s.trade.target,
      phase: 'outbound',
      laden: false,
      banked: 0,
      x: 0,
      z: 0,
      prevX: 0,
      prevZ: 0,
      path: [],
      pathIdx: 0,
      cellProgress: 0,
    };
    if (!depart(state, cart)) continue;
    cart.prevX = cart.x;
    cart.prevZ = cart.z;
    state.caravans.push(cart);
  }
}
