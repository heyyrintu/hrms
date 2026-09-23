/**
 * Worked-hours day classification.
 *
 * Applies the tenant's `minHalfDayMinutes` / `minFullDayMinutes` to the net
 * minutes a day actually logged. Pure, like `late-mark.ts`: the service reads
 * the policy and the record, this decides.
 *
 * The outcome is read by payroll directly — HALF_DAY counts as half a present
 * day and ABSENT as a loss-of-pay day when `absentIsLop` is on — so a day
 * short of the half-day threshold becomes ABSENT, the same status the
 * auto-absent sweep uses for a day with no punches at all.
 */

import type { AttendanceStatus } from '@prisma/client';

export interface DayThresholds {
  /** 0 or null switches the half-day rule off. */
  minHalfDayMinutes: number | null | undefined;
  /** 0 or null switches the full-day rule off. */
  minFullDayMinutes: number | null | undefined;
}

/**
 * Statuses this rule derives and may therefore rewrite. LEAVE and HOLIDAY are
 * decided elsewhere and are never touched. HALF_DAY and ABSENT are included so
 * a later clock-out of the same day re-evaluates the cumulative total instead
 * of being stuck with what an earlier, shorter session earned.
 */
const OWNED_STATUSES: ReadonlySet<string> = new Set([
  'PRESENT',
  'WFH',
  'HALF_DAY',
  'ABSENT',
]);

function enabled(threshold: number | null | undefined): threshold is number {
  return typeof threshold === 'number' && Number.isFinite(threshold) && threshold > 0;
}

/**
 * Returns the status the day has earned, or null when the rule has nothing to
 * say (both thresholds off, or a status it does not own).
 *
 * - worked >= full            -> PRESENT (WFH stays WFH)
 * - half <= worked < full     -> HALF_DAY
 * - worked < half             -> ABSENT
 *
 * With only the full-day rule on, a short day is HALF_DAY and never ABSENT;
 * with only the half-day rule on, reaching it earns the full day.
 */
export function classifyWorkedDay(
  workedMinutes: number,
  currentStatus: AttendanceStatus | null | undefined,
  thresholds: DayThresholds,
): AttendanceStatus | null {
  const status = currentStatus ?? 'PRESENT';
  if (!OWNED_STATUSES.has(status)) return null;

  const half = enabled(thresholds.minHalfDayMinutes) ? thresholds.minHalfDayMinutes : null;
  const full = enabled(thresholds.minFullDayMinutes) ? thresholds.minFullDayMinutes : null;
  if (half === null && full === null) return null;

  const worked = Number.isFinite(workedMinutes) && workedMinutes > 0 ? workedMinutes : 0;
  const fullDay: AttendanceStatus = status === 'WFH' ? 'WFH' : 'PRESENT';

  if (full !== null) {
    if (worked >= full) return fullDay;
    if (half === null) return 'HALF_DAY';
    return worked >= half ? 'HALF_DAY' : 'ABSENT';
  }

  // Half-day rule alone: reaching it is a full day.
  return worked >= (half as number) ? fullDay : 'ABSENT';
}
