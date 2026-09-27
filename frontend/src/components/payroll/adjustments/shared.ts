import type { UserRole } from '@/types';
import type {
  EmployeeRef,
  PayrollRunRef,
  PayrollRunStatus,
  PayrollRunType,
} from '@/lib/api-payroll-depth';

/**
 * Helpers shared by the payroll run mechanics UI (Keka wave C, WS-C1).
 *
 * Kept free of runtime imports from `@/types`: several existing page tests mock
 * that module with only `PayrollRunStatus`, so the role list is typed, not
 * read from the enum.
 */

export const PAYROLL_ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN'] as unknown as UserRole[];

export const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_LONG = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Statuses in which a run's inputs (one-time payments, settlements) may change. */
export const EDITABLE_RUN_STATUSES: PayrollRunStatus[] = ['DRAFT', 'COMPUTED'];

/** "Mar 2026", or "Mar 2026 · Off-cycle #2" for an off-cycle run. */
export function formatRunLabel(run: Pick<PayrollRunRef, 'month' | 'year'> & {
  runType?: PayrollRunType;
  sequence?: number;
}): string {
  const base = `${MONTH_SHORT[run.month] ?? run.month} ${run.year}`;
  return run.runType === 'OFF_CYCLE' ? `${base} · Off-cycle #${run.sequence ?? 0}` : base;
}

export function employeeName(e: Pick<EmployeeRef, 'firstName' | 'lastName'> | null | undefined): string {
  if (!e) return '';
  return `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim();
}

/** The backend's `message` (string or class-validator array), else the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  return fallback;
}

/** A run of the list endpoint, with the wave C fields (all optional for old rows). */
export interface RunListItem {
  id: string;
  month: number;
  year: number;
  status: PayrollRunStatus;
  runType?: PayrollRunType;
  sequence?: number;
  needsRecompute?: boolean;
  offCycleReason?: string | null;
  includeSalary?: boolean;
  scopeEmployeeIds?: string[];
  paidAt?: string | null;
}

/**
 * Runs a held salary may be released into: another DRAFT or COMPUTED run, not
 * earlier than the held run's month (spec C3).
 */
export function releaseTargets(runs: RunListItem[], held: Pick<PayrollRunRef, 'id' | 'month' | 'year'>): RunListItem[] {
  const heldKey = held.year * 12 + held.month;
  return runs.filter(
    (r) =>
      r.id !== held.id &&
      (r.status === 'DRAFT' || r.status === 'COMPUTED') &&
      r.year * 12 + r.month >= heldKey,
  );
}

/** Unwraps the employee list endpoint, which pages its results (older callers see a bare array). */
export function unwrapList<T>(payload: unknown): T[] {
  const p = payload as { data?: unknown } | unknown[] | null | undefined;
  if (Array.isArray(p)) return p as T[];
  if (p && Array.isArray((p as { data?: unknown }).data)) return (p as { data: T[] }).data;
  return [];
}
