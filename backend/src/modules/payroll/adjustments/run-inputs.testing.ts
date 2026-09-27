import { SalaryArrearsService } from './salary-arrears.service';
import { OneTimePaymentsService } from './one-time-payments.service';
import { SalaryHoldsService } from './salary-holds.service';
import { PayrollReimbursementsService } from './payroll-reimbursements.service';
import { PayrollSettingsService } from './payroll-settings.service';

/**
 * Test doubles for the Keka wave C collaborators PayrollService injects, with
 * a tenant that has nothing attached to any run: no arrears, one-time
 * payments, releases or claims, and the default settings. Specs override
 * individual mocks as needed.
 */
export function createRunInputMocks() {
  const arrears = {
    detectForEmployee: jest.fn().mockResolvedValue({ created: 0, arrears: [] }),
    pendingForRun: jest.fn().mockResolvedValue([]),
    detachFromRun: jest.fn().mockResolvedValue({ count: 0 }),
    attachToRun: jest.fn().mockResolvedValue(undefined),
    markPaidForRun: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const oneTimePayments = { forRun: jest.fn().mockResolvedValue([]) };
  const holds = {
    releasesForRun: jest.fn().mockResolvedValue([]),
    detachReleases: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const reimbursements = {
    claimsForRun: jest.fn().mockResolvedValue([]),
    detachFromRun: jest.fn().mockResolvedValue({ count: 0 }),
    attachToRun: jest.fn().mockResolvedValue(undefined),
    settleForRun: jest.fn().mockResolvedValue([]),
    notifyReimbursed: jest.fn(),
  };
  const settings = {
    get: jest.fn().mockResolvedValue({ reimburseExpensesViaPayroll: false, autoArrears: true }),
  };
  return {
    arrears,
    oneTimePayments,
    holds,
    reimbursements,
    settings,
    providers: [
      { provide: SalaryArrearsService, useValue: arrears },
      { provide: OneTimePaymentsService, useValue: oneTimePayments },
      { provide: SalaryHoldsService, useValue: holds },
      { provide: PayrollReimbursementsService, useValue: reimbursements },
      { provide: PayrollSettingsService, useValue: settings },
    ],
  };
}
