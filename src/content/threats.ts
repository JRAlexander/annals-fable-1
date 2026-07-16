/**
 * Threat + victory tuning constants (M6). All deterministic — the raid
 * schedule and dragon are pure functions of state, no rng streams drawn.
 */

/** Days between raids from a single camp. */
export const RAID_PERIOD = 90;
/** First day any camp may raid (staggered by camp id on top). */
export const RAID_START_DAY = 45;
/** Days each camp's first raid is delayed per camp id — spreads the pain. */
export const RAID_STAGGER = 17;
/** Raider band size = camp defender count × this (raids grow with the ages). */
export const RAID_SIZE_MULT: Record<string, number> = {
  founding: 0.4,
  flowering: 0.75,
  highKingdom: 1.0,
  golden: 1.25,
};
/** Fraction of a realm's stock a successful raid carries off. */
export const RAID_PLUNDER = 0.15;
/** Population lost to a successful raid. */
export const RAID_POP_MULT = 0.97;
/** Fraction of a settlement's villagers killed by a successful raid (M12). */
export const RAID_VILLAGER_LOSS = 0.2;
/** Fraction of villagers killed when a settlement is captured; the rest convert. */
export const CAPTURE_VILLAGER_LOSS = 0.1;

/** Days a completed Wonder must stand before the bells ring victory. */
export const WONDER_DAYS = 60;

/** Gold the realm that slays the dragon claws from its hoard. */
export const DRAGON_HOARD = 2000;

/** Owner id for armies that belong to no realm: raiders and the dragon. */
export const WILD_REALM = -1;
