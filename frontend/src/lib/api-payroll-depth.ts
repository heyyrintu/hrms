import { api } from '@/lib/api';

/**
 * Payroll run mechanics (Keka wave C, WS-C1): off-cycle runs, one-time
 * payments, arrears, salary holds, reimbursements through payroll, settings.
 *
 * Types mirror `backend/src/modules/payroll/payroll-depth.types.ts`. Calls go
 * through the shared axios instance; callers unwrap `.data`.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part C.
 */

export type PayrollRunType = 'REGULAR' | 'OFF_CYCLE';
export type PayrollRunStatus = 'DRAFT' | 'PROCESSING' | 'COMPUTED' | 'APPROVED' | 'PAID';
export type OneTimePaymentKind =
  | 'BONUS'
  | 'INCENTIVE'
  | 'COMMISSION'
  | 'OTHER_EARNING'
  | 'RECOVERY'
  | 'OTHER_DEDUCTION';
export type SalaryArrearStatus = 'PENDING' | 'INCLUDED' | 'PAID' | 'CANCELLED';
export type SalaryHoldStatus = 'HELD' | 'RELEASED' | 'VOIDED';

export const EARNING_KINDS: OneTimePaymentKind[] = ['BONUS', 'INCENTIVE', 'COMMISSION', 'OTHER_EARNING'];

export const ONE_TIME_KIND_LABELS: Record<OneTimePaymentKind, string> = {
  BONUS: 'Bonus',
  INCENTIVE: 'Incentive',
  COMMISSION: 'Commission',
  OTHER_EARNING: 'Other earning',
  RECOVERY: 'Recovery',
  OTHER_DEDUCTION: 'Other deduction',
};

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

export interface PayrollSettings {
  reimburseExpensesViaPayroll: boolean;
  autoArrears: boolean;
}

export interface OneTimePayment {
  id: string;
  payrollRunId: string;
  employee: EmployeeRef;
  kind: OneTimePaymentKind;
  isEarning: boolean;
  name: string;
  amount: number;
  taxable: boolean;
  note: string | null;
  createdAt: string;
}

export interface CreateOneTimePaymentPayload {
  employeeId: string;
  kind: OneTimePaymentKind;
  name: string;
  amount: number;
  taxable?: boolean;
  note?: string;
}

export interface ArrearLine {
  name: string;
  original: number;
  revised: number;
  delta: number;
}

export interface SalaryArrear {
  id: string;
  employee: EmployeeRef;
  employeeSalaryId: string;
  forMonth: number;
  forYear: number;
  financialYear: number;
  originalAmount: number;
  revisedAmount: number;
  amount: number;
  pfWagesDelta: number;
  lines: ArrearLine[];
  status: SalaryArrearStatus;
  payrollRun: PayrollRunRef | null;
  createdAt: string;
}

export interface ArrearDetectionResult {
  created: number;
  arrears: SalaryArrear[];
}

export interface SalaryHold {
  id: string;
  employee: EmployeeRef;
  payrollRun: PayrollRunRef;
  reason: string;
  status: SalaryHoldStatus;
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
  attached: boolean;
}

export interface RunReimbursements {
  enabled: boolean;
  claims: RunReimbursementClaim[];
  total: number;
}

export interface CreateOffCycleRunPayload {
  month: number;
  year: number;
  reason: string;
  includeSalary: boolean;
  employeeIds: string[];
}

export const payrollDepthApi = {
  // Off-cycle runs
  createOffCycleRun: (payload: CreateOffCycleRunPayload) =>
    api.post('/payroll/runs/off-cycle', payload),

  // One-time payments
  listOneTimePayments: (runId: string) =>
    api.get<OneTimePayment[]>(`/payroll/runs/${runId}/one-time-payments`),
  createOneTimePayment: (runId: string, payload: CreateOneTimePaymentPayload) =>
    api.post<OneTimePayment>(`/payroll/runs/${runId}/one-time-payments`, payload),
  deleteOneTimePayment: (id: string) => api.delete(`/payroll/one-time-payments/${id}`),

  // Arrears
  listArrears: (params?: { status?: SalaryArrearStatus; employeeId?: string }) =>
    api.get<SalaryArrear[]>('/payroll/arrears', { params }),
  detectArrears: (employeeId: string) =>
    api.post<ArrearDetectionResult>('/payroll/arrears/detect', { employeeId }),
  cancelArrear: (id: string) => api.post<SalaryArrear>(`/payroll/arrears/${id}/cancel`),

  // Holds
  listRunHolds: (runId: string) => api.get<SalaryHold[]>(`/payroll/runs/${runId}/holds`),
  listHolds: (status?: SalaryHoldStatus) =>
    api.get<SalaryHold[]>('/payroll/holds', { params: status ? { status } : undefined }),
  holdSalary: (runId: string, payload: { employeeId: string; reason: string }) =>
    api.post<SalaryHold>(`/payroll/runs/${runId}/holds`, payload),
  unhold: (id: string) => api.delete(`/payroll/holds/${id}`),
  releaseHold: (id: string, targetRunId: string) =>
    api.post<SalaryHold>(`/payroll/holds/${id}/release`, { targetRunId }),
  voidHold: (id: string, reason: string) =>
    api.post<SalaryHold>(`/payroll/holds/${id}/void`, { reason }),

  // Reimbursements
  getRunReimbursements: (runId: string) =>
    api.get<RunReimbursements>(`/payroll/runs/${runId}/reimbursements`),

  // Settlements carried by an off-cycle run
  attachSettlement: (runId: string, settlementId: string) =>
    api.post(`/payroll/runs/${runId}/settlements`, { settlementId }),
  detachSettlement: (runId: string, settlementId: string) =>
    api.delete(`/payroll/runs/${runId}/settlements/${settlementId}`),

  // Settings
  getSettings: () => api.get<PayrollSettings>('/payroll/settings'),
  updateSettings: (payload: Partial<PayrollSettings>) =>
    api.put<PayrollSettings>('/payroll/settings', payload),
};
