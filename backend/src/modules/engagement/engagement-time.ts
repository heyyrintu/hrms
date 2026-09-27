/**
 * IST calendar helpers for engagement ("today", "this month", leaderboard
 * periods). Asia/Kolkata is a fixed +05:30 offset with no DST, so plain offset
 * arithmetic is exact — no time-zone database needed.
 *
 * Every range is half-open: `[start, end)`.
 */
export const ENGAGEMENT_TIME_ZONE = 'Asia/Kolkata';

const IST_OFFSET_MS = 330 * 60_000;

export type LeaderboardPeriod = 'month' | 'quarter' | 'year' | 'all';

/** UTC instant of IST midnight on the given IST calendar date (month 1-12; overflow rolls over). */
function istMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

/** IST calendar date of `now` as { year, month (1-12), day }. */
export function istDateParts(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** UTC instant of IST midnight of `now`'s IST date. */
export function istStartOfDay(now: Date): Date {
  const { year, month, day } = istDateParts(now);
  return istMidnight(year, month, day);
}

/** [start, end) UTC instants of the IST calendar month containing `now`. */
export function istMonthRange(now: Date): { start: Date; end: Date } {
  const { year, month } = istDateParts(now);
  return { start: istMidnight(year, month, 1), end: istMidnight(year, month + 1, 1) };
}

/** [start, end) for 'month' | 'quarter' | 'year'; 'all' → { start: null, end: null }. */
export function istPeriodRange(
  period: LeaderboardPeriod,
  now: Date,
): { start: Date | null; end: Date | null } {
  const { year, month } = istDateParts(now);
  switch (period) {
    case 'month':
      return istMonthRange(now);
    case 'quarter': {
      const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
      return { start: istMidnight(year, firstMonth, 1), end: istMidnight(year, firstMonth + 3, 1) };
    }
    case 'year':
      return { start: istMidnight(year, 1, 1), end: istMidnight(year + 1, 1, 1) };
    case 'all':
      return { start: null, end: null };
    default: {
      const unknown: never = period;
      throw new Error(`Unknown leaderboard period: ${String(unknown)}`);
    }
  }
}
