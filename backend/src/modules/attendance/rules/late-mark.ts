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

/**
 * True when a shift ends on the calendar day after it starts (22:00-06:00).
 * An end equal to the start is a 24-hour shift, which also crosses midnight.
 * Unusable times are never overnight.
 */
export function isOvernightShift(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): boolean {
  const start = parseHhMm(startTime);
  const end = parseHhMm(endTime);
  if (start === null || end === null) return false;
  return end <= start;
}

/**
 * How early someone may arrive for a 24-hour shift and still be starting
 * today's shift rather than finishing yesterday's. Such a shift has no
 * off-duty gap to split, so the window is a fixed allowance instead.
 */
export const ZERO_GAP_EARLY_ARRIVAL_MINUTES = 120;

/**
 * Minutes since local midnight before which a punch belongs to the overnight
 * shift that started the previous evening. It is the midpoint of the off-duty
 * gap (off 06:00 -> 22:00 gives 14:00), so an early arrival for tonight and a
 * late departure from last night both land on the right shift. Null for a
 * same-day shift, where no punch ever belongs to yesterday.
 *
 * A 24-hour shift (start == end) has no gap: its cutoff sits
 * `ZERO_GAP_EARLY_ARRIVAL_MINUTES` before the start, never before midnight,
 * so arriving a little early is scored against today's start.
 */
export function overnightDayCutoffMinutes(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): number | null {
  const start = parseHhMm(startTime);
  const end = parseHhMm(endTime);
  if (start === null || end === null || end > start) return null;
  if (end === start) return Math.max(0, start - ZERO_GAP_EARLY_ARRIVAL_MINUTES);
  return end + Math.floor((start - end) / 2);
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
 *
 * Pass `shiftEnd` for a shift that may cross midnight. For an overnight shift
 * the punch is scored against the start on the shift's START day: with a
 * 22:00-06:00 shift, 00:30 is 2h30 after 22:00 of the previous evening, not
 * 21h30 before tonight's start.
 */
export function computeLateMark(
  clockIn: Date,
  shiftStart: string,
  graceMinutes: number,
  tz: string = DEFAULT_ATTENDANCE_TIME_ZONE,
  shiftEnd?: string | null,
): LateMarkResult {
  const start = parseHhMm(shiftStart);
  if (start === null) return { isLate: false, lateByMinutes: 0 };

  const grace =
    Number.isFinite(graceMinutes) && graceMinutes > 0 ? Math.floor(graceMinutes) : 0;

  let actual = minutesSinceMidnightInZone(clockIn, tz);
  // A punch before the overnight cutoff happened on the day after the shift
  // started; move it onto that start day's clock so the subtraction is linear.
  const cutoff = overnightDayCutoffMinutes(shiftStart, shiftEnd);
  if (cutoff !== null && actual < cutoff) actual += 24 * 60;

  const lateBy = actual - (start + grace);

  return lateBy > 0
    ? { isLate: true, lateByMinutes: lateBy }
    : { isLate: false, lateByMinutes: 0 };
}
