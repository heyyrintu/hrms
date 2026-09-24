import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PayrollRunStatus, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PayrollService } from './payroll.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayslipEmailService } from './payslip-email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { LoansService } from '../loans/loans.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';

/**
 * approveRun's side effects: payslip emails and the `payroll.approved`
 * webhook. Both fire only after the status update has committed, and neither
 * may fail or delay the approval.
 */
describe('PayrollService.approveRun side effects', () => {
  const tenantId = 'tenant-1';
  const approvedAt = new Date('2026-09-30T12:00:00Z');

  let service: PayrollService;
  let prisma: any;
  let payslipEmail: { notifyRunApproved: jest.Mock };
  let webhooks: { dispatch: jest.Mock };
  let engine: { act: jest.Mock; start: jest.Mock; cancel: jest.Mock; notifyPending: jest.Mock };

  /** The checker: an HR admin who did not compute the run. */
  const checker = {
    userId: 'user-checker',
    tenantId,
    email: 'checker@test.com',
    role: 'HR_ADMIN',
    employeeId: 'emp-checker',
  } as any;

  const computedRun = {
    id: 'run-1',
    tenantId,
    month: 9,
    year: 2026,
    status: PayrollRunStatus.COMPUTED,
  };
  const approvedRun = {
    ...computedRun,
    status: PayrollRunStatus.APPROVED,
    totalGross: new Decimal('1250000.50'),
    totalDeductions: new Decimal('250000.25'),
    totalNet: new Decimal('1000000.25'),
    processedCount: 25,
    approvedAt,
  };

  beforeEach(async () => {
    payslipEmail = { notifyRunApproved: jest.fn().mockResolvedValue(undefined) };
    webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
    engine = {
      start: jest.fn(),
      cancel: jest.fn(),
      notifyPending: jest.fn(),
      // Default: single-step chain, so this is the final approval and onFinal
      // runs inside the (mock) engine transaction.
      act: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: PayrollCalculationService, useValue: {} },
        { provide: LoansService, useValue: {} },
        { provide: PayslipEmailService, useValue: payslipEmail },
        { provide: WebhookDispatcherService, useValue: webhooks },
        { provide: ApprovalEngineService, useValue: engine },
      ],
    }).compile();

    service = module.get(PayrollService);
    prisma = module.get(PrismaService);
    engine.act.mockImplementation(async (input: any) => {
      await input.onFinal?.(prisma);
      return { outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null };
    });
  });

  it('notifies employees only after the status update has resolved', async () => {
    const order: string[] = [];
    prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
    prisma.payrollRun.update.mockImplementation(async () => {
      order.push('update');
      return approvedRun;
    });
    payslipEmail.notifyRunApproved.mockImplementation(async () => {
      order.push('email');
    });
    webhooks.dispatch.mockImplementation(async () => {
      order.push('webhook');
    });

    const result = await service.approveRun(tenantId, 'run-1', checker);

    expect(result).toEqual(approvedRun);
    expect(order[0]).toBe('update');
    expect(payslipEmail.notifyRunApproved).toHaveBeenCalledWith(tenantId, 'run-1');
  });

  it('fires payroll.approved with run totals and no per-employee data', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
    prisma.payrollRun.update.mockResolvedValue(approvedRun);

    await service.approveRun(tenantId, 'run-1', checker);

    expect(webhooks.dispatch).toHaveBeenCalledWith(tenantId, 'payroll.approved', {
      runId: 'run-1',
      month: 9,
      year: 2026,
      totalGross: 1250000.5,
      totalDeductions: 250000.25,
      totalNet: 1000000.25,
      processedCount: 25,
      approvedAt: approvedAt.toISOString(),
    });
  });

  it('does not wait for email delivery before returning', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
    prisma.payrollRun.update.mockResolvedValue(approvedRun);
    // A delivery that never finishes must not hold the request open.
    payslipEmail.notifyRunApproved.mockReturnValue(new Promise(() => {}));
    webhooks.dispatch.mockReturnValue(new Promise(() => {}));

    await expect(service.approveRun(tenantId, 'run-1', checker)).resolves.toEqual(approvedRun);
  });

  it('still approves when email or webhook rejects', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
    prisma.payrollRun.update.mockResolvedValue(approvedRun);
    payslipEmail.notifyRunApproved.mockRejectedValue(new Error('smtp down'));
    webhooks.dispatch.mockRejectedValue(new Error('webhook down'));

    await expect(service.approveRun(tenantId, 'run-1', checker)).resolves.toEqual(approvedRun);
    // Let the rejected promises settle so an unhandled rejection would surface.
    await new Promise((r) => setImmediate(r));
  });

  it('still approves when email or webhook throws synchronously', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
    prisma.payrollRun.update.mockResolvedValue(approvedRun);
    payslipEmail.notifyRunApproved.mockImplementation(() => {
      throw new Error('boom');
    });
    webhooks.dispatch.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(service.approveRun(tenantId, 'run-1', checker)).resolves.toEqual(approvedRun);
  });

  it('sends nothing when the run is not found', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue(null);

    await expect(service.approveRun(tenantId, 'run-1', checker)).rejects.toThrow(NotFoundException);
    expect(payslipEmail.notifyRunApproved).not.toHaveBeenCalled();
    expect(webhooks.dispatch).not.toHaveBeenCalled();
  });

  it('sends nothing when the run is not COMPUTED', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue({
      ...computedRun,
      status: PayrollRunStatus.APPROVED,
    });

    await expect(service.approveRun(tenantId, 'run-1', checker)).rejects.toThrow(BadRequestException);
    expect(prisma.payrollRun.update).not.toHaveBeenCalled();
    expect(payslipEmail.notifyRunApproved).not.toHaveBeenCalled();
    expect(webhooks.dispatch).not.toHaveBeenCalled();
  });

  it('sends nothing from the losing side of two concurrent approvals', async () => {
    // Both callers read COMPUTED; the conditional update lets only one move
    // it. The loser must not email payslips or fire the webhook a second time.
    prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
    prisma.payrollRun.update
      .mockResolvedValueOnce(approvedRun)
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

    const [first, second] = await Promise.allSettled([
      service.approveRun(tenantId, 'run-1', checker),
      service.approveRun(tenantId, 'run-1', checker),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', tenantId, status: PayrollRunStatus.COMPUTED },
      }),
    );
    expect(payslipEmail.notifyRunApproved).toHaveBeenCalledTimes(1);
    expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the status update fails', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
    prisma.payrollRun.update.mockRejectedValue(new Error('db down'));

    await expect(service.approveRun(tenantId, 'run-1', checker)).rejects.toThrow('db down');
    expect(payslipEmail.notifyRunApproved).not.toHaveBeenCalled();
    expect(webhooks.dispatch).not.toHaveBeenCalled();
  });

  describe('maker-checker through the approval engine', () => {
    it('approves through engine.act with the PAYROLL_RUN entity type', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
      prisma.payrollRun.update.mockResolvedValue(approvedRun);

      await service.approveRun(tenantId, 'run-1', checker, 'figures checked');

      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          entityType: 'PAYROLL_RUN',
          entityId: 'run-1',
          actor: checker,
          decision: 'APPROVE',
          note: 'figures checked',
        }),
      );
    });

    it('propagates the engine 403 when the maker tries to approve, with no side effects', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
      engine.act.mockRejectedValue(
        new ForbiddenException('The person who computed a payroll run cannot approve it'),
      );

      await expect(
        service.approveRun(tenantId, 'run-1', { ...checker, userId: 'user-maker' }),
      ).rejects.toThrow('The person who computed a payroll run cannot approve it');
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
      expect(payslipEmail.notifyRunApproved).not.toHaveBeenCalled();
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });

    it('keeps the run COMPUTED with no side effects when a multi-level chain advances', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun);
      engine.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'inst-1', nextStepOrder: 2 });

      const result = await service.approveRun(tenantId, 'run-1', checker);

      expect(result).toEqual(computedRun);
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
      expect(payslipEmail.notifyRunApproved).not.toHaveBeenCalled();
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });

    it('does not reach the engine for a run that is not COMPUTED', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...computedRun,
        status: PayrollRunStatus.PROCESSING,
      });

      await expect(service.approveRun(tenantId, 'run-1', checker)).rejects.toThrow(
        BadRequestException,
      );
      expect(engine.act).not.toHaveBeenCalled();
    });
  });
});
