/**
 * The one rule for "which shift is this employee on, on this day". Clock-in
 * day resolution and the auto-absent sweep's day/night scoping both read it,
 * so the sweep never treats as a night-shift worker someone clock-in treats as
 * a day-shift worker (or the reverse).
 *
 * - Only active assignments count. `assignShift` deactivates the current
 *   assignment when it creates the next one, so an inactive row is history.
 * - When two assignments cover the day, the newest start date wins.
 * - A shift that has itself been deactivated is no shift at all; it does not
 *   fall back to an older assignment.
 */

import type { Prisma } from '@prisma/client';

export function coveringAssignmentWhere(
  tenantId: string,
  day: Date,
): Prisma.ShiftAssignmentWhereInput {
  return {
    tenantId,
    isActive: true,
    startDate: { lte: day },
    OR: [{ endDate: null }, { endDate: { gte: day } }],
  };
}

/** Pair with `coveringAssignmentWhere`: the first row per employee wins. */
export const NEWEST_ASSIGNMENT_FIRST = { startDate: 'desc' } as const;

export function effectiveShift<S extends { isActive: boolean }>(
  assignment: { shift: S | null } | null | undefined,
): S | null {
  return assignment?.shift?.isActive ? assignment.shift : null;
}
