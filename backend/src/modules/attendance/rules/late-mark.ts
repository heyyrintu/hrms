/**
 * Late-mark derivation.
 *
 * Pure on purpose: no Prisma, no ambient clock, no Nest. The caller resolves
 * the shift (or the tenant's attendance policy) and hands the numbers in, so
 * the rule itself can be exercised against every awkward wall-clock case.
 *
 * Everything here reads the wall clock in a named zone rather than the server's
 * own zone. `Date` carries an instant, not a local time, and the machine that
 * runs this may sit in UTC while the office it is scoring sits in IST — reading
 * `getHours()` would silently mark a 09:00 IST punch as a 03:30 one.
 */

export interface LateMarkResult {
  isLate: boolean;
  /** Minutes past the end of grace. Zero whenever `isLate` is false. */
  lateByMinutes: number;
}

/** India is the only market this HRMS serves today. */
export const DEFAULT_ATTENDANCE_TIME_ZONE = 'Asia/Kolkata';

const HH_MM = /^(\d{1,2}):(\d{2})$/;

/**
 * Parse a `Shift.startTime` / `AttendancePolicy.defaultShiftStart` string into
 * minutes since local midnight. Returns null when the value is not a clock
 * time, which the caller treats as "no late marking possible".
 */
export function parseHhMm(value: string | null | undefined): number | null {
  const match = HH_MM.exec((value ?? '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/** Minutes since midnight of the calendar day `at` falls on inside `tz`. */
export function minutesSinceMidnightInZone(
  at: Date,
  tz: string = DEFAULT_ATTENDANCE_TIME_ZONE,
): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  return hour * 60 + minute;
}

/**
 * The calendar day `at` falls on inside `tz`, expressed as a UTC-midnight
 * `Date`. That is exactly the shape Prisma stores for a `@db.Date` column, so
 * the result can be used directly in a `where` on `AttendanceRecord.date`.
 */
export function zonedDateOnlyUtc(
  at: Date,
  tz: string = DEFAULT_ATTENDANCE_TIME_ZONE,
): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);

  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Score a clock-in against its shift start plus grace.
 *
 * The grace minute itself is on time: with a 09:00 start and 15 minutes grace,
 * 09:15 is not late and 09:16 is late by one minute. `lateByMinutes` counts
 * from the end of grace, not from the shift start, so the number matches what
 * the employee is actually penalised for.
 */
export function computeLateMark(
  clockIn: Date,
  shiftStart: string,
  graceMinutes: number,
  tz: string = DEFAULT_ATTENDANCE_TIME_ZONE,
): LateMarkResult {
  const start = parseHhMm(shiftStart);
  if (start === null) return { isLate: false, lateByMinutes: 0 };

  const grace =
    Number.isFinite(graceMinutes) && graceMinutes > 0 ? Math.floor(graceMinutes) : 0;

  const actual = minutesSinceMidnightInZone(clockIn, tz);
  const lateBy = actual - (start + grace);

  return lateBy > 0
    ? { isLate: true, lateByMinutes: lateBy }
    : { isLate: false, lateByMinutes: 0 };
}
