import {
  OneTimePaymentKind,
  PayrollRunStatus,
  PayrollRunType,
  SalaryArrearStatus,
  SalaryHoldStatus,
} from '@prisma/client';

/**
 * Response shapes of the WS-C1 endpoints (Keka wave C). Frozen scaffold file,
 * mirrored in frontend/src/lib/api-payroll-depth.ts.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part C.
 *
 * Money is returned as `number` (rupees, 2 dp): services convert Prisma
 * Decimals with Number() when building these views.
 */

export interface EmployeeRef {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
}

export interface PayrollRunRef {
  id: string;
  month: number;
  year: number;
  runType: PayrollRunType;
  sequence: number;
  status: PayrollRunStatus;
}

export interface PayrollSettingsView {
  reimburseExpensesViaPayroll: boolean;
  autoArrears: boolean;
}

export interface OneTimePaymentView {
  id: string;
  payrollRunId: string;
  employee: EmployeeRef;
  kind: OneTimePaymentKind;
  /** Earnings: BONUS, INCENTIVE, COMMISSION, OTHER_EARNING. */
  isEarning: boolean;
  name: string;
  amount: number;
  taxable: boolean;
  note: string | null;
  createdAt: string;
}

export interface ArrearLineView {
  name: string;
  original: number;
  revised: number;
  delta: number;
}

export interface SalaryArrearView {
  id: string;
  employee: EmployeeRef;
  employeeSalaryId: string;
  forMonth: number;
  forYear: number;
  financialYear: number;
  originalAmount: number;
  revisedAmount: number;
  /** Signed: negative is a recovery. */
  amount: number;
  pfWagesDelta: number;
  lines: ArrearLineView[];
  status: SalaryArrearStatus;
  payrollRun: PayrollRunRef | null;
  createdAt: string;
}

export interface ArrearDetectionResult {
  /** Arrear rows written by this detection. */
  created: number;
  arrears: SalaryArrearView[];
}

export interface SalaryHoldView {
  id: string;
  employee: EmployeeRef;
  payrollRun: PayrollRunRef;
  reason: string;
  status: SalaryHoldStatus;
  /** Null until released or voided. */
  heldAmount: number | null;
  releaseRun: PayrollRunRef | null;
  releasedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
}

export interface RunReimbursementClaim {
  id: string;
  employee: EmployeeRef;
  categoryName: string;
  amount: number;
  expenseDate: string;
  approvedAt: string | null;
  /** True when attached to this run; false = eligible, attached on (re)compute. */
  attached: boolean;
}

export interface RunReimbursementsView {
  /** PayrollSettings.reimburseExpensesViaPayroll */
  enabled: boolean;
  claims: RunReimbursementClaim[];
  total: number;
}
