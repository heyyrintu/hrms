import { api } from '@/lib/api';

export type LoanType = 'LOAN' | 'SALARY_ADVANCE';

export type LoanStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ACTIVE'
  | 'CLOSED'
  | 'CANCELLED';

export type RepaymentSource = 'PAYROLL' | 'MANUAL' | 'SETTLEMENT';

export interface LoanBorrower {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string;
}

export interface LoanRepayment {
  id: string;
  loanId: string;
  month: number;
  year: number;
  amount: number;
  source: RepaymentSource;
  payslipId?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface LoanScheduleRow {
  month: number;
  year: number;
  emi: number;
  principalComponent: number;
  interestComponent: number;
  balanceAfter: number;
}

/** One post-tenure deduction payroll is expected to take. */
export interface LoanArrearsInstalment {
  month: number;
  year: number;
  amount: number;
}

/**
 * The part of the balance the remaining scheduled EMIs will not cover.
 *
 * Payroll never takes more than the month's EMI during the tenure and never
 * drives net pay below zero, so a short month leaves a shortfall. It is
 * collected after the tenure ends, one EMI at most per month. Returned on the
 * loan detail for an ACTIVE loan; null otherwise.
 */
export interface LoanArrears {
  amount: number;
  instalments: LoanArrearsInstalment[];
}

export interface Loan {
  id: string;
  employeeId: string;
  type: LoanType;
  principal: number;
  interestRate: number;
  tenureMonths: number;
  emiAmount: number;
  totalPayable: number;
  outstandingAmount: number;
  startMonth: number;
  startYear: number;
  purpose?: string | null;
  status: LoanStatus;
  rejectionReason?: string | null;
  approvedAt?: string | null;
  disbursedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  employee?: LoanBorrower;
  repayments?: LoanRepayment[];
  schedule?: LoanScheduleRow[];
  arrears?: LoanArrears | null;
}

export interface CreateLoanPayload {
  type: LoanType;
  principal: number;
  interestRate?: number;
  tenureMonths: number;
  startMonth: number;
  startYear: number;
  purpose?: string;
}

export interface ListLoansParams {
  status?: LoanStatus;
  type?: LoanType;
  employeeId?: string;
  page?: number;
  limit?: number;
}

export interface RecordRepaymentPayload {
  month: number;
  year: number;
  amount: number;
  note?: string;
}

/**
 * Loans and salary advances.
 *
 * Lives beside `@/lib/api` rather than inside it so the loans workstream owns
 * its own surface; every call still goes through the shared axios instance and
 * therefore the shared auth interceptor.
 */
export const loansApi = {
  /** Request a loan or salary advance for myself. */
  request: (data: CreateLoanPayload) => api.post('/loans', data),

  /** My own loans. */
  getMy: (params?: ListLoansParams) => api.get('/loans/my', { params }),

  /** HR sees the whole tenant; a manager sees only their direct reports. */
  getAll: (params?: ListLoansParams) => api.get('/loans', { params }),

  /** One loan with its repayments and full instalment schedule. */
  getById: (id: string) => api.get(`/loans/${id}`),

  /** Withdraw my own request while it is still pending. */
  cancel: (id: string) => api.post(`/loans/${id}/cancel`),

  approve: (id: string) => api.post(`/loans/${id}/approve`),

  reject: (id: string, reason: string) =>
    api.post(`/loans/${id}/reject`, { reason }),

  /** Money paid out: the loan goes ACTIVE and payroll starts deducting. */
  disburse: (id: string) => api.post(`/loans/${id}/disburse`),

  /** A repayment made outside payroll. */
  recordRepayment: (id: string, data: RecordRepaymentPayload) =>
    api.post(`/loans/${id}/repayments`, data),
};
