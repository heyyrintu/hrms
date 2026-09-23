/**
 * Night-shift day assignment.
 *
 * A 22:00-06:00 shift straddles two calendar days, but it is one working day:
 * the attendance row, the late mark and the worked minutes all belong to the
 * day the shift STARTED. Pure for the same reason as `late-mark.ts` — the
 * awkward cases are all wall-clock arithmetic and deserve direct tests.
 *
 * Overnight-ness is derived from the times rather than read from
 * `Shift.isOvernight`: rows that predate that column all default to false, and
 * the times are what the shift actually is.
 */

import {
  DEFAULT_ATTENDANCE_TIME_ZONE,
  isOvernightShift,
  minutesSinceMidnightInZone,
  overnightDayCutoffMinutes,
  parseHhMm,
  zonedDateOnlyUtc,
} from './late-mark';

export { isOvernightShift, overnightDayCutoffMinutes };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ShiftTimes {
  startTime: string;
  endTime: string;
}

/**
 * The working day `at` belongs to, as the UTC-midnight `Date` that
 * `AttendanceRecord.date` stores. Only an overnight shift ever moves a punch
 * off its own calendar day: before the cutoff it belongs to the shift that
 * started the previous evening.
 */
export function resolveShiftDate(
  at: Date,
  shift: ShiftTimes | null | undefined,
  tz: string = DEFAULT_ATTENDANCE_TIME_ZONE,
): Date {
  const calendarDay = zonedDateOnlyUtc(at, tz);
  const cutoff = shift ? overnightDayCutoffMinutes(shift.startTime, shift.endTime) : null;
  if (cutoff === null) return calendarDay;

  return minutesSinceMidnightInZone(at, tz) < cutoff
    ? previousDateOnly(calendarDay)
    : calendarDay;
}

/** The UTC-midnight date one day before a UTC-midnight date. */
export function previousDateOnly(day: Date): Date {
  return new Date(day.getTime() - MS_PER_DAY);
}

/**
 * Longest a clock-in may come after an overnight shift's scheduled end and
 * still belong to it. The only honest reason to clock in after your shift has
 * ended is coming back from a break taken near the end to finish overtime;
 * two hours covers that. Anything later is the next working day, which is what
 * an expired night assignment followed by a day shift looks like at 09:00.
 * Capped by half the off-duty gap so a short gap is not swallowed either.
 */
export const MAX_POST_SHIFT_CLOCK_IN_MINUTES = 120;

/**
 * Whether a clock-in at `at` continues the overnight shift that started
 * yesterday rather than opening today's working day. Both must hold:
 *
 * - the punch is before yesterday's end plus a bounded slack (and before the
 *   day cutoff, which is what the late mark is scored against), and
 * - today's own shift, if any, does not start nearer the punch. A punch at or
 *   after today's start always belongs to today.
 *
 * Ties go to today: a punch exactly between the two is someone starting work.
 */
export function clockInBelongsToPreviousShift(
  at: Date,
  previousShift: ShiftTimes | null | undefined,
  currentShift: ShiftTimes | null | undefined,
  tz: string = DEFAULT_ATTENDANCE_TIME_ZONE,
): boolean {
  if (!previousShift) return false;
  const cutoff = overnightDayCutoffMinutes(previousShift.startTime, previousShift.endTime);
  const start = parseHhMm(previousShift.startTime);
  const end = parseHhMm(previousShift.endTime);
  if (cutoff === null || start === null || end === null) return false;

  const slack = Math.min(Math.floor((start - end) / 2), MAX_POST_SHIFT_CLOCK_IN_MINUTES);
  const minutes = minutesSinceMidnightInZone(at, tz);
  if (minutes >= Math.min(cutoff, end + slack)) return false;

  const currentStart = currentShift ? parseHhMm(currentShift.startTime) : null;
  if (currentStart === null) return true;

  const pastPreviousEnd = Math.max(0, minutes - end);
  const untilCurrentStart = Math.max(0, currentStart - minutes);
  return pastPreviousEnd < untilCurrentStart;
}

/** Floor of the carried-session window: a same-day shift worked past midnight. */
export const MIN_CARRIED_SESSION_MINUTES = 18 * 60;
/** Ceiling: a 24-hour shift plus two hours of overrun. Beyond is forgotten. */
export const MAX_CARRIED_SESSION_MINUTES = 26 * 60;
const CARRIED_SESSION_OVERRUN_MINUTES = 120;

/**
 * How long a session opened on the previous day may have been open and still
 * be closed by today's clock-out. Eighteen hours unless the shift itself is
 * longer, in which case its length plus two hours of overrun, capped at 26
 * hours. Past that the clock-out was forgotten and needs regularizing.
 */
export function carriedSessionWindowMinutes(shift: ShiftTimes | null | undefined): number {
  const start = shift ? parseHhMm(shift.startTime) : null;
  const end = shift ? parseHhMm(shift.endTime) : null;
  if (start === null || end === null) return MIN_CARRIED_SESSION_MINUTES;

  const length = end > start ? end - start : end - start + 24 * 60;
  return Math.min(
    MAX_CARRIED_SESSION_MINUTES,
    Math.max(MIN_CARRIED_SESSION_MINUTES, length + CARRIED_SESSION_OVERRUN_MINUTES),
  );
}
