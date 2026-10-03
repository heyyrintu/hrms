import { DEFAULT_ATTENDANCE_TIME_ZONE, zonedDateOnlyUtc } from '../attendance/rules/late-mark';

export interface CapacityInput {
  from: Date;
  to: Date;
  joinDate: Date;
  exitDate: Date | null;
  /** `YYYY-MM-DD` dates of active, non-optional holidays. */
  holidays: Set<string>;
  /** `YYYY-MM-DD` to 1 or 0.5 (approved leave on that day). */
  leaveDays: Map<string, number>;
  /** From the shift resolver; a missing day falls back to 480. */
  standardMinutesByDate: Map<string, number>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Hours an employee could be expected to work in `[from, to]`: Mon-Fri,
 * minus holidays and the days before joining or after leaving, with leave
 * removing its share of the day, times the day's standard minutes.
 * `joinDate` and `exitDate` are timestamps, so they are compared as IST
 * calendar days.
 */
export function capacityHours(i: CapacityInput): number {
  let minutes = 0;
  const join = iso(zonedDateOnlyUtc(i.joinDate, DEFAULT_ATTENDANCE_TIME_ZONE));
  const exit = i.exitDate ? iso(zonedDateOnlyUtc(i.exitDate, DEFAULT_ATTENDANCE_TIME_ZONE)) : null;

  for (let t = new Date(i.from); t <= i.to; t.setUTCDate(t.getUTCDate() + 1)) {
    const day = t.getUTCDay();
    const key = iso(t);
    if (day === 0 || day === 6) continue;
    if (key < join || (exit && key > exit)) continue;
    if (i.holidays.has(key)) continue;
    const worked = 1 - Math.min(1, i.leaveDays.get(key) ?? 0);
    minutes += worked * (i.standardMinutesByDate.get(key) ?? 480);
  }
  return round2(minutes / 60);
}

/** `num / den` as a percentage to one decimal, or null when `den` is 0. */
export function pct(num: number, den: number): number | null {
  if (!den) return null;
  return Math.round((num / den) * 1000) / 10;
}
