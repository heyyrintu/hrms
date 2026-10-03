/**
 * Calendar helpers for the weekly timesheet. Dates are `YYYY-MM-DD` strings
 * and all arithmetic runs on UTC-noon dates, so a daylight-saving change or
 * the viewer's time zone can never shift a day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const parse = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const format = (d: Date): string => d.toISOString().slice(0, 10);

/** Today's calendar date in the viewer's time zone, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  return format(new Date(parse(iso).getTime() + days * DAY_MS));
}

/** The Monday on or before `iso`. */
export function mondayOf(iso: string): string {
  const dow = parse(iso).getUTCDay(); // 0 = Sunday
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

/** The seven days of the week starting on `weekStart`. */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** `Mon 16` style header for a day. */
export function dayHeader(iso: string): string {
  const d = parse(iso);
  const name = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${name} ${d.getUTCDate()}`;
}

/** `16 Mar 2026`. */
export function formatDay(iso: string): string {
  return parse(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Hours with at most two decimals and no trailing zeros: 8, 7.5, 0.25. */
export function formatHours(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

export function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

export function lastOfMonth(iso: string): string {
  const d = parse(firstOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return format(d);
}

export function addMonths(iso: string, months: number): string {
  const d = parse(firstOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + months, 1);
  return format(d);
}
