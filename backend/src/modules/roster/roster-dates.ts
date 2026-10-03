const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `a` to `b` (both UTC midnight). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Position within a rotation cycle for `date`, with the cycle shifted by `offset`. */
export function patternDayIndex(
  start: Date,
  date: Date,
  cycleLength: number,
  offset: number,
): number {
  return (daysBetween(start, date) + offset) % cycleLength;
}

/** Every UTC calendar day from `from` to `to`, inclusive. Empty when `from > to`. */
export function eachDate(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) days.push(new Date(t));
  return days;
}

/** Parse a `YYYY-MM-DD` wire date as UTC midnight; null when it is not a real date. */
export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

/** `YYYY-MM-DD` of a date-only value. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
