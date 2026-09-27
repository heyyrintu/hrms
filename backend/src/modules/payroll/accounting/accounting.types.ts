import { AccountingCostCenterMode, PayrollRunStatus, PayrollRunType } from '@prisma/client';

/**
 * Accounting export and variance report contract (Keka wave C, WS-C2).
 * Frozen scaffold file, mirrored in frontend/src/lib/api-payroll-accounting.ts.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, C7 and C8.
 */

/**
 * System keys a GL mapping can target besides payslip line names. Earnings and
 * employer expenses are debits; deductions, *_PAYABLE, NET_PAY and
 * HELD_SALARY are credits.
 */
export const GL_SYSTEM_KEYS = [
  // Debit: earnings
  'BASIC',
  'OT_PAY',
  'ARREARS',
  'REIMBURSEMENT',
  'HOLD_RELEASE',
  'ONE_TIME_EARNING',
  'SETTLEMENT_EARNING',
  // Credit: employee deductions
  'ARREARS_RECOVERY',
  'ONE_TIME_DEDUCTION',
  'SETTLEMENT_RECOVERY',
  'PF_EMPLOYEE',
  'ESI_EMPLOYEE',
  'PROFESSIONAL_TAX',
  'LWF_EMPLOYEE',
  'TDS',
  'LOAN_RECOVERY',
  // Debit: employer contributions (expense) / Credit: their payables
  'PF_EMPLOYER',
  'PF_EMPLOYER_PAYABLE',
  'EPS_EMPLOYER',
  'EPS_EMPLOYER_PAYABLE',
  'EDLI_EMPLOYER',
  'EDLI_EMPLOYER_PAYABLE',
  'PF_ADMIN_EMPLOYER',
  'PF_ADMIN_EMPLOYER_PAYABLE',
  'ESI_EMPLOYER',
  'ESI_EMPLOYER_PAYABLE',
  'LWF_EMPLOYER',
  'LWF_EMPLOYER_PAYABLE',
  // Credit: what is owed to employees
  'NET_PAY',
  'HELD_SALARY',
] as const;

export type GlSystemKey = (typeof GL_SYSTEM_KEYS)[number];

export type GlKeyCategory =
  | 'EARNING'
  | 'DEDUCTION'
  | 'EMPLOYER_EXPENSE'
  | 'EMPLOYER_PAYABLE'
  | 'NET';

export type JournalSide = 'DEBIT' | 'CREDIT';

export interface GlMappingView {
  componentKey: string;
  glCode: string;
  glName: string;
}

/** A key the tenant may want to map, with whether it already is. */
export interface GlKnownKey {
  key: string;
  label: string;
  category: GlKeyCategory;
  side: JournalSide;
  isSystem: boolean;
  mapped: boolean;
}

export interface GlMappingsResponse {
  mappings: GlMappingView[];
  /** System keys + component names from salary structures + recent one-time payment names. */
  knownKeys: GlKnownKey[];
}

export interface AccountingConfigView {
  suspenseGlCode: string | null;
  suspenseGlName: string | null;
  costCenterMode: AccountingCostCenterMode;
  tallyCompanyName: string | null;
  tallyVoucherType: string;
  narrationTemplate: string;
}

export interface JournalLine {
  glCode: string;
  glName: string;
  costCenter: string | null;
  side: JournalSide;
  debit: number;
  credit: number;
  /** The mapping keys aggregated into this line. */
  componentKeys: string[];
}

export interface JournalPreview {
  runId: string;
  month: number;
  year: number;
  runType: PayrollRunType;
  sequence: number;
  status: PayrollRunStatus;
  /** YYYY-MM-DD, last day of the run month. */
  voucherDate: string;
  narration: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  /** Keys with no mapping (posted to suspense when allowUnmapped). */
  unmappedKeys: string[];
  /** False for runs that are not APPROVED/PAID (preview only). */
  exportable: boolean;
}

export type AccountingExportFormat = 'csv' | 'tally';

// ---- Variance report --------------------------------------------------------

export interface VarianceAmount {
  current: number;
  previous: number;
  delta: number;
  /** Null when previous is 0. */
  deltaPct: number | null;
}

export type VarianceEmployeeStatus = 'NEW' | 'LEFT' | 'CHANGED' | 'UNCHANGED';

export interface VarianceComponentDelta {
  /** GL-style key: BASIC, OT_PAY, a line name, or a statutory system key. */
  key: string;
  category: GlKeyCategory;
  current: number;
  previous: number;
  delta: number;
}

export interface VarianceEmployeeRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  status: VarianceEmployeeStatus;
  gross: VarianceAmount;
  deductions: VarianceAmount;
  net: VarianceAmount;
  flagged: boolean;
  /** Only components whose delta is non-zero. */
  components: VarianceComponentDelta[];
}

export interface VarianceComponentRow {
  key: string;
  category: GlKeyCategory;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
  employeesAffected: number;
}

export interface VarianceRunRef {
  id: string;
  month: number;
  year: number;
  runType: PayrollRunType;
  sequence: number;
  status: PayrollRunStatus;
}

export interface VarianceReport {
  run: VarianceRunRef;
  compareRun: VarianceRunRef | null;
  thresholdPct: number;
  totals: {
    gross: VarianceAmount;
    deductions: VarianceAmount;
    net: VarianceAmount;
    headcount: { current: number; previous: number };
  };
  employees: VarianceEmployeeRow[];
  components: VarianceComponentRow[];
}
