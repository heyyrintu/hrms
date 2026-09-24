import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { LoansService } from '../loans/loans.service';
import { PayslipEmailService } from './payslip-email.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { PayrollRunStatus, Prisma, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: any;
  let calculationService: any;
  let loansService: any;
  let engine: {
    start: jest.Mock;
    notifyPending: jest.Mock;
    act: jest.Mock;
    cancel: jest.Mock;
  };

  const tenantId = 'tenant-1';
  /** Computes the run (maker). */
  const makerId = 'user-maker';
  /** Approves the run (checker). */
  const checker = {
    userId: 'user-checker',
    tenantId,
    email: 'checker@test.com',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-checker',
  } as any;

  beforeEach(async () => {
    const mockCalculationService = {
      calculateForEmployee: jest.fn(),
    };
    const mockLoansService = {
      clearPayrollRepayments: jest.fn().mockResolvedValue(undefined),
      recordPayrollRepayments: jest.fn().mockResolvedValue([]),
      notifyLoansClosed: jest.fn().mockResolvedValue(undefined),
    };

    engine = {
      start: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      notifyPending: jest.fn().mockResolvedValue(undefined),
      // Default: single-step chain, so the approval is final and onFinal runs
      // inside the (mock) engine transaction.
      act: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: PayrollCalculationService, useValue: mockCalculationService },
        { provide: LoansService, useValue: mockLoansService },
        // approveRun's email/webhook side effects are covered in payroll-approve.spec.ts.
        { provide: PayslipEmailService, useValue: { notifyRunApproved: jest.fn().mockResolvedValue(undefined) } },
        { provide: WebhookDispatcherService, useValue: { dispatch: jest.fn().mockResolvedValue(undefined) } },
        { provide: ApprovalEngineService, useValue: engine },
      ],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
    prisma = module.get(PrismaService);
    calculationService = module.get(PayrollCalculationService);
    loansService = module.get(LoansService);
    engine.act.mockImplementation(async (input: any) => {
      await input.onFinal?.(prisma);
      return { outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null };
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // getRuns
  // ============================================

  describe('getRuns', () => {
    it('should return all runs for a tenant with no filters', async () => {
      const mockRuns = [
        { id: 'run-1', tenantId, month: 1, year: 2026, status: 'DRAFT' },
      ];
      prisma.payrollRun.findMany.mockResolvedValue(mockRuns);

      const result = await service.getRuns(tenantId, {});

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: { _count: { select: { payslips: true } } },
      });
      expect(result).toEqual(mockRuns);
    });

    it('should filter by year when provided', async () => {
      prisma.payrollRun.findMany.mockResolvedValue([]);

      await service.getRuns(tenantId, { year: '2026' });

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, year: 2026 },
        }),
      );
    });

    it('should filter by status when provided', async () => {
      prisma.payrollRun.findMany.mockResolvedValue([]);

      await service.getRuns(tenantId, { status: 'DRAFT' });

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'DRAFT' },
        }),
      );
    });

    it('should filter by both year and status when provided', async () => {
      prisma.payrollRun.findMany.mockResolvedValue([]);

      await service.getRuns(tenantId, { year: '2026', status: 'COMPUTED' });

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, year: 2026, status: 'COMPUTED' },
        }),
      );
    });
  });

  // ============================================
  // getRun
  // ============================================

  describe('getRun', () => {
    it('should return a run with payslips by id', async () => {
      const mockRun = {
        id: 'run-1',
        tenantId,
        month: 1,
        year: 2026,
        payslips: [],
      };
      prisma.payrollRun.findFirst.mockResolvedValue(mockRun);

      const result = await service.getRun(tenantId, 'run-1');

      expect(prisma.payrollRun.findFirst).toHaveBeenCalledWith({
        where: { id: 'run-1', tenantId },
        include: {
          payslips: {
            include: {
              employee: {
                select: {
                  id: true,
                  employeeCode: true,
                  firstName: true,
                  lastName: true,
                  designation: true,
                  department: { select: { name: true } },
                },
              },
            },
            orderBy: { employee: { firstName: 'asc' } },
          },
        },
      });
      expect(result).toEqual(mockRun);
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.getRun(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================
  // createRun
  // ============================================

  describe('createRun', () => {
    const dto = { month: 1, year: 2026, remarks: 'Jan payroll' };

    it('should create a new payroll run', async () => {
      const mockCreated = { id: 'run-1', tenantId, ...dto, status: 'DRAFT' };
      prisma.payrollRun.findUnique.mockResolvedValue(null);
      prisma.payrollRun.create.mockResolvedValue(mockCreated);

      const result = await service.createRun(tenantId, dto);

      expect(prisma.payrollRun.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_month_year: { tenantId, month: 1, year: 2026 },
        },
      });
      expect(prisma.payrollRun.create).toHaveBeenCalledWith({
        data: { tenantId, month: 1, year: 2026, remarks: 'Jan payroll' },
      });
      expect(result).toEqual(mockCreated);
    });

    it('should throw ConflictException when duplicate run exists', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue({
        id: 'existing-run',
        tenantId,
        month: 1,
        year: 2026,
      });

      await expect(service.createRun(tenantId, dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ============================================
  // processRun
  // ============================================

  describe('processRun', () => {
    const runId = 'run-1';
    const draftRun = {
      id: runId,
      tenantId,
      month: 1,
      year: 2026,
      status: PayrollRunStatus.DRAFT,
    };

    it('should process a DRAFT run and create payslips', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(draftRun);
      prisma.payrollRun.update.mockResolvedValue({});
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1' },
        { id: 'emp-2' },
      ]);
      prisma.payslip.deleteMany.mockResolvedValue({});
      prisma.payslip.createMany.mockResolvedValue({ count: 1 });

      const calcResult = {
        employeeId: 'emp-1',
        workingDays: 22,
        presentDays: 20,
        leaveDays: 2,
        lopDays: 0,
        otHours: 5,
        basePay: 50000,
        earnings: [{ name: 'HRA', amount: new Decimal(10000) }],
        deductions: [{ name: 'PF', amount: new Decimal(5000) }],
        grossPay: 60000,
        totalDeductions: 5000,
        netPay: 55000,
        otPay: 1000,
        statutory: {
          pfWages: new Decimal(0), pfEmployee: new Decimal(0), pfEmployer: new Decimal(0),
          epsEmployer: new Decimal(0), edliEmployer: new Decimal(0),
          pfAdminEmployer: new Decimal(0), esiWages: new Decimal(0),
          esiEmployee: new Decimal(0), esiEmployer: new Decimal(0),
          professionalTax: new Decimal(0), lwfEmployee: new Decimal(0),
          lwfEmployer: new Decimal(0), tds: new Decimal(0),
          taxComputation: null, totalEmployeeDeductions: new Decimal(0),
        },
      };

      calculationService.calculateForEmployee
        .mockResolvedValueOnce(calcResult)
        .mockResolvedValueOnce(null); // second employee has no salary

      const updatedRun = { id: runId, status: 'COMPUTED', processedCount: 1 };
      // The last update call returns the final result
      prisma.payrollRun.update
        .mockResolvedValueOnce({}) // PROCESSING update
        .mockResolvedValueOnce(updatedRun); // COMPUTED update

      const result = await service.processRun(tenantId, runId, makerId);

      expect(prisma.payrollRun.update).toHaveBeenCalledWith({
        where: { id: runId, status: PayrollRunStatus.DRAFT },
        data: { status: PayrollRunStatus.PROCESSING },
      });
      expect(prisma.payslip.deleteMany).toHaveBeenCalledWith({
        where: { payrollRunId: runId },
      });
      expect(calculationService.calculateForEmployee).toHaveBeenCalledTimes(2);
      expect(prisma.payslip.createMany).toHaveBeenCalledTimes(1);
      // One row: the second employee has no salary and is skipped.
      expect(prisma.payslip.createMany.mock.calls[0][0].data).toHaveLength(1);
      expect(result).toEqual(updatedRun);

      // Maker-checker: the computing user is recorded and the PAYROLL_RUN
      // approval starts inside the write transaction with them as requester.
      expect(prisma.payrollRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PayrollRunStatus.COMPUTED,
            processedById: makerId,
          }),
        }),
      );
      expect(engine.start).toHaveBeenCalledWith({
        tenantId,
        entityType: 'PAYROLL_RUN',
        entityId: runId,
        context: {
          requesterEmployeeId: null,
          requesterUserId: makerId,
          amount: calcResult.netPay,
        },
        tx: prisma,
      });
      expect(engine.notifyPending).toHaveBeenCalledWith(tenantId, 'PAYROLL_RUN', runId);
    });

    it('does not start an approval when processing fails', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(draftRun);
      prisma.payrollRun.update.mockResolvedValue({});
      prisma.employee.findMany.mockRejectedValue(new Error('DB error'));

      await expect(service.processRun(tenantId, runId, makerId)).rejects.toThrow('DB error');

      expect(engine.start).not.toHaveBeenCalled();
      expect(engine.notifyPending).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.processRun(tenantId, 'nonexistent', makerId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when run is not DRAFT', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...draftRun,
        status: PayrollRunStatus.COMPUTED,
      });

      await expect(service.processRun(tenantId, runId, makerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException and not touch payslips when another process call claimed the run first', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(draftRun);
      prisma.payrollRun.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.processRun(tenantId, runId, makerId)).rejects.toThrow(ConflictException);

      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
      expect(prisma.payslip.createMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.update).toHaveBeenCalledTimes(1);
    });

    it('should revert to DRAFT status on processing error', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(draftRun);
      prisma.payrollRun.update.mockResolvedValue({});
      prisma.employee.findMany.mockRejectedValue(new Error('DB error'));

      await expect(service.processRun(tenantId, runId, makerId)).rejects.toThrow('DB error');

      // First call = PROCESSING, second call = revert to DRAFT
      expect(prisma.payrollRun.update).toHaveBeenCalledTimes(2);
      expect(prisma.payrollRun.update).toHaveBeenLastCalledWith({
        where: { id: runId },
        data: { status: PayrollRunStatus.DRAFT },
      });
    });
  });

  // ============================================
  // recomputeRun
  // ============================================

  describe('recomputeRun', () => {
    const runId = 'run-1';
    const computedRun = {
      id: runId,
      tenantId,
      month: 1,
      year: 2026,
      status: PayrollRunStatus.COMPUTED,
      totalGross: new Decimal(60000),
      totalDeductions: new Decimal(5000),
      totalNet: new Decimal(55000),
      processedCount: 1,
    };

    const calcResult = {
      employeeId: 'emp-1',
      workingDays: 22,
      presentDays: 20,
      leaveDays: 2,
      lopDays: 0,
      otHours: 5,
      basePay: 50000,
      earnings: [{ name: 'HRA', amount: new Decimal(12000) }],
      deductions: [{ name: 'PF', amount: new Decimal(5500) }],
      grossPay: 62000,
      totalDeductions: 5500,
      netPay: 56500,
      otPay: 1000,
      statutory: {
        pfWages: new Decimal(0), pfEmployee: new Decimal(0), pfEmployer: new Decimal(0),
        epsEmployer: new Decimal(0), edliEmployer: new Decimal(0),
        pfAdminEmployer: new Decimal(0), esiWages: new Decimal(0),
        esiEmployee: new Decimal(0), esiEmployer: new Decimal(0),
        professionalTax: new Decimal(0), lwfEmployee: new Decimal(0),
        lwfEmployer: new Decimal(0), tds: new Decimal(0),
        taxComputation: null, totalEmployeeDeductions: new Decimal(0),
      },
    };

    it('should recompute a COMPUTED run, discarding the old payslips and regenerating them', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
      // A recompute takes the run's own cohort, not the current active list.
      prisma.payslip.findMany.mockResolvedValue([{ employeeId: 'emp-1' }]);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
      calculationService.calculateForEmployee.mockResolvedValue(calcResult);
      prisma.payslip.deleteMany.mockResolvedValue({ count: 1 });
      prisma.payslip.createMany.mockResolvedValue({ count: 1 });

      const recomputedRun = {
        id: runId,
        status: PayrollRunStatus.COMPUTED,
        totalGross: new Decimal(62000),
        totalDeductions: new Decimal(5500),
        totalNet: new Decimal(56500),
        processedCount: 1,
      };
      prisma.payrollRun.update
        .mockResolvedValueOnce({}) // claim: COMPUTED -> PROCESSING
        .mockResolvedValueOnce(recomputedRun); // publish: PROCESSING -> COMPUTED

      const result = await service.recomputeRun(tenantId, runId, makerId);

      // Claims the run atomically off COMPUTED, not DRAFT.
      expect(prisma.payrollRun.update).toHaveBeenNthCalledWith(1, {
        where: { id: runId, status: PayrollRunStatus.COMPUTED },
        data: { status: PayrollRunStatus.PROCESSING },
      });
      // Old payslips are gone before the new ones are written.
      expect(prisma.payslip.deleteMany).toHaveBeenCalledWith({
        where: { payrollRunId: runId },
      });
      expect(prisma.payslip.createMany).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(PayrollRunStatus.COMPUTED);
      expect(result.totalGross.toString()).toBe('62000');
      // Tells the caller something actually changed.
      expect(result.previousTotals).toBeDefined();
      expect(result.previousTotals.totalGross.toString()).toBe('60000');
      expect(result.changed).toBeDefined();
      expect(result.changed.totalGross.toString()).toBe('2000');

      // New figures need a fresh sign-off, with whoever recomputed as maker.
      expect(prisma.payrollRun.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: runId, status: PayrollRunStatus.PROCESSING },
          data: expect.objectContaining({ processedById: makerId }),
        }),
      );
      expect(engine.start).toHaveBeenCalledWith({
        tenantId,
        entityType: 'PAYROLL_RUN',
        entityId: runId,
        context: { requesterEmployeeId: null, requesterUserId: makerId, amount: 56500 },
        tx: prisma,
      });
      expect(engine.notifyPending).toHaveBeenCalledWith(tenantId, 'PAYROLL_RUN', runId);
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.recomputeRun(tenantId, 'nonexistent', makerId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should refuse to recompute an APPROVED run and explain why', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...computedRun,
        status: PayrollRunStatus.APPROVED,
      });

      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow(
        /approv|sign|adjustment/i,
      );
      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
    });

    it('should refuse to recompute a PAID run and explain why', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...computedRun,
        status: PayrollRunStatus.PAID,
      });

      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow(
        /paid|adjustment/i,
      );
      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
    });

    it('should refuse to recompute a DRAFT run', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...computedRun,
        status: PayrollRunStatus.DRAFT,
      });

      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException and not touch payslips when a concurrent recompute claimed the run first', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
      prisma.payrollRun.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow(
        ConflictException,
      );

      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
      expect(prisma.payslip.createMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.update).toHaveBeenCalledTimes(1);
    });

    it('should revert to COMPUTED status (not DRAFT) on processing error, since that is where it started', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
      prisma.payrollRun.update.mockResolvedValueOnce({}); // claim succeeds
      // Recompute reads the run's own cohort, so that is the read to fail.
      prisma.payslip.findMany.mockRejectedValue(new Error('DB error'));

      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow('DB error');

      // The claim is the only plain update; the revert is guarded on the
      // claim this recompute still holds, so a run somebody reset meanwhile is
      // left alone rather than marked COMPUTED with no payslips.
      expect(prisma.payrollRun.update).toHaveBeenCalledTimes(1);
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: runId, status: PayrollRunStatus.PROCESSING },
        data: { status: PayrollRunStatus.COMPUTED },
      });
    });

    it('is one atomic unit of work: payslips are deleted and recreated inside the same transaction as the run update', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
      // A recompute takes the run's own cohort, not the current active list.
      prisma.payslip.findMany.mockResolvedValue([{ employeeId: 'emp-1' }]);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
      calculationService.calculateForEmployee.mockResolvedValue(calcResult);
      prisma.payslip.deleteMany.mockResolvedValue({ count: 1 });
      prisma.payslip.createMany.mockResolvedValue({ count: 1 });
      prisma.payrollRun.update.mockResolvedValueOnce({}).mockResolvedValueOnce({
        id: runId,
        status: PayrollRunStatus.COMPUTED,
        totalGross: new Decimal(62000),
        totalDeductions: new Decimal(5500),
        totalNet: new Decimal(56500),
        processedCount: 1,
      });

      await service.recomputeRun(tenantId, runId, makerId);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // resetRun
  // ============================================

  describe('resetRun', () => {
    const runId = 'run-1';

    it('should release a run left stuck in PROCESSING back to DRAFT', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: runId,
        tenantId,
        status: PayrollRunStatus.PROCESSING,
      });
      prisma.payslip.deleteMany.mockResolvedValue({ count: 0 });
      prisma.payrollRun.update.mockResolvedValue({
        id: runId,
        status: PayrollRunStatus.DRAFT,
      });

      const result = await service.resetRun(tenantId, runId);

      expect(prisma.payslip.deleteMany).toHaveBeenCalledWith({
        where: { payrollRunId: runId },
      });
      expect(prisma.payrollRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: runId },
          data: expect.objectContaining({ status: PayrollRunStatus.DRAFT }),
        }),
      );
      expect(result.status).toBe(PayrollRunStatus.DRAFT);
      expect(engine.cancel).toHaveBeenCalledWith(tenantId, 'PAYROLL_RUN', runId, prisma);
      // Same lock order as approve: the approval instance before the run and its payslips.
      expect(engine.cancel.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.payslip.deleteMany.mock.invocationCallOrder[0],
      );
      expect(engine.cancel.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.payrollRun.update.mock.invocationCallOrder[0],
      );
    });

    it('should refuse to reset a run that is not stuck', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: runId,
        tenantId,
        status: PayrollRunStatus.PAID,
      });

      await expect(service.resetRun(tenantId, runId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // approveRun
  // ============================================

  describe('approveRun', () => {
    it('should approve a COMPUTED run', async () => {
      const run = {
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.COMPUTED,
      };
      prisma.payrollRun.findFirst.mockResolvedValue(run);
      const approved = { ...run, status: PayrollRunStatus.APPROVED };
      prisma.payrollRun.update.mockResolvedValue(approved);

      const result = await service.approveRun(tenantId, 'run-1', checker);

      // Conditional on the status it checked, so of two concurrent approvals
      // only one can win.
      expect(prisma.payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1', tenantId, status: PayrollRunStatus.COMPUTED },
        data: {
          status: PayrollRunStatus.APPROVED,
          approvedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(approved);
      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          entityType: 'PAYROLL_RUN',
          entityId: 'run-1',
          actor: checker,
          decision: 'APPROVE',
        }),
      );
    });

    it('propagates the engine 403 when the maker approves their own run', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.COMPUTED,
        processedById: makerId,
      });
      engine.act.mockRejectedValue(
        new ForbiddenException('The person who computed a payroll run cannot approve it'),
      );

      await expect(
        service.approveRun(tenantId, 'run-1', { ...checker, userId: makerId }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
    });

    it('answers 409 when a concurrent approval moved the run first', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.COMPUTED,
      });
      prisma.payrollRun.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.approveRun(tenantId, 'run-1', checker)).rejects.toThrow(
        'Payroll run is already being approved',
      );
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.approveRun(tenantId, 'nonexistent', checker)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when run is not COMPUTED', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.DRAFT,
      });

      await expect(service.approveRun(tenantId, 'run-1', checker)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // getWorkflowContext (PAYROLL_RUN handler)
  // ============================================

  describe('getWorkflowContext', () => {
    it('routes a COMPUTED run with its maker as requester and totalNet as amount', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        processedById: makerId,
        totalNet: new Decimal('1000000.25'),
      });

      await expect(service.getWorkflowContext(tenantId, 'run-1')).resolves.toEqual({
        requesterEmployeeId: null,
        requesterUserId: makerId,
        amount: 1000000.25,
      });
      expect(prisma.payrollRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1', tenantId, status: PayrollRunStatus.COMPUTED },
        }),
      );
    });

    it('leaves a legacy run (no processedById) unrestricted', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({ processedById: null, totalNet: 10 });

      await expect(service.getWorkflowContext(tenantId, 'run-1')).resolves.toMatchObject({
        requesterUserId: null,
      });
    });

    it('returns null when the run is not awaiting approval', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.getWorkflowContext(tenantId, 'run-1')).resolves.toBeNull();
    });
  });

  // ============================================
  // markAsPaid
  // ============================================

  describe('markAsPaid', () => {
    it('should mark an APPROVED run as PAID', async () => {
      const run = {
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.APPROVED,
      };
      prisma.payrollRun.findFirst.mockResolvedValue(run);
      const paid = { ...run, status: PayrollRunStatus.PAID };
      prisma.payrollRun.update.mockResolvedValue(paid);

      const result = await service.markAsPaid(tenantId, 'run-1');

      expect(prisma.payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: { status: PayrollRunStatus.PAID },
      });
      expect(result).toEqual(paid);
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.markAsPaid(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when run is not APPROVED', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.COMPUTED,
      });

      await expect(service.markAsPaid(tenantId, 'run-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // deleteRun
  // ============================================

  describe('deleteRun', () => {
    it('should refuse to delete a PAID run even for a SUPER_ADMIN', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.PAID,
      });

      await expect(
        service.deleteRun(tenantId, 'run-1', UserRole.SUPER_ADMIN),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.delete).not.toHaveBeenCalled();
    });

    it('should delete a DRAFT run and its payslips', async () => {
      const run = {
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.DRAFT,
      };
      prisma.payrollRun.findFirst.mockResolvedValue(run);
      prisma.payslip.deleteMany.mockResolvedValue({});
      prisma.payrollRun.delete.mockResolvedValue({});

      await service.deleteRun(tenantId, 'run-1');

      expect(prisma.payslip.deleteMany).toHaveBeenCalledWith({
        where: { payrollRunId: 'run-1' },
      });
      expect(prisma.payrollRun.delete).toHaveBeenCalledWith({
        where: { id: 'run-1' },
      });
    });

    it('reverses the run loan repayments before deleting a COMPUTED run', async () => {
      // A COMPUTED run has already written LoanRepayment rows and decremented
      // every borrower's balance. LoanRepayment.payslipId carries no FK, so
      // deleting the payslips would leave those credits standing for money
      // nobody was charged.
      const run = {
        id: 'run-1',
        tenantId,
        month: 3,
        year: 2026,
        status: PayrollRunStatus.COMPUTED,
      };
      prisma.payrollRun.findFirst.mockResolvedValue(run);
      prisma.payslip.deleteMany.mockResolvedValue({});
      prisma.payrollRun.delete.mockResolvedValue({});

      await service.deleteRun(tenantId, 'run-1', UserRole.SUPER_ADMIN);

      expect(loansService.clearPayrollRepayments).toHaveBeenCalledWith(
        tenantId,
        3,
        2026,
        expect.anything(),
      );
      // And it has to happen first: after the payslips are gone there is no
      // longer any record of what to reverse.
      expect(
        loansService.clearPayrollRepayments.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.payslip.deleteMany.mock.invocationCallOrder[0]);
      // Same lock order as approve: the approval instance before the run.
      expect(engine.cancel).toHaveBeenCalledWith(tenantId, 'PAYROLL_RUN', 'run-1', prisma);
      expect(engine.cancel.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.payslip.deleteMany.mock.invocationCallOrder[0],
      );
      expect(engine.cancel.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.payrollRun.delete.mock.invocationCallOrder[0],
      );
    });

    it('does not reverse anything when the run is refused', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        month: 3,
        year: 2026,
        status: PayrollRunStatus.PAID,
      });

      await expect(
        service.deleteRun(tenantId, 'run-1', UserRole.SUPER_ADMIN),
      ).rejects.toThrow(BadRequestException);
      expect(loansService.clearPayrollRepayments).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.deleteRun(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when run is not DRAFT', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.APPROVED,
      });

      await expect(service.deleteRun(tenantId, 'run-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // getPayslipsForRun
  // ============================================

  describe('getPayslipsForRun', () => {
    it('should return paginated payslips with default page/limit', async () => {
      const mockPayslips = [{ id: 'slip-1', payrollRunId: 'run-1' }];
      prisma.payslip.findMany.mockResolvedValue(mockPayslips);
      prisma.payslip.count.mockResolvedValue(1);

      const result = await service.getPayslipsForRun(tenantId, 'run-1', {});

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, payrollRunId: 'run-1' },
          skip: 0,
          take: 50,
        }),
      );
      expect(result).toEqual({
        data: mockPayslips,
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      });
    });

    it('should respect custom page and limit values', async () => {
      prisma.payslip.findMany.mockResolvedValue([]);
      prisma.payslip.count.mockResolvedValue(100);

      const result = await service.getPayslipsForRun(tenantId, 'run-1', {
        page: '2',
        limit: '10',
      });

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta).toEqual({
        total: 100,
        page: 2,
        limit: 10,
        totalPages: 10,
      });
    });
  });

  // ============================================
  // getMyPayslips
  // ============================================

  describe('getMyPayslips', () => {
    it('should return payslips for the employee from APPROVED/PAID runs', async () => {
      const mockPayslips = [
        { id: 'slip-1', employeeId: 'emp-1', payrollRun: { month: 1, year: 2026, status: 'PAID' } },
      ];
      prisma.payslip.findMany.mockResolvedValue(mockPayslips);

      const result = await service.getMyPayslips(tenantId, 'emp-1');

      expect(prisma.payslip.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId: 'emp-1',
          payrollRun: {
            status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
          },
        },
        include: {
          payrollRun: { select: { month: true, year: true, status: true } },
        },
        orderBy: [
          { payrollRun: { year: 'desc' } },
          { payrollRun: { month: 'desc' } },
        ],
      });
      expect(result).toEqual(mockPayslips);
    });

    it('should throw BadRequestException when employeeId is falsy', async () => {
      await expect(service.getMyPayslips(tenantId, '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // getPayslip
  // ============================================

  describe('getPayslip', () => {
    it('should return a payslip with employee and run details', async () => {
      const mockPayslip = {
        id: 'slip-1',
        tenantId,
        employee: { id: 'emp-1', firstName: 'John', lastName: 'Doe' },
        payrollRun: { month: 1, year: 2026, status: 'PAID' },
      };
      prisma.payslip.findFirst.mockResolvedValue(mockPayslip);

      const result = await service.getPayslip(tenantId, 'slip-1');

      expect(prisma.payslip.findFirst).toHaveBeenCalledWith({
        where: { id: 'slip-1', tenantId },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              email: true,
              designation: true,
              department: { select: { name: true } },
              joinDate: true,
            },
          },
          payrollRun: {
            select: { month: true, year: true, status: true },
          },
        },
      });
      expect(result).toEqual(mockPayslip);
    });

    it('should throw NotFoundException when payslip not found', async () => {
      prisma.payslip.findFirst.mockResolvedValue(null);

      await expect(service.getPayslip(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('recomputes the employees the run already covers, not whoever is active today', async () => {
    // A run computed in April and recomputed in June must still cover the
    // employee who left in May. Taking the current active list would delete
    // their payslip and quietly shrink a run that has already been reported on.
    prisma.payrollRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId,
      status: 'COMPUTED',
      month: 4,
      year: 2026,
      totalGross: new Decimal(0),
      totalDeductions: new Decimal(0),
      totalNet: new Decimal(0),
      processedCount: 2,
    });
    prisma.payrollRun.update.mockResolvedValue({});
    prisma.payslip.findMany.mockResolvedValue([
      { employeeId: 'emp-still-here' },
      { employeeId: 'emp-who-left' },
    ]);
    prisma.employee.findMany.mockResolvedValue([{ id: 'emp-still-here' }]);

    await service.recomputeRun(tenantId, 'run-1', makerId).catch(() => undefined);

    const asked = calculationService.calculateForEmployee.mock.calls.map(
      (call: unknown[]) => call[1],
    );
    expect(asked).toContain('emp-who-left');
  });

  it('will not publish a recompute over a run somebody reset underneath it', async () => {
    // resetRun can move the run back to DRAFT and clear its payslips while a
    // recompute is still calculating. Publishing on the id alone would then
    // recreate payslips on a run that was deliberately emptied, or mark a
    // reset run COMPUTED with nothing in it.
    prisma.payrollRun.findFirst.mockResolvedValue({
      id: 'run-1',
      tenantId,
      status: 'COMPUTED',
      month: 4,
      year: 2026,
      totalGross: new Decimal(0),
      totalDeductions: new Decimal(0),
      totalNet: new Decimal(0),
      processedCount: 1,
    });
    prisma.payrollRun.update.mockResolvedValue({});
    prisma.payslip.findMany.mockResolvedValue([{ employeeId: 'emp-1' }]);

    await service.recomputeRun(tenantId, 'run-1', makerId).catch(() => undefined);

    const publishes = prisma.payrollRun.update.mock.calls.filter(
      (call: { where?: { status?: unknown } }[]) =>
        (call[0] as { data?: { status?: unknown } })?.data?.status === 'COMPUTED',
    );
    expect(publishes.length).toBeGreaterThan(0);
    for (const call of publishes) {
      expect((call[0] as { where?: { status?: unknown } }).where?.status).toBe(
        'PROCESSING',
      );
    }
  });
  // ============================================
  // Loan recovery
  // ============================================

  describe('loan recovery', () => {
    const runId = 'run-1';
    const draftRun = {
      id: runId,
      tenantId,
      month: 1,
      year: 2026,
      status: PayrollRunStatus.DRAFT,
    };

    const zeroStatutory = {
      pfWages: new Decimal(0), pfEmployee: new Decimal(0), pfEmployer: new Decimal(0),
      epsEmployer: new Decimal(0), edliEmployer: new Decimal(0),
      pfAdminEmployer: new Decimal(0), esiWages: new Decimal(0),
      esiEmployee: new Decimal(0), esiEmployer: new Decimal(0),
      professionalTax: new Decimal(0), lwfEmployee: new Decimal(0),
      lwfEmployer: new Decimal(0), tds: new Decimal(0),
      taxComputation: null, totalEmployeeDeductions: new Decimal(0),
    };

    function slipFor(employeeId: string, loanRepayments: unknown[]) {
      return {
        employeeId,
        workingDays: 22, presentDays: 22, leaveDays: 0, lopDays: 0,
        otHours: new Decimal(0), basePay: new Decimal(20000),
        earnings: [],
        deductions: [{ name: 'Loan EMI', amount: new Decimal(5000) }],
        grossPay: new Decimal(20000),
        totalDeductions: new Decimal(5000),
        netPay: new Decimal(15000),
        otPay: new Decimal(0),
        statutory: zeroStatutory,
        loanRepayments,
      };
    }

    /** A DRAFT run that computes one payslip for `emp-1`. */
    function draftRunProducing(loanRepayments: unknown[]) {
      prisma.payrollRun.findFirst.mockResolvedValue(draftRun);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
      prisma.payslip.deleteMany.mockResolvedValue({});
      prisma.payslip.createMany.mockResolvedValue({ count: 1 });
      prisma.payslip.findMany.mockResolvedValue([
        { id: 'slip-1', employeeId: 'emp-1' },
      ]);
      prisma.payrollRun.update.mockResolvedValue({ id: runId });
      calculationService.calculateForEmployee.mockResolvedValue(
        slipFor('emp-1', loanRepayments),
      );
    }

    it('records the instalments once, against the payslip that deducted them', async () => {
      draftRunProducing([{ loanId: 'loan-1', amount: 5000 }]);

      await service.processRun(tenantId, runId, makerId);

      expect(loansService.recordPayrollRepayments).toHaveBeenCalledTimes(1);
      expect(loansService.recordPayrollRepayments).toHaveBeenCalledWith(
        tenantId,
        'emp-1',
        1,
        2026,
        'slip-1',
        [{ loanId: 'loan-1', amount: 5000 }],
        expect.anything(),
      );
    });

    it('does not call the loans service at all when nobody had an instalment', async () => {
      draftRunProducing([]);

      await service.processRun(tenantId, runId, makerId);

      expect(loansService.recordPayrollRepayments).not.toHaveBeenCalled();
      // The payslip ids are not even looked up when there is nothing to record.
      expect(prisma.payslip.findMany).not.toHaveBeenCalled();
    });

    it('fails the whole run on a 409 rather than retrying inside the transaction', async () => {
      // A retry inside the one transaction would re-read a loan whose first
      // repayment row is already written in it and skip the decrement. The
      // whole run rolls back instead and the caller simply runs it again.
      draftRunProducing([{ loanId: 'loan-1', amount: 5000 }]);
      loansService.recordPayrollRepayments.mockRejectedValue(
        new ConflictException('balance moved'),
      );

      await expect(service.processRun(tenantId, runId, makerId)).rejects.toThrow(
        ConflictException,
      );
      expect(loansService.recordPayrollRepayments).toHaveBeenCalledTimes(1);
      expect(prisma.payrollRun.update).toHaveBeenLastCalledWith({
        where: { id: runId },
        data: { status: PayrollRunStatus.DRAFT },
      });
      expect(loansService.notifyLoansClosed).not.toHaveBeenCalled();
    });

    /**
     * Swap the helper's pass-through transaction for one that records whether
     * a call happened inside it, so "inside the transaction" is asserted
     * rather than assumed.
     */
    function trackTransaction() {
      const state = { inTx: false };
      prisma.$transaction.mockImplementation(async (cb: any) => {
        state.inTx = true;
        try {
          return await cb(prisma);
        } finally {
          state.inTx = false;
        }
      });
      const seen: Record<string, boolean[]> = {
        clear: [],
        record: [],
        calc: [],
        notify: [],
      };
      loansService.clearPayrollRepayments.mockImplementation(async () => {
        seen.clear.push(state.inTx);
      });
      loansService.recordPayrollRepayments.mockImplementation(async () => {
        seen.record.push(state.inTx);
        return [{ id: 'loan-1', employeeId: 'emp-1', type: 'LOAN' }];
      });
      loansService.notifyLoansClosed.mockImplementation(async () => {
        seen.notify.push(state.inTx);
      });
      const calc = calculationService.calculateForEmployee.getMockImplementation();
      calculationService.calculateForEmployee.mockImplementation(
        async (...args: unknown[]) => {
          seen.calc.push(state.inTx);
          return calc ? calc(...args) : undefined;
        },
      );
      return seen;
    }

    it('processRun reverses, replaces payslips and re-records loans in one transaction', async () => {
      draftRunProducing([{ loanId: 'loan-1', amount: 5000 }]);
      const seen = trackTransaction();

      await service.processRun(tenantId, runId, makerId);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(seen.clear).toEqual([true]);
      expect(seen.record).toEqual([true]);
      // Calculation stays outside, so the transaction does not hold locks
      // for the length of every employee's computation.
      expect(seen.calc.length).toBeGreaterThan(0);
      expect(seen.calc.every((inTx) => inTx === false)).toBe(true);
      expect(loansService.clearPayrollRepayments).toHaveBeenCalledWith(
        tenantId,
        1,
        2026,
        prisma,
      );
      // Reversal before the payslips are replaced and before re-recording.
      expect(
        loansService.clearPayrollRepayments.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.payslip.deleteMany.mock.invocationCallOrder[0]);
      // The payslip ids the repayments carry are read inside the transaction.
      expect(prisma.payslip.findMany).toHaveBeenCalledWith({
        where: { payrollRunId: runId, tenantId },
        select: { id: true, employeeId: true },
      });
    });

    it('opens the write transaction with a timeout sized for the loan writes', async () => {
      draftRunProducing([{ loanId: 'loan-1', amount: 5000 }]);

      await service.processRun(tenantId, runId, makerId);

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      const options = prisma.$transaction.mock.calls[0][1];
      expect(options.timeout).toBeGreaterThan(5000);
    });

    it('tells borrowers their loan closed only after the transaction commits', async () => {
      draftRunProducing([{ loanId: 'loan-1', amount: 5000 }]);
      const seen = trackTransaction();

      await service.processRun(tenantId, runId, makerId);

      expect(seen.notify).toEqual([false]);
      expect(loansService.notifyLoansClosed).toHaveBeenCalledWith(tenantId, [
        { id: 'loan-1', employeeId: 'emp-1', type: 'LOAN' },
      ]);
    });

    function computedRunProducing(loanRepayments: unknown[]) {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: runId, tenantId, month: 3, year: 2026,
        status: PayrollRunStatus.COMPUTED,
        totalGross: new Decimal(0), totalDeductions: new Decimal(0),
        totalNet: new Decimal(0), processedCount: 1,
      });
      prisma.payslip.findMany.mockResolvedValue([
        { id: 'slip-1', employeeId: 'emp-1' },
      ]);
      prisma.payslip.deleteMany.mockResolvedValue({ count: 1 });
      prisma.payslip.createMany.mockResolvedValue({ count: 1 });
      prisma.payrollRun.update.mockResolvedValue({
        id: runId, status: PayrollRunStatus.COMPUTED,
        totalGross: new Decimal(0), totalDeductions: new Decimal(0),
        totalNet: new Decimal(0), processedCount: 1,
      });
      calculationService.calculateForEmployee.mockResolvedValue(
        slipFor('emp-1', loanRepayments),
      );
    }

    it('recomputeRun reverses, replaces payslips and re-records loans in one transaction', async () => {
      computedRunProducing([{ loanId: 'loan-1', amount: 5000 }]);
      const seen = trackTransaction();

      await service.recomputeRun(tenantId, runId, makerId);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      expect(seen.clear).toEqual([true]);
      expect(seen.record).toEqual([true]);
      expect(seen.calc.length).toBeGreaterThan(0);
      expect(seen.calc.every((inTx) => inTx === false)).toBe(true);
      expect(seen.notify).toEqual([false]);
    });

    it('a recompute failure after the reversal leaves no half-done loan state behind', async () => {
      // The gap this closes: the reversal used to commit on its own, so a
      // failure before re-recording left every balance high until the next
      // good run. Now the reversal is a statement in the same transaction as
      // the failure and rolls back with it — the mock cannot roll back, but
      // it can prove the reversal never ran outside that transaction.
      computedRunProducing([{ loanId: 'loan-1', amount: 5000 }]);
      prisma.payslip.createMany.mockRejectedValue(new Error('write failed'));
      const seen = trackTransaction();

      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow(
        'write failed',
      );

      expect(seen.clear).toEqual([true]);
      expect(loansService.recordPayrollRepayments).not.toHaveBeenCalled();
      expect(loansService.notifyLoansClosed).not.toHaveBeenCalled();
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: runId, status: PayrollRunStatus.PROCESSING },
        data: { status: PayrollRunStatus.COMPUTED },
      });
    });

    it('resetRun reverses the abandoned attempt inside the same transaction that clears its payslips', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: runId, tenantId, month: 4, year: 2026,
        status: PayrollRunStatus.PROCESSING,
      });
      prisma.payslip.deleteMany.mockResolvedValue({});
      prisma.payrollRun.update.mockResolvedValue({});
      const seen = trackTransaction();

      await service.resetRun(tenantId, runId);

      expect(seen.clear).toEqual([true]);
    });

    it('reverses the previous attempt before recomputing, so the EMI is not lost', async () => {
      // getPayrollDeductions skips a loan that already has a row for the
      // month. Without the reversal the recomputed payslip would show no
      // instalment at all and pay the whole salary out.
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: runId, tenantId, month: 3, year: 2026,
        status: PayrollRunStatus.COMPUTED,
        totalGross: new Decimal(0), totalDeductions: new Decimal(0),
        totalNet: new Decimal(0), processedCount: 1,
      });
      prisma.payslip.findMany.mockResolvedValue([
        { id: 'slip-1', employeeId: 'emp-1' },
      ]);
      prisma.payslip.deleteMany.mockResolvedValue({ count: 1 });
      prisma.payslip.createMany.mockResolvedValue({ count: 1 });
      prisma.payrollRun.update.mockResolvedValue({
        id: runId, status: PayrollRunStatus.COMPUTED,
        totalGross: new Decimal(0), totalDeductions: new Decimal(0),
        totalNet: new Decimal(0), processedCount: 1,
      });
      calculationService.calculateForEmployee.mockResolvedValue(
        slipFor('emp-1', [{ loanId: 'loan-1', amount: 5000 }]),
      );

      await service.recomputeRun(tenantId, runId, makerId);

      expect(loansService.clearPayrollRepayments).toHaveBeenCalledWith(
        tenantId, 3, 2026, expect.anything(),
      );
      // Reversed first, re-recorded from the figures this recompute produced.
      const clearedAt =
        loansService.clearPayrollRepayments.mock.invocationCallOrder[0];
      const recordedAt =
        loansService.recordPayrollRepayments.mock.invocationCallOrder[0];
      expect(clearedAt).toBeLessThan(recordedAt);
    });

    it('recomputeRun rolls back and returns to COMPUTED when a loan changed during the calculation', async () => {
      // e.g. a settlement closed the loan, or a manual repayment shrank it,
      // while the payslips were being calculated: the loans service refuses
      // rather than credit less than the payslip deducts.
      computedRunProducing([{ loanId: 'loan-1', amount: 5000 }]);
      loansService.recordPayrollRepayments.mockRejectedValue(
        new ConflictException('Loan loan-1 was closed ... re-run payroll'),
      );

      await expect(service.recomputeRun(tenantId, runId, makerId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: runId, status: PayrollRunStatus.PROCESSING },
        data: { status: PayrollRunStatus.COMPUTED },
      });
      expect(loansService.notifyLoansClosed).not.toHaveBeenCalled();
    });

    it('resetRun is refused, and changes nothing, when a settlement has since recovered a loan', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: runId, tenantId, month: 4, year: 2026,
        status: PayrollRunStatus.PROCESSING,
      });
      loansService.clearPayrollRepayments.mockRejectedValue(
        new ConflictException('recovered by a final settlement'),
      );

      await expect(service.resetRun(tenantId, runId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
    });

    it('deleteRun is refused, and deletes nothing, when a settlement has since recovered a loan', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: runId, tenantId, month: 4, year: 2026,
        status: PayrollRunStatus.COMPUTED,
      });
      loansService.clearPayrollRepayments.mockRejectedValue(
        new ConflictException('recovered by a final settlement'),
      );

      await expect(
        service.deleteRun(tenantId, runId, UserRole.SUPER_ADMIN),
      ).rejects.toThrow(ConflictException);
      expect(prisma.payslip.deleteMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.delete).not.toHaveBeenCalled();
    });

    it('reverses the abandoned attempt when a stuck run is reset', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: runId, tenantId, month: 4, year: 2026,
        status: PayrollRunStatus.PROCESSING,
      });
      prisma.payslip.deleteMany.mockResolvedValue({});
      prisma.payrollRun.update.mockResolvedValue({});

      await service.resetRun(tenantId, runId);

      expect(loansService.clearPayrollRepayments).toHaveBeenCalledWith(
        tenantId, 4, 2026, expect.anything(),
      );
    });
  });
});
