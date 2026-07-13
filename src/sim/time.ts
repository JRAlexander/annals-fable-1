export const TICKS_PER_DAY = 10;
export const DAYS_PER_YEAR = 120;

export function dateOf(tick: number): { day: number; year: number; dayOfYear: number } {
  const day = Math.floor(tick / TICKS_PER_DAY);
  return { day, year: Math.floor(day / DAYS_PER_YEAR) + 1, dayOfYear: (day % DAYS_PER_YEAR) + 1 };
}

/** True on the tick that closes a game day. */
export function isDayEnd(tick: number): boolean {
  return (tick + 1) % TICKS_PER_DAY === 0;
}
