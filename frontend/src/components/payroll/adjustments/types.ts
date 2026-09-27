import type { EmployeeRef, PayrollRunStatus, PayrollRunType } from '@/lib/api-payroll-depth';

/** What the run-detail tabs need to know about the run they sit in. */
export interface RunContext {
  id: string;
  month: number;
  year: number;
  status: PayrollRunStatus;
  runType: PayrollRunType;
  sequence: number;
}

/** Employees a run's inputs may be recorded for (payslips, scope, or active staff). */
export type RunEmployee = EmployeeRef;
