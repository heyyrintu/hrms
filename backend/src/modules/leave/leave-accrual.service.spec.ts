import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { Prisma, AccrualStatus, AccrualTriggerType } from '@prisma/client';
import { LeaveAccrualService } from './leave-accrual.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('LeaveAccrualService.triggerAccrual', () => {
  let service: LeaveAccrualService;
  let prisma: any;

  const tenantId = 'test-tenant';
  const dto = { month: 10, year: 2026 };
  const rule = {
    id: 'rule-1',
    tenantId,
    leaveTypeId: 'lt-1',
    monthlyAccrualDays: 1.5,
    applyCapOnAccrual: false,
    maxBalanceCap: null,
    isActive: true,
    leaveType: { id: 'lt-1', name: 'Earned Leave' },
  };
  const employee = { id: 'emp-1', firstName: 'A', lastName: 'B' };
  const failedRun = {
    id: 'run-failed',
    tenantId,
    month: 10,
    year: 2026,
    status: AccrualStatus.FAILED,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveAccrualService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(LeaveAccrualService);
    prisma = module.get(PrismaService);

    prisma.leaveAccrualRule.findMany.mockResolvedValue([rule]);
    prisma.leaveAccrualEntry.findMany.mockResolvedValue([]);
    prisma.leaveAccrualRun.update.mockResolvedValue({});
    // Resuming a FAILED run claims it conditionally; default to winning the claim.
    prisma.leaveAccrualRun.updateMany.mockResolvedValue({ count: 1 });
    prisma.leaveBalance.update.mockResolvedValue({ totalDays: 10 });
    prisma.leaveAccrualEntry.create.mockResolvedValue({});
  });

  it('should resume a FAILED run instead of creating a second row for the same month', async () => {
    prisma.leaveAccrualRun.findUnique.mockResolvedValue(failedRun);
    prisma.employee.findMany.mockResolvedValue([]);

    const result = await service.triggerAccrual(tenantId, dto, AccrualTriggerType.MANUAL_ADMIN, 'user-1');

    expect(prisma.leaveAccrualRun.create).not.toHaveBeenCalled();
    expect(prisma.leaveAccrualRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-failed', status: AccrualStatus.FAILED },
        data: expect.objectContaining({ status: AccrualStatus.PENDING, errorMessage: null }),
      }),
    );
    expect(result.accrualRunId).toBe('run-failed');
    expect(result.status).toBe(AccrualStatus.COMPLETED);
  });

  it('should not credit an employee again for a leave type the failed run already processed', async () => {
    prisma.leaveAccrualRun.findUnique.mockResolvedValue(failedRun);
    prisma.employee.findMany.mockResolvedValue([employee]);
    prisma.leaveAccrualEntry.findMany.mockResolvedValue([
      { employeeId: 'emp-1', leaveTypeId: 'lt-1' },
    ]);

    const result = await service.triggerAccrual(tenantId, dto, AccrualTriggerType.MANUAL_ADMIN, 'user-1');

    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    expect(prisma.leaveAccrualEntry.create).not.toHaveBeenCalled();
    expect(result.processedCount).toBe(0);
  });

  it('should claim a FAILED run conditionally so two concurrent resumes cannot both credit', async () => {
    prisma.leaveAccrualRun.findUnique.mockResolvedValue(failedRun);
    prisma.employee.findMany.mockResolvedValue([]);
    prisma.leaveAccrualRun.updateMany.mockResolvedValue({ count: 1 });

    await service.triggerAccrual(tenantId, dto, AccrualTriggerType.MANUAL_ADMIN, 'user-1');

    expect(prisma.leaveAccrualRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-failed', status: AccrualStatus.FAILED },
      }),
    );
  });

  it('should throw ConflictException when another resume already claimed the failed run', async () => {
    prisma.leaveAccrualRun.findUnique.mockResolvedValue(failedRun);
    prisma.leaveAccrualRun.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.triggerAccrual(tenantId, dto, AccrualTriggerType.MANUAL_ADMIN, 'user-1'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
  });

  it('should throw ConflictException when a run for the month is still PENDING', async () => {
    prisma.leaveAccrualRun.findUnique.mockResolvedValue({ ...failedRun, status: AccrualStatus.PENDING });

    await expect(
      service.triggerAccrual(tenantId, dto, AccrualTriggerType.MANUAL_ADMIN, 'user-1'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.leaveAccrualRun.create).not.toHaveBeenCalled();
  });

  it('should throw ConflictException when a concurrent trigger already created the run', async () => {
    prisma.leaveAccrualRun.findUnique.mockResolvedValue(null);
    prisma.leaveAccrualRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.triggerAccrual(tenantId, dto, AccrualTriggerType.MANUAL_ADMIN, 'user-1'),
    ).rejects.toThrow(ConflictException);
  });
});
