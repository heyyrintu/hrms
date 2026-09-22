import { Test, TestingModule } from '@nestjs/testing';
import {
  AccrualTriggerType,
  CarryForwardRunStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { LeaveCarryForwardService } from './leave-carry-forward.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('LeaveCarryForwardService.runCarryForward', () => {
  let service: LeaveCarryForwardService;
  let prisma: any;
  let notifications: any;

  const tenantId = 'tenant-1';
  const fromYear = 2025;
  const toYear = 2026;

  const earnedLeave = {
    id: 'lt-1',
    tenantId,
    name: 'Earned Leave',
    code: 'EL',
    defaultDays: 12,
    carryForward: true,
    maxCarryForward: 10,
    isActive: true,
  };

  const employee = {
    id: 'emp-1',
    firstName: 'Asha',
    lastName: 'Rao',
  };

  /** A fromYear balance with 20 days remaining (30 + 0 - 10). */
  const fromBalance = {
    id: 'bal-from-1',
    tenantId,
    employeeId: employee.id,
    leaveTypeId: earnedLeave.id,
    year: fromYear,
    totalDays: 30,
    usedDays: 10,
    pendingDays: 0,
    carriedOver: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveCarryForwardService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
      ],
    }).compile();

    service = module.get(LeaveCarryForwardService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);

    prisma.leaveCarryForwardRun.findUnique.mockResolvedValue(null);
    prisma.leaveCarryForwardRun.create.mockResolvedValue({
      id: 'run-1',
      tenantId,
      fromYear,
      toYear,
      status: CarryForwardRunStatus.PENDING,
    });
    prisma.leaveCarryForwardRun.update.mockResolvedValue({});
    prisma.leaveType.findMany.mockResolvedValue([earnedLeave]);
    prisma.employee.findMany.mockResolvedValue([employee]);
    // Default: fromYear balance exists, toYear balance does not.
    prisma.leaveBalance.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.year === fromYear ? { ...fromBalance } : null),
    );
    prisma.leaveBalance.create.mockResolvedValue({ id: 'bal-to-1' });
    prisma.leaveBalance.update.mockResolvedValue({ id: 'bal-to-1' });
  });

  it('carries min(remaining, maxCarryForward) into the next year', async () => {
    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.MANUAL_ADMIN,
      'user-1',
    );

    // remaining = 30 + 0 - 10 = 20, capped at maxCarryForward = 10
    expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        employeeId: employee.id,
        leaveTypeId: earnedLeave.id,
        year: toYear,
        carriedOver: 10,
      }),
    });
    expect(result).toEqual({
      runId: 'run-1',
      processedCount: 1,
      failedCount: 0,
      alreadyRan: false,
    });
  });

  it('carries the full remaining when the leave type has no maxCarryForward', async () => {
    prisma.leaveType.findMany.mockResolvedValue([
      { ...earnedLeave, maxCarryForward: null },
    ]);

    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ carriedOver: 20 }),
    });
  });

  it('carries 0 when the remaining balance is negative', async () => {
    prisma.leaveBalance.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.year === fromYear
          ? { ...fromBalance, totalDays: 5, usedDays: 9 }
          : null,
      ),
    );

    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ carriedOver: 0 }),
    });
    expect(notifications.notifyEmployee).not.toHaveBeenCalled();
  });

  it('does not deduct pendingDays from the carried amount', async () => {
    prisma.leaveBalance.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.year === fromYear
          ? {
              ...fromBalance,
              totalDays: 10,
              usedDays: 3,
              pendingDays: 5,
              carriedOver: 0,
            }
          : null,
      ),
    );

    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    // remaining = 10 + 0 - 3 = 7 (pendingDays ignored), under the cap of 10
    expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ carriedOver: 7 }),
    });
  });

  it('includes the fromYear carriedOver in the remaining balance', async () => {
    prisma.leaveType.findMany.mockResolvedValue([
      { ...earnedLeave, maxCarryForward: null },
    ]);
    prisma.leaveBalance.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.year === fromYear
          ? { ...fromBalance, totalDays: 12, carriedOver: 4, usedDays: 6 }
          : null,
      ),
    );

    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    // remaining = 12 + 4 - 6 = 10
    expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ carriedOver: 10 }),
    });
  });

  it('only queries leave types with carryForward enabled', async () => {
    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    expect(prisma.leaveType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, isActive: true, carryForward: true },
      }),
    );
  });

  it('creates the toYear balance with totalDays from the leave type defaultDays', async () => {
    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        totalDays: earnedLeave.defaultDays,
        usedDays: 0,
        pendingDays: 0,
      }),
    });
  });

  it('only updates carriedOver when the toYear balance already exists', async () => {
    prisma.leaveBalance.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.year === fromYear
          ? { ...fromBalance }
          : {
              id: 'bal-to-existing',
              totalDays: 18,
              usedDays: 2,
              pendingDays: 1,
              carriedOver: 0,
            },
      ),
    );

    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'bal-to-existing' },
      data: { carriedOver: 10 },
    });
  });

  it('skips employees with no fromYear balance for the leave type', async () => {
    prisma.leaveBalance.findFirst.mockResolvedValue(null);

    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.CRON_JOB,
    );

    expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    expect(result.processedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('returns alreadyRan and writes nothing when a COMPLETED run exists for the year', async () => {
    prisma.leaveCarryForwardRun.findUnique.mockResolvedValue({
      id: 'run-existing',
      tenantId,
      fromYear,
      toYear,
      status: CarryForwardRunStatus.COMPLETED,
      processedCount: 42,
      failedCount: 1,
    });

    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.MANUAL_ADMIN,
      'user-1',
    );

    expect(result).toEqual({
      runId: 'run-existing',
      processedCount: 42,
      failedCount: 1,
      alreadyRan: true,
    });
    expect(prisma.leaveCarryForwardRun.create).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    expect(notifications.notifyEmployee).not.toHaveBeenCalled();
  });

  it('catches a per-employee failure, counts it and records it in errorLog', async () => {
    const other = { id: 'emp-2', firstName: 'Biju', lastName: 'Nair' };
    prisma.employee.findMany.mockResolvedValue([employee, other]);
    prisma.leaveBalance.findFirst.mockImplementation(({ where }: any) => {
      if (where.employeeId === other.id) {
        return Promise.reject(new Error('db exploded'));
      }
      return Promise.resolve(where.year === fromYear ? { ...fromBalance } : null);
    });

    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.CRON_JOB,
    );

    expect(result.processedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(prisma.leaveCarryForwardRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: CarryForwardRunStatus.COMPLETED,
          processedCount: 1,
          failedCount: 1,
          errorLog: [{ employeeId: other.id, message: 'db exploded' }],
        }),
      }),
    );
  });

  it('notifies the employee only when the carried amount is above zero', async () => {
    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    expect(notifications.notifyEmployee).toHaveBeenCalledWith(
      tenantId,
      employee.id,
      NotificationType.LEAVE_CARRIED_FORWARD,
      expect.any(String),
      expect.stringContaining('Earned Leave'),
      '/leave',
    );
  });

  it('marks the run FAILED and rethrows when the run itself blows up', async () => {
    prisma.employee.findMany.mockRejectedValue(new Error('tenant gone'));

    await expect(
      service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB),
    ).rejects.toThrow('tenant gone');

    expect(prisma.leaveCarryForwardRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: CarryForwardRunStatus.FAILED,
        }),
      }),
    );
  });

  it('resumes a FAILED run under the same row instead of blocking the year', async () => {
    prisma.leaveCarryForwardRun.findUnique.mockResolvedValue({
      id: 'run-failed',
      tenantId,
      fromYear,
      toYear,
      status: CarryForwardRunStatus.FAILED,
      processedCount: 0,
      failedCount: 4,
      startedAt: new Date('2026-01-01T12:00:00Z'),
    });
    prisma.leaveCarryForwardRun.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.MANUAL_ADMIN,
      'user-1',
    );

    // No second row: the FAILED one is claimed and reset.
    expect(prisma.leaveCarryForwardRun.create).not.toHaveBeenCalled();
    expect(prisma.leaveCarryForwardRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-failed', status: CarryForwardRunStatus.FAILED },
      data: expect.objectContaining({
        status: CarryForwardRunStatus.PENDING,
        processedCount: 0,
        failedCount: 0,
        completedAt: null,
        triggerType: AccrualTriggerType.MANUAL_ADMIN,
        triggeredById: 'user-1',
      }),
    });
    // ...and the sweep actually runs and completes under that row.
    expect(prisma.leaveBalance.create).toHaveBeenCalled();
    expect(prisma.leaveCarryForwardRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-failed' },
        data: expect.objectContaining({
          status: CarryForwardRunStatus.COMPLETED,
          processedCount: 1,
          failedCount: 0,
        }),
      }),
    );
    expect(result).toEqual({
      runId: 'run-failed',
      processedCount: 1,
      failedCount: 0,
      alreadyRan: false,
    });
  });

  it('clears the previous errorLog when resuming a FAILED run', async () => {
    prisma.leaveCarryForwardRun.findUnique.mockResolvedValue({
      id: 'run-failed',
      tenantId,
      fromYear,
      toYear,
      status: CarryForwardRunStatus.FAILED,
      processedCount: 0,
      failedCount: 4,
      startedAt: new Date('2026-01-01T12:00:00Z'),
    });
    prisma.leaveCarryForwardRun.updateMany.mockResolvedValue({ count: 1 });

    await service.runCarryForward(tenantId, fromYear, AccrualTriggerType.CRON_JOB);

    const [{ data }] = prisma.leaveCarryForwardRun.updateMany.mock.calls[0];
    expect(data.errorLog).toBe(Prisma.DbNull);
  });

  it('leaves a fresh PENDING run alone as an in-flight trigger', async () => {
    prisma.leaveCarryForwardRun.findUnique.mockResolvedValue({
      id: 'run-pending',
      tenantId,
      fromYear,
      toYear,
      status: CarryForwardRunStatus.PENDING,
      processedCount: 2,
      failedCount: 0,
      startedAt: new Date(),
    });

    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.MANUAL_ADMIN,
      'user-1',
    );

    expect(result.alreadyRan).toBe(true);
    expect(prisma.leaveCarryForwardRun.updateMany).not.toHaveBeenCalled();
    expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
  });

  it('resumes a PENDING run abandoned more than an hour ago', async () => {
    prisma.leaveCarryForwardRun.findUnique.mockResolvedValue({
      id: 'run-stale',
      tenantId,
      fromYear,
      toYear,
      status: CarryForwardRunStatus.PENDING,
      processedCount: 0,
      failedCount: 0,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    prisma.leaveCarryForwardRun.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.CRON_JOB,
    );

    expect(prisma.leaveCarryForwardRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-stale', status: CarryForwardRunStatus.PENDING },
      }),
    );
    expect(result.alreadyRan).toBe(false);
  });

  it('backs off when another process claims the FAILED run first', async () => {
    prisma.leaveCarryForwardRun.findUnique
      .mockResolvedValueOnce({
        id: 'run-failed',
        tenantId,
        fromYear,
        toYear,
        status: CarryForwardRunStatus.FAILED,
        processedCount: 0,
        failedCount: 4,
        startedAt: new Date('2026-01-01T12:00:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'run-failed',
        processedCount: 7,
        failedCount: 0,
      });
    prisma.leaveCarryForwardRun.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.CRON_JOB,
    );

    expect(result).toEqual({
      runId: 'run-failed',
      processedCount: 7,
      failedCount: 0,
      alreadyRan: true,
    });
    expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
  });

  it('treats a P2002 on create as a concurrent run and returns the winner', async () => {
    // findUnique sees nothing (the other process has not committed yet), then
    // the create loses the unique index and the winner is re-read.
    prisma.leaveCarryForwardRun.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-winner',
        tenantId,
        fromYear,
        toYear,
        status: CarryForwardRunStatus.PENDING,
        processedCount: 9,
        failedCount: 2,
        startedAt: new Date(),
      });
    prisma.leaveCarryForwardRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );

    const result = await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.CRON_JOB,
    );

    expect(result).toEqual({
      runId: 'run-winner',
      processedCount: 9,
      failedCount: 2,
      alreadyRan: true,
    });
    expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
    expect(notifications.notifyEmployee).not.toHaveBeenCalled();
  });

  it('records the run with toYear = fromYear + 1 and the trigger metadata', async () => {
    await service.runCarryForward(
      tenantId,
      fromYear,
      AccrualTriggerType.MANUAL_ADMIN,
      'user-9',
    );

    expect(prisma.leaveCarryForwardRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        fromYear,
        toYear,
        triggerType: AccrualTriggerType.MANUAL_ADMIN,
        triggeredById: 'user-9',
        status: CarryForwardRunStatus.PENDING,
      }),
    });
  });
});

describe('LeaveCarryForwardService.getRuns', () => {
  let service: LeaveCarryForwardService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveCarryForwardService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
      ],
    }).compile();

    service = module.get(LeaveCarryForwardService);
    prisma = module.get(PrismaService);
  });

  it('lists runs for the tenant newest first', async () => {
    prisma.leaveCarryForwardRun.findMany.mockResolvedValue([{ id: 'run-1' }]);

    const runs = await service.getRuns('tenant-1');

    expect(prisma.leaveCarryForwardRun.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
      orderBy: { fromYear: 'desc' },
    });
    expect(runs).toEqual([{ id: 'run-1' }]);
  });
});
