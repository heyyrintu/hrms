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
