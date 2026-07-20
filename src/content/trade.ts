/**
 * Trade (M17): the Market finally trades. Two mechanisms share these numbers —
 * the exchange (marketTrade command: any resource pair priced through
 * RESOURCE_VALUE, minus the spread) and caravans (cart entities walking
 * settlement-to-settlement routes over the road-discounted nav grid).
 *
 * Income math, so the numbers stay honest (measured on seeds 1234/1/42:
 * nearest own town ≈ 12-16 path cells, cross-realm ≈ 60-90):
 * a cart covers ~0.6-0.7 cells/tick on roads, so a round trip of 2L cells
 * takes ~L/3 days; payout BASE + PER_CELL×L gives gold/day ≈ 24 + 120/L —
 * ~32/day on a home route, ~39/day on a long foreign one (×1.5 bonus).
 * A gold villager nets ~4.3/day, so one cart ≈ a 7-villager gold camp and
 * the guildhall's second cart doubles it: caravans are the gold engine.
 */

/** Fee the market keeps on every exchange: you receive value × (1 − spread). */
export const TRADE_SPREAD = 0.25;

/** Flat gold per completed round trip, before the distance term. */
export const TRADE_BASE = 40;

/** Gold per path cell of one-way route length. */
export const TRADE_PER_CELL = 8;

/** Routes to another realm's town pay this much more — risk rewarded. */
export const FOREIGN_TRADE_BONUS = 1.5;

/**
 * Cart pace in cells/tick divided by the cell's navCost (armies' MARCH_RATE
 * model); roads at 0.5 cost make this ~0.7 cells/tick ≈ twice a villager.
 */
export const CART_RATE = 0.35;
