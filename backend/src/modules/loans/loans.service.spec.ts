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
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
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
  let webhooks: { dispatch: jest.Mock };

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
    webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
        { provide: WebhookDispatcherService, useValue: webhooks },
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

    it('fires loan.approved once the approval has committed', async () => {
      const approvedAt = new Date('2026-02-10T12:00:00Z');
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());
      prisma.employeeLoan.update.mockResolvedValue(
        storedLoan({ status: LoanStatus.APPROVED, approvedAt }),
      );

      await service.approve(tenantId, loanId, 'user-hr');

      expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
      expect(webhooks.dispatch).toHaveBeenCalledWith(tenantId, 'loan.approved', {
        loanId,
        employeeId,
        type: LoanType.LOAN,
        amount: 120000,
        emi: 11000,
        tenureMonths: 12,
        approvedAt: approvedAt.toISOString(),
      });
      // Dispatched after the write, never before it.
      expect(
        prisma.employeeLoan.update.mock.invocationCallOrder[0],
      ).toBeLessThan(webhooks.dispatch.mock.invocationCallOrder[0]);
    });

    it('carries no free text such as the purpose in the webhook payload', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());
      prisma.employeeLoan.update.mockResolvedValue(
        storedLoan({ status: LoanStatus.APPROVED, approvedAt: new Date() }),
      );

      await service.approve(tenantId, loanId, 'user-hr');

      const payload = webhooks.dispatch.mock.calls[0][2];
      expect(payload).not.toHaveProperty('purpose');
      expect(payload).not.toHaveProperty('employee');
      expect(JSON.stringify(payload)).not.toContain('Home repair');
    });

    it('still answers the approval when the webhook dispatch rejects', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(storedLoan());
      prisma.employeeLoan.update.mockResolvedValue(
        storedLoan({ status: LoanStatus.APPROVED, approvedAt: new Date() }),
      );
      webhooks.dispatch.mockRejectedValue(new Error('endpoint down'));

      await expect(
        service.approve(tenantId, loanId, 'user-hr'),
      ).resolves.toMatchObject({ status: LoanStatus.APPROVED });
    });

    it('does not fire loan.approved when the transition is refused', async () => {
      prisma.employeeLoan.findFirst.mockResolvedValue(
        storedLoan({ status: LoanStatus.APPROVED }),
      );

      await expect(
        service.approve(tenantId, loanId, 'user-hr'),
      ).rejects.toThrow(BadRequestException);
      expect(webhooks.dispatch).not.toHaveBeenCalled();
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

    describe('arrears', () => {
      afterEach(() => jest.useRealTimers());

      const payroll = (month: number, year: number, amount: number) => ({
        id: `r-${year}-${month}`,
        loanId,
        month,
        year,
        amount,
        source: RepaymentSource.PAYROLL,
      });

      it('explains a clamped EMI as an instalment after the tenure ends', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00Z'));
        // February's net pay only stretched to 5000 of the 11000 EMI.
        prisma.employeeLoan.findFirst.mockResolvedValue({
          ...storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 116000 }),
          repayments: [payroll(1, 2026, 11000), payroll(2, 2026, 5000)],
        });

        const result = await service.findById(
          tenantId,
          loanId,
          employeeId,
          UserRole.EMPLOYEE,
        );

        expect(result.arrears).toEqual({
          amount: 6000,
          instalments: [{ month: 1, year: 2027, amount: 6000 }],
        });
      });

      it('reports none for a loan on schedule', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00Z'));
        prisma.employeeLoan.findFirst.mockResolvedValue({
          ...storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 110000 }),
          repayments: [payroll(1, 2026, 11000), payroll(2, 2026, 11000)],
        });

        const result = await service.findById(
          tenantId,
          loanId,
          employeeId,
          UserRole.EMPLOYEE,
        );

        expect(result.arrears).toEqual({ amount: 0, instalments: [] });
      });

      it('is null for a loan payroll is not collecting', async () => {
        prisma.employeeLoan.findFirst.mockResolvedValue({
          ...storedLoan({ status: LoanStatus.REQUESTED }),
          repayments: [],
        });

        const result = await service.findById(
          tenantId,
          loanId,
          employeeId,
          UserRole.EMPLOYEE,
        );

        expect(result.arrears).toBeNull();
      });
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

    it('considers ACTIVE loans, and CLOSED ones only when this month-s payroll closed them', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([]);

      await service.getPayrollDeductions(tenantId, employeeId, 3, 2026);

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            employeeId,
            OR: [
              { status: LoanStatus.ACTIVE },
              {
                status: LoanStatus.CLOSED,
                repayments: {
                  some: { month: 3, year: 2026, source: RepaymentSource.PAYROLL },
                },
              },
            ],
          },
        }),
      );
    });

    // Every caller reverses this month's payroll rows inside the same
    // transaction that re-records them, so the figure computed here has to be
    // the one that holds once that reversal has happened — not "nothing,
    // because a row exists" as it was when the reversal committed separately.
    it('reads a month payroll already repaid as if that repayment were reversed', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 121000 }),
          repayments: [{ id: 'already-paid', amount: 11000 }],
        },
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

    it('reopens, for the calculation, a loan this month-s payroll closed', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({ status: LoanStatus.CLOSED, outstandingAmount: 0 }),
          repayments: [{ id: 'closing-row', amount: 11000 }],
        },
      ]);

      const result = await service.getPayrollDeductions(
        tenantId,
        employeeId,
        12,
        2026,
      );

      expect(result).toEqual({
        total: 11000,
        lines: [{ loanId, type: LoanType.LOAN, amount: 11000 }],
      });
    });

    it('asks for the amount of this month-s payroll rows, not just their ids', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([]);

      await service.getPayrollDeductions(tenantId, employeeId, 3, 2026);

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            repayments: {
              where: { month: 3, year: 2026, source: RepaymentSource.PAYROLL },
              select: { id: true, amount: true },
            },
          },
        }),
      );
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

    it('re-derives an arrears month from the balance before its own payroll row', async () => {
      // 4000 was left, this month's run took all of it; a recompute must
      // propose the same 4000 again rather than nothing (or double it).
      prisma.employeeLoan.findMany.mockResolvedValue([
        {
          ...storedLoan({
            status: LoanStatus.CLOSED,
            outstandingAmount: 0,
          }),
          repayments: [{ id: 'already-paid', amount: 4000 }],
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

    it('runs entirely on a caller-s transaction and leaves the telling to the caller', async () => {
      const tx: any = createMockPrismaService();
      tx.employeeLoan.updateMany.mockResolvedValue({ count: 1 });
      tx.loanRepayment.findFirst.mockResolvedValue(null);
      tx.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 11000 }),
      ]);

      const closed = await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        12,
        2026,
        'payslip-12',
        [{ loanId, amount: 11000 }],
        tx,
      );

      // The loans are read inside the transaction, after its own reversal.
      expect(tx.employeeLoan.findMany).toHaveBeenCalled();
      expect(prisma.employeeLoan.findMany).not.toHaveBeenCalled();
      expect(tx.loanRepayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ loanId, amount: 11000, payslipId: 'payslip-12' }),
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.$transaction).not.toHaveBeenCalled();
      // Nothing is announced from inside an uncommitted transaction.
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
      expect(closed).toEqual([expect.objectContaining({ id: loanId, employeeId })]);
    });

    // ------------------------------------------
    // Inside payroll's transaction: the payslip already deducts the line, so
    // the loan must be credited exactly that — or the run must roll back.
    // ------------------------------------------

    describe('on payroll-s transaction', () => {
      let tx: any;
      beforeEach(() => {
        tx = createMockPrismaService();
        tx.employeeLoan.updateMany.mockResolvedValue({ count: 1 });
        tx.loanRepayment.findFirst.mockResolvedValue(null);
      });

      const record = (lines: { loanId: string; amount: number }[]) =>
        service.recordPayrollRepayments(
          tenantId,
          employeeId,
          3,
          2026,
          'payslip-3',
          lines,
          tx,
        );

      it('refuses (409) when the loan was closed while payroll was calculating, e.g. by a settlement', async () => {
        // The read is scoped to ACTIVE loans, so a loan a settlement closed
        // mid-calculation simply is not there any more.
        tx.employeeLoan.findMany.mockResolvedValue([]);

        const attempt = record([{ loanId, amount: 11000 }]);

        await expect(attempt).rejects.toThrow(ConflictException);
        await expect(attempt).rejects.toThrow(/re-run/i);
        expect(tx.loanRepayment.create).not.toHaveBeenCalled();
        expect(tx.employeeLoan.updateMany).not.toHaveBeenCalled();
      });

      it('refuses (409) when the payslip deducts more than the loan still owes', async () => {
        // Outstanding 1500, EMI 1000 computed; a manual 1000 landed during the
        // calculation. Crediting 500 against a 1000 deduction is the bug.
        tx.employeeLoan.findMany.mockResolvedValue([
          storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 500 }),
        ]);

        const attempt = record([{ loanId, amount: 1000 }]);

        await expect(attempt).rejects.toThrow(ConflictException);
        await expect(attempt).rejects.toThrow(/re-run/i);
        expect(tx.loanRepayment.create).not.toHaveBeenCalled();
        expect(tx.employeeLoan.updateMany).not.toHaveBeenCalled();
      });

      it('credits exactly the deducted amount when it is the whole balance', async () => {
        tx.employeeLoan.findMany.mockResolvedValue([
          storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 1000 }),
        ]);

        await record([{ loanId, amount: 1000 }]);

        expect(tx.loanRepayment.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ loanId, amount: 1000 }),
        });
      });
    });

    it('returns the loans it closed when it owns the transaction too', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 11000 }),
      ]);
      prisma.loanRepayment.findFirst.mockResolvedValue(null);

      const closed = await service.recordPayrollRepayments(
        tenantId,
        employeeId,
        12,
        2026,
        'payslip-12',
        [{ loanId, amount: 11000 }],
      );

      expect(closed).toEqual([expect.objectContaining({ id: loanId })]);
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
  // Final settlement contract
  // ============================================
  describe('getOutstandingForSettlement', () => {
    it('lists the leaver-s active balances oldest first, as plain numbers', async () => {
      prisma.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 66000 }),
        storedLoan({
          id: 'loan-2',
          type: LoanType.SALARY_ADVANCE,
          status: LoanStatus.ACTIVE,
          outstandingAmount: 0,
        }),
      ]);

      const result = await service.getOutstandingForSettlement(tenantId, employeeId);

      expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith({
        where: { tenantId, employeeId, status: LoanStatus.ACTIVE },
        orderBy: { createdAt: 'asc' },
      });
      // A zero balance is not a recovery.
      expect(result).toEqual([
        { loanId, type: LoanType.LOAN, outstanding: 66000 },
      ]);
    });
  });

  describe('recordSettlementRepayments', () => {
    let tx: any;
    const input = (overrides: Record<string, unknown> = {}) => ({
      tenantId,
      employeeId,
      settlementId: 'stl-1',
      month: 3,
      year: 2026,
      lines: [{ loanId, amount: 66000, outstandingAtCompute: 66000 }],
      ...overrides,
    });

    beforeEach(() => {
      tx = createMockPrismaService();
      tx.employeeLoan.updateMany.mockResolvedValue({ count: 1 });
      tx.loanRepayment.findFirst.mockResolvedValue(null);
      tx.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 66000 }),
      ]);
    });

    it('writes a SETTLEMENT repayment and closes the loan it clears, on the caller-s transaction', async () => {
      const result = await service.recordSettlementRepayments(tx, input());

      expect(tx.loanRepayment.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          loanId,
          month: 3,
          year: 2026,
          amount: 66000,
          source: RepaymentSource.SETTLEMENT,
          note: 'Recovered from final settlement stl-1',
        },
      });
      expect(tx.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 66000 },
        data: expect.objectContaining({
          outstandingAmount: 0,
          status: LoanStatus.CLOSED,
        }),
      });
      expect(result.closed).toEqual([
        { id: loanId, employeeId, type: LoanType.LOAN },
      ]);
      // Everything through the caller's transaction, nothing of its own.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.loanRepayment.create).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('leaves a partly recovered loan active with what is still owed', async () => {
      await service.recordSettlementRepayments(
        tx,
        input({ lines: [{ loanId, amount: 40000, outstandingAtCompute: 66000 }] }),
      );

      expect(tx.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 66000 },
        data: { outstandingAmount: 26000 },
      });
    });

    it('writes nothing for a line the settlement could not recover at all', async () => {
      const result = await service.recordSettlementRepayments(
        tx,
        input({ lines: [{ loanId, amount: 0, outstandingAtCompute: 66000 }] }),
      );

      expect(tx.loanRepayment.create).not.toHaveBeenCalled();
      expect(result.closed).toEqual([]);
    });

    it('is idempotent: a loan already recovered by this settlement is skipped', async () => {
      tx.loanRepayment.findFirst.mockResolvedValue({ id: 'already' });
      // Its balance has since moved to zero; that must not read as a conflict.
      tx.employeeLoan.findMany.mockResolvedValue([]);

      await service.recordSettlementRepayments(tx, input());

      expect(tx.loanRepayment.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          loanId,
          month: 3,
          year: 2026,
          source: RepaymentSource.SETTLEMENT,
        },
        select: { id: true },
      });
      expect(tx.loanRepayment.create).not.toHaveBeenCalled();
      expect(tx.employeeLoan.updateMany).not.toHaveBeenCalled();
    });

    it('refuses when a balance moved since the settlement was computed', async () => {
      // Payroll took an EMI after the settlement was worked out.
      tx.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 55000 }),
      ]);

      await expect(
        service.recordSettlementRepayments(tx, input()),
      ).rejects.toThrow(ConflictException);
      expect(tx.loanRepayment.create).not.toHaveBeenCalled();
    });

    it('refuses when a loan was disbursed after the settlement was computed', async () => {
      tx.employeeLoan.findMany.mockResolvedValue([
        storedLoan({ status: LoanStatus.ACTIVE, outstandingAmount: 66000 }),
        storedLoan({ id: 'loan-new', status: LoanStatus.ACTIVE, outstandingAmount: 5000 }),
      ]);

      await expect(
        service.recordSettlementRepayments(tx, input()),
      ).rejects.toThrow(/recompute/i);
    });

    it('refuses when a loan the settlement recovers is no longer active', async () => {
      tx.employeeLoan.findMany.mockResolvedValue([]);

      await expect(
        service.recordSettlementRepayments(tx, input()),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a legacy settlement with no loan lines when the leaver owes a loan', async () => {
      await expect(
        service.recordSettlementRepayments(tx, input({ lines: [] })),
      ).rejects.toThrow(ConflictException);
    });

    it('rolls back rather than losing a decrement when the balance moved mid-write', async () => {
      tx.employeeLoan.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.recordSettlementRepayments(tx, input()),
      ).rejects.toThrow(ConflictException);
    });

    it('scopes the loan read to the tenant and the leaver', async () => {
      await service.recordSettlementRepayments(tx, input());

      expect(tx.employeeLoan.findMany).toHaveBeenCalledWith({
        where: { tenantId, employeeId, status: LoanStatus.ACTIVE },
      });
    });
  });

  describe('notifyLoansClosed', () => {
    it('tells each borrower their loan or advance was fully repaid', async () => {
      await service.notifyLoansClosed(tenantId, [
        { id: loanId, employeeId, type: LoanType.LOAN },
        { id: 'loan-2', employeeId: 'emp-2', type: LoanType.SALARY_ADVANCE },
      ]);

      expect(notifications.notifyEmployee).toHaveBeenCalledTimes(2);
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        'emp-2',
        NotificationType.GENERAL,
        'Loan closed',
        expect.stringContaining('salary advance'),
        '/loans',
      );
    });

    it('does nothing for an empty or missing list', async () => {
      await service.notifyLoansClosed(tenantId, []);
      await service.notifyLoansClosed(tenantId, undefined as any);

      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
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

    it('runs entirely on a caller-s transaction when one is passed', async () => {
      const tx: any = createMockPrismaService();
      tx.employeeLoan.updateMany.mockResolvedValue({ count: 1 });
      tx.loanRepayment.findMany.mockResolvedValue([
        {
          id: 'rep-1',
          loanId,
          amount: 11000,
          loan: { id: loanId, outstandingAmount: 121000, status: LoanStatus.ACTIVE },
        },
      ]);

      await service.clearPayrollRepayments(tenantId, 3, 2026, tx);

      // Read inside the caller's transaction, so the balance it restores from
      // is the one that transaction will commit against.
      expect(tx.loanRepayment.findMany).toHaveBeenCalled();
      expect(tx.loanRepayment.delete).toHaveBeenCalledWith({ where: { id: 'rep-1' } });
      expect(tx.employeeLoan.updateMany).toHaveBeenCalledWith({
        where: { id: loanId, tenantId, outstandingAmount: 121000 },
        data: { outstandingAmount: 132000 },
      });
      // No second, nested transaction and nothing through the root client.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.$transaction).not.toHaveBeenCalled();
      expect(prisma.loanRepayment.findMany).not.toHaveBeenCalled();
      expect(prisma.employeeLoan.updateMany).not.toHaveBeenCalled();
    });

    describe('after a final settlement', () => {
      const payrollRow = {
        id: 'rep-9',
        loanId,
        amount: 11000,
        loan: { id: loanId, outstandingAmount: 0, status: LoanStatus.CLOSED },
      };

      it('refuses (409) to reopen a loan a settlement at or after that month recovered', async () => {
        prisma.loanRepayment.findMany.mockResolvedValue([payrollRow]);
        prisma.loanRepayment.findFirst.mockResolvedValue({
          id: 'settle-1',
          loanId,
          month: 9,
          year: 2026,
        });

        const attempt = service.clearPayrollRepayments(tenantId, 9, 2026);

        await expect(attempt).rejects.toThrow(ConflictException);
        await expect(attempt).rejects.toThrow(/settlement/i);
        expect(prisma.loanRepayment.delete).not.toHaveBeenCalled();
        expect(prisma.employeeLoan.updateMany).not.toHaveBeenCalled();
      });

      it('looks for settlement rows of those loans, in the tenant, from that month on', async () => {
        prisma.loanRepayment.findMany.mockResolvedValue([payrollRow]);
        prisma.loanRepayment.findFirst.mockResolvedValue(null);

        await service.clearPayrollRepayments(tenantId, 9, 2026);

        expect(prisma.loanRepayment.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              tenantId,
              loanId: { in: [loanId] },
              source: RepaymentSource.SETTLEMENT,
              OR: [{ year: { gt: 2026 } }, { year: 2026, month: { gte: 9 } }],
            },
          }),
        );
        // No settlement: the reversal goes ahead.
        expect(prisma.loanRepayment.delete).toHaveBeenCalledWith({
          where: { id: 'rep-9' },
        });
      });

      it('checks through the caller-s transaction when one is passed', async () => {
        const tx: any = createMockPrismaService();
        tx.loanRepayment.findMany.mockResolvedValue([payrollRow]);
        tx.loanRepayment.findFirst.mockResolvedValue({ id: 'settle-1', loanId });

        await expect(
          service.clearPayrollRepayments(tenantId, 9, 2026, tx),
        ).rejects.toThrow(ConflictException);
        expect(prisma.loanRepayment.findFirst).not.toHaveBeenCalled();
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
