/**
 * Calendar-date helpers.
 *
 * The pitfall these replace: `new Date('2026-09-14')` parses a bare
 * `YYYY-MM-DD` string as UTC midnight, but `getDay()` and `getDate()` then read
 * it in the viewer's local zone. West of UTC that lands on the previous day, so
 * weekend detection and "is this in the past" checks are off by one.
 * Likewise calling `toISOString()` on `new Date()` and taking the date part
 * yields the UTC date, which in IST is yesterday between local midnight
 * and 05:30.
 */

/** Parse `YYYY-MM-DD` as local midnight, so weekday and day-of-month read true. */
export function parseLocalDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Today's calendar date in the viewer's zone, as `YYYY-MM-DD`. */
export function todayLocalIso(): string {
  return toLocalIso(new Date());
}

/** Format a Date as `YYYY-MM-DD` using its local calendar fields. */
export function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True for Saturday and Sunday in the viewer's zone. */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
