import type { Shift } from '@prisma/client';

/** Where a resolved shift day came from. */
export type ShiftDaySource = 'ROSTER' | 'ASSIGNMENT' | 'NONE';

/** The shift an employee is on for one calendar day (Keka wave G). */
export interface ResolvedShiftDay {
  employeeId: string;
  /** UTC midnight (@db.Date). */
  date: Date;
  /** Null when OFF or no shift. */
  shift: Shift | null;
  /** True only for a rostered OFF day. */
  isOff: boolean;
  source: ShiftDaySource;
}
