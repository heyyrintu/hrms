import { PayrollRunStatus, PayrollRunType } from '@prisma/client';
import { EmployeeRef, PayrollRunRef } from '../payroll-depth.types';

/** Prisma `select` for an EmployeeRef. */
export const EMPLOYEE_REF_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
} as const;

/** Prisma `select` for a PayrollRunRef. */
export const RUN_REF_SELECT = {
  id: true,
  month: true,
  year: true,
  runType: true,
  sequence: true,
  status: true,
} as const;

export function toEmployeeRef(e: {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
}): EmployeeRef {
  return { id: e.id, employeeCode: e.employeeCode, firstName: e.firstName, lastName: e.lastName };
}

export function toRunRef(r: {
  id: string;
  month: number;
  year: number;
  runType: PayrollRunType;
  sequence: number;
  status: PayrollRunStatus;
}): PayrollRunRef {
  return {
    id: r.id,
    month: r.month,
    year: r.year,
    runType: r.runType,
    sequence: r.sequence,
    status: r.status,
  };
}

/** Rupees as a JSON number (2 dp). */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(Number(value.toString()).toFixed(2));
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mar 2026" / "Mar 2026 (off-cycle #2)" for messages. */
export function runLabel(run: { month: number; year: number; runType?: PayrollRunType; sequence?: number }): string {
  const base = `${MONTHS[run.month - 1]} ${run.year}`;
  return run.runType === PayrollRunType.OFF_CYCLE ? `${base} (off-cycle #${run.sequence})` : base;
}

/** (year, month) ordering: negative when a is earlier. */
export function compareMonth(
  a: { month: number; year: number },
  b: { month: number; year: number },
): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}
