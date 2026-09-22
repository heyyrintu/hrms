import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  LoanStatus,
  LoanType,
  NotificationType,
  RepaymentSource,
  UserRole,
} from '@prisma/client';
import { LoansService } from './loans.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
  mockEmployee,
  mockManager,
  mockHrAdmin,
} from '../../test/helpers';

describe('LoansService', () => {
  let service: LoansService;
  let prisma: any;
  let notifications: any;

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';
  const loanId = 'loan-1';

  /** A stored loan as Prisma would hand it back, Decimals and all. */
  const storedLoan = (overrides: Record<string, unknown> = {}) => ({
    id: loanId,
    tenantId,
    employeeId,
    type: LoanType.LOAN,
    principal: 120000,
    interestRate: 10,
    tenureMonths: 12,
    emiAmount: 11000,
    totalPayable: 132000,
    outstandingAmount: 132000,
    startMonth: 1,
    startYear: 2026,
    purpose: 'Home repair',
    status: LoanStatus.REQUESTED,
    approvedById: null,
    approvedAt: null,
    rejectionReason: null,
    disbursedAt: null,
    closedAt: null,
    createdAt: new Date('2026-01-05T12:00:00Z'),
    updatedAt: new Date('2026-01-05T12:00:00Z'),
    employee: {
      id: employeeId,
      firstName: 'Asha',
      lastName: 'Rao',
      employeeCode: 'E001',
      managerId: mockManager.employeeId,
    },
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);

    // The balance decrement is a conditional updateMany; unless a test says
    // otherwise it matched the row it read.
    prisma.employeeLoan.updateMany.mockResolvedValue({ count: 1 });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // create
  // ============================================
  describe('create', () => {
    beforeEach(() => {
      prisma.employee.findFirst.mockResolvedValue({ id: employeeId });
      prisma.employeeLoan.create.mockResolvedValue(storedLoan());
    });

    it('derives the EMI and total payable from the requested terms', async () => {
      await service.create(tenantId, employeeId, {
        type: LoanType.LOAN,
        principal: 120000,
        interestRate: 10,
        tenureMonths: 12,
        startMonth: 1,
        startYear: 2026,
        purpose: 'Home repair',
      });

      expect(prisma.employeeLoan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            employeeId,
            totalPayable: 132000,
            emiAmount: 11000,
            outstandingAmount: 132000,
            status: LoanStatus.REQUESTED,
          }),
        }),
      );
    });

    it('returns Decimal columns as plain numbers', async () => {
      const result = await service.create(tenantId, employeeId, {
        type: LoanType.LOAN,
        principal: 120000,
        tenureMonths: 12,
        startMonth: 1,
        startYear: 2026,
      });

      expect(typeof result.principal).toBe('number');
      expect(typeof result.outstandingAmount).toBe('number');
      expect(result.totalPayable).toBe(132000);
    });

    it('forces a salary advance to zero interest', async () => {
      await service.create(tenantId, employeeId, {
        type: LoanType.SALARY_ADVANCE,
        principal: 30000,
        tenureMonths: 3,
        startMonth: 1,
        startYear: 2026,
      });

      expect(prisma.employeeLoan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            interestRate: 0,
            totalPayable: 30000,
          }),
        }),
      );
    });

    it('rejects a salary advance that asks for interest', async () => {
      await expect(
        service.create(tenantId, employeeId, {
          type: LoanType.SALARY_ADVANCE,
          principal: 30000,
          interestRate: 5,
          tenureMonths: 3,
          startMonth: 1,
          startYear: 2026,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('caps a salary advance at twelve months', async () => {
      await expect(
        service.create(tenantId, employeeId, {
          type: LoanType.SALARY_ADVANCE,
          principal: 30000,
          tenureMonths: 13,
          startMonth: 1,
          startYear: 2026,
        }),
      ).rejects.toThrow(/between 1 and 12 months/);
    });

    it('allows a loan tenure up to 120 months but not beyond', async () => {
      await expect(
        service.create(tenantId, employeeId, {
          type: LoanType.LOAN,
          principal: 500000,
          tenureMonths: 120,
          startMonth: 1,
          startYear: 2026,
        }),
      ).resolves.toBeDefined();

      await expect(
        service.create(tenantId, employeeId, {
          type: LoanType.LOAN,
          principal: 500000,
          tenureMonths: 121,
          startMonth: 1,
          startYear: 2026,
        }),
      ).rejects.toThrow(/between 1 and 120 months/);
    });

    it('refuses an employee from another tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.create(tenantId, 'somebody-else', {
          type: LoanType.LOAN,
          principal: 1000,
          tenureMonths: 2,
          startMonth: 1,
          startYear: 2026,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('tells HR a request is waiting', async () => {
      await service.create(tenantId, employeeId, {
        type: LoanType.LOAN,
        principal: 120000,
        tenureMonths: 12,
        startMonth: 1,
        startYear: 2026,
      });

      expect(notifications.notifyByRole).toHaveBeenCalledWith(
        tenantId,
        [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN],
        NotificationType.GENERAL,
        'Loan request submitted',
        expect.stringContaining('Asha Rao'),
        '/approvals/loans',
      );
    });
  });

  // ============================================
  // Status transitions
  // ============================================
  describe('status transitions', () => {
    it('approves a REQUESTED loan and stamps the approver', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());
      prisma.employeeLoan.update.mockResolvedValue(
        storedLoan({ status: LoanStatus.APPROVED }),
      );

      await service.approve(tenantId, loanId, 'user-hr');

      expect(prisma.employeeLoan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: loanId },
          data: expect.objectContaining({
            status: LoanStatus.APPROVED,
            approvedById: 'user-hr',
            approvedAt: expect.any(Date),
          }),
        }),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        NotificationType.LOAN_APPROVED,
        'Loan approved',
        expect.any(String),
        '/loans',
      );
    });

    it('refuses to approve a loan that is already APPROVED', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.APPROVED }),
      );

      await expect(service.approve(tenantId, loanId, 'user-hr')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.employeeLoan.update).not.toHaveBeenCalled();
    });

    it('rejects a REQUESTED loan and passes the reason to the employee', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());
      prisma.employeeLoan.update.mockResolvedValue(
        storedLoan({ status: LoanStatus.REJECTED }),
      );

      await service.reject(tenantId, loanId, { reason: 'Existing loan open' });

      expect(prisma.employeeLoan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LoanStatus.REJECTED,
            rejectionReason: 'Existing loan open',
          }),
        }),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        NotificationType.LOAN_REJECTED,
        'Loan rejected',
        'Existing loan open',
        '/loans',
      );
    });

    it('disburses an APPROVED loan into ACTIVE', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.APPROVED }),
      );
      prisma.employeeLoan.update.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE }),
      );

      await service.disburse(tenantId, loanId);

      expect(prisma.employeeLoan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LoanStatus.ACTIVE,
            disbursedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('refuses to disburse a loan that was never approved', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());

      await expect(service.disburse(tenantId, loanId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('cancels the borrower-s own REQUESTED loan', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());
      prisma.employeeLoan.update.mockResolvedValue(
        storedLoan({ status: LoanStatus.CANCELLED }),
      );

      await service.cancel(tenantId, loanId, employeeId);

      expect(prisma.employeeLoan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: LoanStatus.CANCELLED },
        }),
      );
    });

    it('will not let one employee cancel another-s request', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());

      await expect(
        service.cancel(tenantId, loanId, 'someone-else'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('will not cancel a loan that is already ACTIVE', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE }),
      );

      await expect(
        service.cancel(tenantId, loanId, employeeId),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s on a loan belonging to another tenant', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(null);

      await expect(service.approve(tenantId, loanId, 'u')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================
  // Listing and scoping
  // ============================================
  describe('findAll', () => {
    beforeEach(() => {
      prisma.employeeLoan.findMany.mockResolvedValue([storedLoan()]);
      prisma.employeeLoan.count.mockResolvedValue(1);
    });

    it('gives HR the whole tenant', async () => {
      await service.findAll(
        tenantId,
        mockHrAdmin.employeeId,
        UserRole.HR_ADMIN,
        {},
      );

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
    });

    it('limits a manager to their direct reports', async () => {
      await service.findAll(
        tenantId,
        mockManager.employeeId,
        UserRole.MANAGER,
        {},
      );

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            employee: { managerId: mockManager.employeeId },
          },
        }),
      );
    });

    it('refuses a manager with no employee record rather than listing everyone', async () => {
      await expect(
        service.findAll(tenantId, undefined, UserRole.MANAGER, {}),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.employeeLoan.findMany).not.toHaveBeenCalled();
    });

    it('applies the status and employee filters', async () => {
      await service.findAll(tenantId, undefined, UserRole.HR_ADMIN, {
        status: LoanStatus.ACTIVE,
        employeeId: 'emp-9',
      });

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            status: LoanStatus.ACTIVE,
            employeeId: 'emp-9',
          },
        }),
      );
    });

    it('scopes findMy to the caller', async () => {
      await service.findMy(tenantId, employeeId, {});

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, employeeId } }),
      );
    });
  });

  describe('findById', () => {
    it('returns the loan with its repayments and schedule', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue({
        ...storedLoan({ status: LoanStatus.ACTIVE }),
        repayments: [
          {
            id: 'r1',
            loanId,
            month: 1,
            year: 2026,
            amount: 11000,
            source: RepaymentSource.PAYROLL,
          },
        ],
      });

      const result = await service.findById(
        tenantId,
        loanId,
        employeeId,
        UserRole.EMPLOYEE,
      );

      expect(result.schedule).toHaveLength(12);
      expect(result.schedule[0]).toMatchObject({ month: 1, year: 2026, emi: 11000 });
      expect(result.repayments[0].amount).toBe(11000);
    });

    it('lets the borrower-s manager read it', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue({
        ...storedLoan(),
        repayments: [],
      });

      await expect(
        service.findById(
          tenantId,
          loanId,
          mockManager.employeeId,
          UserRole.MANAGER,
        ),
      ).resolves.toBeDefined();
    });

    it('refuses an unrelated employee', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue({
        ...storedLoan(),
        repayments: [],
      });

      await expect(
        service.findById(tenantId, loanId, 'emp-stranger', UserRole.EMPLOYEE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404s when the loan is not in the tenant', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(null);

      await expect(
        service.findById(tenantId, loanId, employeeId, UserRole.HR_ADMIN),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================
  // getPayrollDeductions
  // ============================================
  describe('getPayrollDeductions', () => {
    it('returns the instalment for a month the schedule covers', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        { ...storedLoan({ status: LoanStatus.ACTIVE }), repayments: [] },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        3,
        2026,
      );

      expect(result).toEqual({
        total: 11000,
        lines: [{ loanId, type: LoanType.LOAN, amount: 11000 }],
      });
    });

    it('only considers ACTIVE loans', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([]);

      await service.getPayrollDeductions(tenantId, employeeId, 3, 2026);

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, employeeId, status: LoanStatus.ACTIVE },
        }),
      );
    });

    it('skips a month payroll has already repaid', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({ status: LoanStatus.ACTIVE }),
          repayments: [{ id: 'already-paid' }],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        3,
        2026,
      );

      expect(result).toEqual({ total: 0, lines: [] });
    });

    it('proposes nothing for a month before the loan starts', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        { ...storedLoan({ status: LoanStatus.ACTIVE }), repayments: [] },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        12,
        2025,
      );

      expect(result).toEqual({ total: 0, lines: [] });
    });

    // The net-pay clamp in payroll reduces an instalment rather than deferring
    // it, so a short month leaves a residual the schedule has no row for.
    // Without arrears the loan would finish its tenure ACTIVE and never be
    // collected again.
    it('collects arrears past the tenure when a balance survives', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({
            status: LoanStatus.ACTIVE,
            outstandingAmount: 4000,
          }),
          repayments: [],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        3,
        2027,
      );

      expect(result).toEqual({
        total: 4000,
        lines: [{ loanId, type: LoanType.LOAN, amount: 4000 }],
      });
    });

    it('caps an arrears catch-up at one EMI', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({
            status: LoanStatus.ACTIVE,
            outstandingAmount: 30000,
          }),
          repayments: [],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        3,
        2027,
      );

      expect(result).toEqual({
        total: 11000,
        lines: [{ loanId, type: LoanType.LOAN, amount: 11000 }],
      });
    });

    it('proposes nothing past the tenure once the balance is clear', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({
            status: LoanStatus.ACTIVE,
            outstandingAmount: 0,
          }),
          repayments: [],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        3,
        2027,
      );

      expect(result).toEqual({ total: 0, lines: [] });
    });

    it('still respects idempotency in an arrears month', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({
            status: LoanStatus.ACTIVE,
            outstandingAmount: 4000,
          }),
          repayments: [{ id: 'already-paid' }],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        3,
        2027,
      );

      expect(result).toEqual({ total: 0, lines: [] });
    });

    // A scheduled month catches up a short prior month only as far as the
    // schedule's own EMI; the residual beyond that rolls into arrears.
    it('caps a scheduled month at the outstanding balance', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({
            status: LoanStatus.ACTIVE,
            outstandingAmount: 6500,
          }),
          repayments: [],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        3,
        2026,
      );

      expect(result).toEqual({
        total: 6500,
        lines: [{ loanId, type: LoanType.LOAN, amount: 6500 }],
      });
    });

    it('never deducts more than is outstanding', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({
            status: LoanStatus.ACTIVE,
            outstandingAmount: 2500,
          }),
          repayments: [],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        4,
        2026,
      );

      expect(result.lines[0].amount).toBe(2500);
      expect(result.total).toBe(2500);
    });

    it('totals several loans in the same month', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        { ...storedLoan({ status: LoanStatus.ACTIVE }), repayments: [] },
        {
          ...storedLoan({
            id: 'loan-2',
            type: LoanType.SALARY_ADVANCE,
            principal: 30000,
            interestRate: 0,
            tenureMonths: 3,
            emiAmount: 10000,
            totalPayable: 30000,
            outstandingAmount: 30000,
            status: LoanStatus.ACTIVE,
          }),
          repayments: [],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        2,
        2026,
      );

      expect(result.total).toBe(21000);
      expect(result.lines).toEqual([
        { loanId, type: LoanType.LOAN, amount: 11000 },
        { loanId: 'loan-2', type: LoanType.SALARY_ADVANCE, amount: 10000 },
      ]);
    });
  });

  // ============================================
  // recordPayrollRepayments
  // ============================================
  describe('recordPayrollRepayments', () => {
    it('writes the repayment row and decrements the balance', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE }),
      ]);

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [{ loanId, amount: 11000 }],
      );

      expect(prisma.loanRepayment.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          loanId,
          month: 3,
          year: 2026,
          amount: 11000,
          source: RepaymentSource.PAYROLL,
          payslipId: 'payslip-1',
        },
      });
      expect(prisma.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 132000 },
        data: { outstandingAmount: 121000 },
      });
    });

    it('closes the loan when the balance reaches zero and tells the employee', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 11000 }),
      ]);

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        12,
        2026,
        'payslip-12',
        [{ loanId, amount: 11000 }],
      );

      expect(prisma.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 11000 },
        data: expect.objectContaining({
          outstandingAmount: 0,
          status: LoanStatus.CLOSED,
          closedAt: expect.any(Date),
        }),
      });
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        NotificationType.GENERAL,
        'Loan closed',
        expect.stringContaining('fully repaid'),
        '/loans',
      );
    });

    it('does not close a loan that still has a balance', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE }),
      ]);

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [{ loanId, amount: 11000 }],
      );

      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('caps the write at the outstanding balance', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 500 }),
      ]);

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        12,
        2026,
        'payslip-12',
        [{ loanId, amount: 11000 }],
      );

      expect(prisma.loanRepayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 500 }),
        }),
      );
    });

    it('silently skips a loan that is not this employee-s active loan', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([]);

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [{ loanId: 'not-mine', amount: 500 }],
      );

      expect(prisma.loanRepayment.create).not.toHaveBeenCalled();
      expect(prisma.employeeLoan.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing at all when there are no lines', async () => {
      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [],
      );

      expect(prisma.employeeLoan.findMany).not.toHaveBeenCalled();
    });

    it('scopes the loan lookup to the tenant and employee', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([]);

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [{ loanId, amount: 1 }],
      );

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [loanId] },
          tenantId,
          employeeId,
          status: LoanStatus.ACTIVE,
        },
      });
    });
    // ------------------------------------------
    // Idempotency: payroll retries the same month
    // ------------------------------------------

    it('checks for an existing PAYROLL row before writing, scoped by tenant', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE }),
      ]);
      prisma.loanRepayment.findFirst.mockResolvedValue(null);

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [{ loanId, amount: 11000 }],
      );

      expect(prisma.loanRepayment.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          loanId,
          month: 3,
          year: 2026,
          source: RepaymentSource.PAYROLL,
        },
        select: { id: true },
      });
    });

    it('is a no-op on a second run for the same month', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE }),
      ]);
      // The first run already wrote this instalment.
      prisma.loanRepayment.findFirst.mockResolvedValue({ id: 'already-written' });

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [{ loanId, amount: 11000 }],
      );

      expect(prisma.loanRepayment.create).not.toHaveBeenCalled();
      expect(prisma.employeeLoan.updateMany).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('inserts only the lines that are missing on a mixed retry', async () => {
      const secondLoanId = 'loan-2';
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE }),
        storedLoan({
          id: secondLoanId,
          status: LoanStatus.ACTIVE,
          outstandingAmount: 30000,
          emiAmount: 10000,
        }),
      ]);
      // The first loan was written last time; the second was not.
      prisma.loanRepayment.findFirst.mockImplementation(async ({ where }: any) =>
        where.loanId === loanId ? { id: 'already-written' } : null,
      );

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [
          { loanId, amount: 11000 },
          { loanId: secondLoanId, amount: 10000 },
        ],
      );

      expect(prisma.loanRepayment.create).toHaveBeenCalledTimes(1);
      expect(prisma.loanRepayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ loanId: secondLoanId, amount: 10000 }),
      });
      expect(prisma.employeeLoan.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: secondLoanId, tenantId, outstandingAmount: 30000 },
        data: { outstandingAmount: 20000 },
      });
    });

    it('rolls back rather than losing a decrement when the balance moved', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE }),
      ]);
      prisma.loanRepayment.findFirst.mockResolvedValue(null);
      // Somebody else changed the balance between the read and the write.
      prisma.employeeLoan.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordPayrollRepayments(
          tenantId,
          employeeId,
          3,
          2026,
          'payslip-1',
          [{ loanId, amount: 11000 }],
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('does every write inside one transaction', async () => {
      const order: string[] = [];
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE }),
      ]);
      prisma.loanRepayment.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: any) => {
        order.push('tx:start');
        const result = await cb(prisma);
        order.push('tx:end');
        return result;
      });
      prisma.loanRepayment.create.mockImplementation(async () => {
        order.push('create');
        return { id: 'r1', amount: 11000 };
      });
      prisma.employeeLoan.updateMany.mockImplementation(async () => {
        order.push('updateMany');
        return { count: 1 };
      });

      await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        3,
        2026,
        'payslip-1',
        [{ loanId, amount: 11000 }],
      );

      expect(order).toEqual(['tx:start', 'create', 'updateMany', 'tx:end']);
    });
  });

  // ============================================
  // recordRepayment (manual)
  // ============================================
  describe('recordRepayment', () => {
    it('writes a MANUAL repayment and decrements the balance', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE }),
      );
      prisma.loanRepayment.findFirst.mockResolvedValue(null);
      prisma.loanRepayment.create.mockResolvedValue({
        id: 'r1',
        amount: 5000,
      });

      const result = await service.recordRepayment(tenantId, loanId, {
        month: 3,
        year: 2026,
        amount: 5000,
        note: 'NEFT ref 123',
      });

      expect(prisma.loanRepayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: RepaymentSource.MANUAL,
          amount: 5000,
          note: 'NEFT ref 123',
        }),
      });
      expect(prisma.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 132000 },
        data: { outstandingAmount: 127000 },
      });
      expect(result.amount).toBe(5000);
    });

    it('refuses a repayment against a loan that is not active', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());

      await expect(
        service.recordRepayment(tenantId, loanId, {
          month: 3,
          year: 2026,
          amount: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an amount larger than the outstanding balance', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 1000 }),
      );

      await expect(
        service.recordRepayment(tenantId, loanId, {
          month: 3,
          year: 2026,
          amount: 1001,
        }),
      ).rejects.toThrow(/exceeds the outstanding balance/);
    });

    it('refuses a second manual repayment for the same month', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE }),
      );
      prisma.loanRepayment.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.recordRepayment(tenantId, loanId, {
          month: 3,
          year: 2026,
          amount: 100,
        }),
      ).rejects.toThrow(/already recorded/);
    });

    it('closes the loan when a manual repayment clears the balance', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 500 }),
      );
      prisma.loanRepayment.findFirst.mockResolvedValue(null);
      prisma.loanRepayment.create.mockResolvedValue({ id: 'r1', amount: 500 });

      await service.recordRepayment(tenantId, loanId, {
        month: 12,
        year: 2026,
        amount: 500,
      });

      expect(prisma.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 500 },
        data: expect.objectContaining({
          outstandingAmount: 0,
          status: LoanStatus.CLOSED,
        }),
      });
    });
    it('does the duplicate check and both writes inside one transaction', async () => {
      const order: string[] = [];
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE }),
      );
      prisma.$transaction.mockImplementation(async (cb: any) => {
        order.push('tx:start');
        const result = await cb(prisma);
        order.push('tx:end');
        return result;
      });
      prisma.loanRepayment.findFirst.mockImplementation(async () => {
        order.push('findFirst');
        return null;
      });
      prisma.loanRepayment.create.mockImplementation(async () => {
        order.push('create');
        return { id: 'r1', amount: 5000 };
      });
      prisma.employeeLoan.updateMany.mockImplementation(async () => {
        order.push('updateMany');
        return { count: 1 };
      });

      await service.recordRepayment(tenantId, loanId, {
        month: 3,
        year: 2026,
        amount: 5000,
      });

      expect(order).toEqual([
        'tx:start',
        'findFirst',
        'create',
        'updateMany',
        'tx:end',
      ]);
    });

    it('scopes the duplicate check to the tenant', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE }),
      );
      prisma.loanRepayment.findFirst.mockResolvedValue(null);
      prisma.loanRepayment.create.mockResolvedValue({ id: 'r1', amount: 5000 });

      await service.recordRepayment(tenantId, loanId, {
        month: 3,
        year: 2026,
        amount: 5000,
      });

      expect(prisma.loanRepayment.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          loanId,
          month: 3,
          year: 2026,
          source: RepaymentSource.MANUAL,
        },
        select: { id: true },
      });
    });

    it('refuses rather than losing the decrement when the balance moved', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.ACTIVE }),
      );
      prisma.loanRepayment.findFirst.mockResolvedValue(null);
      prisma.loanRepayment.create.mockResolvedValue({ id: 'r1', amount: 5000 });
      prisma.employeeLoan.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordRepayment(tenantId, loanId, {
          month: 3,
          year: 2026,
          amount: 5000,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ============================================
  // buildSchedule passthrough
  // ============================================
  describe('buildSchedule', () => {
    it('reads the terms off a stored loan', () => {
      const rows = service.buildSchedule(storedLoan() as any);

      expect(rows).toHaveLength(12);
      expect(rows[0]).toMatchObject({ month: 1, year: 2026, emi: 11000 });
      expect(rows[11].balanceAfter).toBe(0);
    });
  });

  // fixtures used to keep the linter honest about unused imports
  it('uses the shared user fixtures', () => {
    expect(mockEmployee.employeeId).toBeDefined();
  });
  // ============================================
  // clearPayrollRepayments
  // ============================================

  describe('clearPayrollRepayments', () => {
    it('does nothing when the month recorded no payroll repayments', async () => {
      prisma.loanRepayment.findMany.mockResolvedValue([]);

      await service.clearPayrollRepayments(tenantId, 3, 2026);

      expect(prisma.loanRepayment.delete).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('asks only for the payroll-sourced rows of that month', async () => {
      prisma.loanRepayment.findMany.mockResolvedValue([]);

      await service.clearPayrollRepayments(tenantId, 3, 2026);

      expect(prisma.loanRepayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            month: 3,
            year: 2026,
            source: RepaymentSource.PAYROLL,
          },
        }),
      );
    });

    it('deletes the row and gives the balance back, guarded on what it read', async () => {
      prisma.loanRepayment.findMany.mockResolvedValue([
        {
          id: 'rep-1',
          loanId,
          amount: 11000,
          loan: {
            id: loanId,
            outstandingAmount: 121000,
            status: LoanStatus.ACTIVE,
          },
        },
      ]);

      await service.clearPayrollRepayments(tenantId, 3, 2026);

      expect(prisma.loanRepayment.delete).toHaveBeenCalledWith({
        where: { id: 'rep-1' },
      });
      expect(prisma.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 121000 },
        data: { outstandingAmount: 132000 },
      });
    });

    it('reopens a loan that this repayment closed, or payroll never looks at it again', async () => {
      prisma.loanRepayment.findMany.mockResolvedValue([
        {
          id: 'rep-12',
          loanId,
          amount: 11000,
          loan: { id: loanId, outstandingAmount: 0, status: LoanStatus.CLOSED },
        },
      ]);

      await service.clearPayrollRepayments(tenantId, 12, 2026);

      expect(prisma.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 0 },
        data: {
          outstandingAmount: 11000,
          status: LoanStatus.ACTIVE,
          closedAt: null,
        },
      });
    });

    it('throws a 409 when the balance moved while the reversal was in flight', async () => {
      prisma.loanRepayment.findMany.mockResolvedValue([
        {
          id: 'rep-1',
          loanId,
          amount: 11000,
          loan: {
            id: loanId,
            outstandingAmount: 121000,
            status: LoanStatus.ACTIVE,
          },
        },
      ]);
      prisma.employeeLoan.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.clearPayrollRepayments(tenantId, 3, 2026),
      ).rejects.toThrow(ConflictException);
    });
  });
});
