import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AttendanceRequestsService } from './attendance-requests.service';
import { createMockPrismaService } from '../../../test/helpers';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';

describe('AttendanceRequestsService', () => {
  const tenantId = 'tenant-1';
  // 2026-03-18 11:30 IST
  const NOW = new Date('2026-03-18T06:00:00Z');
  const TODAY = new Date('2026-03-18T00:00:00.000Z');
  const YESTERDAY = new Date('2026-03-17T00:00:00.000Z');

  let prisma: any;
  let engine: Record<string, jest.Mock>;
  let notifications: { create: jest.Mock };
  let service: AttendanceRequestsService;

  const employee: AuthenticatedUser = {
    userId: 'user-emp',
    email: 'e@test.com',
    tenantId,
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };
  const manager: AuthenticatedUser = {
    userId: 'user-mgr',
    email: 'm@test.com',
    tenantId,
    role: UserRole.MANAGER,
    employeeId: 'emp-mgr',
  };
  const hr: AuthenticatedUser = { ...manager, role: UserRole.HR_ADMIN };

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'req-1',
    tenantId,
    employeeId: 'emp-1',
    type: 'WFH',
    fromDate: new Date('2026-03-16T00:00:00.000Z'),
    toDate: new Date('2026-03-18T00:00:00.000Z'),
    days: 3,
    reason: 'Plumber',
    location: null,
    status: 'PENDING',
    ...over,
  });

  const p2025 = () =>
    new Prisma.PrismaClientKnownRequestError('gone', {
      code: 'P2025',
      clientVersion: 'x',
    });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    prisma = createMockPrismaService();
    engine = {
      start: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      notifyPending: jest.fn().mockResolvedValue(undefined),
      act: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
      listActionableEntityIds: jest.fn().mockResolvedValue([]),
    };
    engine.act.mockImplementation(async (input: any) => {
      await prisma.$transaction((tx: any) => input.onFinal?.(tx));
      return {
        outcome: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        instanceId: 'inst-1',
        nextStepOrder: null,
      };
    });
    notifications = { create: jest.fn().mockResolvedValue({}) };
    prisma.user.findFirst.mockResolvedValue({ id: 'user-emp' });
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', status: 'ACTIVE' });
    prisma.attendanceRequest.findFirst.mockResolvedValue(null);
    service = new AttendanceRequestsService(prisma, engine as any, notifications as any);
  });

  afterEach(() => jest.useRealTimers());

  describe('create', () => {
    const dto = {
      type: 'WFH' as const,
      fromDate: '2026-03-16',
      toDate: '2026-03-18',
      reason: 'Plumber',
    };

    beforeEach(() => {
      prisma.attendanceRequest.create.mockImplementation(async ({ data }: any) =>
        row({ ...data }),
      );
    });

    it('creates a PENDING request with a day count and starts the workflow in the tx', async () => {
      await service.create(employee, dto);

      expect(prisma.attendanceRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            employeeId: 'emp-1',
            type: 'WFH',
            days: 3,
            status: 'PENDING',
            fromDate: new Date('2026-03-16T00:00:00.000Z'),
            toDate: new Date('2026-03-18T00:00:00.000Z'),
          }),
        }),
      );
      expect(engine.start).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          entityType: 'WFH_REQUEST',
          context: {
            requesterEmployeeId: 'emp-1',
            requesterUserId: 'user-emp',
            days: 3,
          },
          tx: prisma,
        }),
      );
      expect(engine.notifyPending).toHaveBeenCalledWith(tenantId, 'WFH_REQUEST', 'req-1');
    });

    it('uses ON_DUTY_REQUEST for on-duty and accepts a location', async () => {
      await service.create(employee, { ...dto, type: 'ON_DUTY', location: 'Client site' });
      expect(engine.start).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'ON_DUTY_REQUEST' }),
      );
    });

    it.each([
      ['fromDate after toDate', { fromDate: '2026-03-19', toDate: '2026-03-18' }],
      ['range over 31 days', { fromDate: '2026-03-01', toDate: '2026-04-05' }],
      ['more than 30 days in the past', { fromDate: '2026-02-01', toDate: '2026-02-02' }],
      ['location with WFH', { location: 'Home' }],
    ])('rejects %s with 400', async (_name, over) => {
      await expect(service.create(employee, { ...dto, ...over })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.attendanceRequest.create).not.toHaveBeenCalled();
    });

    it('allows a range of exactly 31 days starting 30 days back', async () => {
      await expect(
        service.create(employee, { ...dto, fromDate: '2026-02-16', toDate: '2026-03-18' }),
      ).resolves.toBeDefined();
    });

    it('409s on an overlapping PENDING/APPROVED request', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(row());
      await expect(service.create(employee, dto)).rejects.toThrow(ConflictException);
      expect(prisma.attendanceRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            employeeId: 'emp-1',
            status: { in: ['PENDING', 'APPROVED'] },
            fromDate: { lte: new Date('2026-03-18T00:00:00.000Z') },
            toDate: { gte: new Date('2026-03-16T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('400s for an inactive employee', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.create(employee, dto)).rejects.toThrow(BadRequestException);
    });

    it('400s when the user has no employee record', async () => {
      await expect(
        service.create({ ...employee, employeeId: undefined }, dto),
      ).rejects.toThrow('No employee record linked to this user');
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(row());
      prisma.attendanceRequest.update.mockResolvedValue(row({ status: 'APPROVED' }));
      prisma.attendanceRecord.updateMany.mockResolvedValue({ count: 2 });
    });

    it('runs the decision through the engine as APPROVE', async () => {
      await service.approve(manager, 'req-1', 'ok');
      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          entityType: 'WFH_REQUEST',
          entityId: 'req-1',
          decision: 'APPROVE',
          note: 'ok',
        }),
      );
    });

    it('onFinal: guarded transition, then re-marks PRESENT days up to today', async () => {
      await service.approve(manager, 'req-1', 'ok');

      expect(prisma.attendanceRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1', status: 'PENDING' },
          data: expect.objectContaining({
            status: 'APPROVED',
            approverId: 'emp-mgr',
            approverNote: 'ok',
            decidedAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId: 'emp-1',
          date: { gte: new Date('2026-03-16T00:00:00.000Z'), lte: TODAY },
          status: 'PRESENT',
        },
        data: { status: 'WFH' },
      });
    });

    it('caps the re-mark at today for a range extending into the future', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(
        row({ toDate: new Date('2026-03-25T00:00:00.000Z') }),
      );
      await service.approve(manager, 'req-1');
      expect(prisma.attendanceRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ date: expect.objectContaining({ lte: TODAY }) }),
        }),
      );
    });

    it('marks ON_DUTY for on-duty requests', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(row({ type: 'ON_DUTY' }));
      await service.approve(manager, 'req-1');
      expect(prisma.attendanceRecord.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ON_DUTY' } }),
      );
    });

    it('skips the re-mark when the request starts in the future', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(
        row({
          fromDate: new Date('2026-03-20T00:00:00.000Z'),
          toDate: new Date('2026-03-22T00:00:00.000Z'),
        }),
      );
      await service.approve(manager, 'req-1');
      expect(prisma.attendanceRecord.updateMany).not.toHaveBeenCalled();
    });

    it('maps P2025 on the guarded update to 409', async () => {
      prisma.attendanceRequest.update.mockRejectedValue(p2025());
      await expect(service.approve(manager, 'req-1')).rejects.toThrow(ConflictException);
    });

    it('returns the row unchanged and does not notify when the chain ADVANCED', async () => {
      engine.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'i', nextStepOrder: 2 });
      const result = await service.approve(manager, 'req-1');
      expect(result).toEqual(row());
      expect(prisma.attendanceRequest.update).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('notifies the requester on final approval', async () => {
      await service.approve(manager, 'req-1');
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          userId: 'user-emp',
          type: 'ATTENDANCE_REQUEST_APPROVED',
        }),
      );
    });

    it('404s for an unknown request, 400 when not pending', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValueOnce(null);
      await expect(service.approve(manager, 'nope')).rejects.toThrow(NotFoundException);
      prisma.attendanceRequest.findFirst.mockResolvedValueOnce(row({ status: 'APPROVED' }));
      await expect(service.approve(manager, 'req-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('reject', () => {
    beforeEach(() => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(row());
      prisma.attendanceRequest.update.mockResolvedValue(row({ status: 'REJECTED' }));
    });

    it('rejects through the engine without touching attendance records', async () => {
      await service.reject(manager, 'req-1', 'no');
      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'REJECT', note: 'no' }),
      );
      expect(prisma.attendanceRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'REJECTED', approverNote: 'no' }),
        }),
      );
      expect(prisma.attendanceRecord.updateMany).not.toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ATTENDANCE_REQUEST_REJECTED' }),
      );
    });

    it('maps P2025 to 409', async () => {
      prisma.attendanceRequest.update.mockRejectedValue(p2025());
      await expect(service.reject(manager, 'req-1')).rejects.toThrow(ConflictException);
    });

    it('does not notify on an intermediate step', async () => {
      engine.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'i', nextStepOrder: 2 });
      await service.reject(manager, 'req-1');
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      prisma.attendanceRequest.update.mockImplementation(async ({ data }: any) =>
        row({ ...data }),
      );
    });

    it('cancels a PENDING request and its approval instance in one tx', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(row());
      await service.cancel(employee, 'req-1');
      expect(prisma.attendanceRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'CANCELLED', cancelledAt: expect.any(Date) }),
        }),
      );
      expect(engine.cancel).toHaveBeenCalledWith(tenantId, 'WFH_REQUEST', 'req-1', prisma);
    });

    it('cancels an APPROVED request that has not started', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(
        row({
          status: 'APPROVED',
          fromDate: new Date('2026-03-20T00:00:00.000Z'),
          toDate: new Date('2026-03-22T00:00:00.000Z'),
        }),
      );
      await service.cancel(employee, 'req-1');
      expect(prisma.attendanceRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1', status: 'APPROVED' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
    });

    it('truncates an APPROVED request spanning today to yesterday', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(
        row({ status: 'APPROVED', toDate: new Date('2026-03-20T00:00:00.000Z') }),
      );
      await service.cancel(employee, 'req-1');
      const call = prisma.attendanceRequest.update.mock.calls[0][0];
      expect(call.data.toDate).toEqual(YESTERDAY);
      expect(call.data.days).toBe(2);
      expect(call.data.status).toBeUndefined();
    });

    it('400s for an APPROVED request fully in the past', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(
        row({ status: 'APPROVED', toDate: new Date('2026-03-17T00:00:00.000Z') }),
      );
      await expect(service.cancel(employee, 'req-1')).rejects.toThrow(BadRequestException);
    });

    it('400s for a REJECTED request', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(row({ status: 'REJECTED' }));
      await expect(service.cancel(employee, 'req-1')).rejects.toThrow(BadRequestException);
    });

    it('404s when the caller is not the requester', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(null);
      await expect(service.cancel(employee, 'req-1')).rejects.toThrow(NotFoundException);
      expect(prisma.attendanceRequest.findFirst).toHaveBeenCalledWith({
        where: { id: 'req-1', tenantId, employeeId: 'emp-1' },
      });
    });

    it('409s when the guarded update loses a race', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(row());
      prisma.attendanceRequest.update.mockRejectedValue(p2025());
      await expect(service.cancel(employee, 'req-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('findApprovedCovering', () => {
    it('queries the covering APPROVED request', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue({ id: 'req-1', type: 'WFH' });
      const date = new Date('2026-03-17T00:00:00.000Z');
      await expect(service.findApprovedCovering(tenantId, 'emp-1', date)).resolves.toEqual({
        id: 'req-1',
        type: 'WFH',
      });
      expect(prisma.attendanceRequest.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId: 'emp-1',
          status: 'APPROVED',
          fromDate: { lte: date },
          toDate: { gte: date },
        },
        select: { id: true, type: true },
      });
    });

    it('uses the supplied tx and returns null when none', async () => {
      const tx: any = createMockPrismaService();
      tx.attendanceRequest.findFirst.mockResolvedValue(null);
      await expect(
        service.findApprovedCovering(tenantId, 'emp-1', TODAY, tx),
      ).resolves.toBeNull();
      expect(tx.attendanceRequest.findFirst).toHaveBeenCalled();
      expect(prisma.attendanceRequest.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('listPendingApprovals', () => {
    beforeEach(() => prisma.attendanceRequest.findMany.mockResolvedValue([]));

    it('HR sees every pending request', async () => {
      await service.listPendingApprovals(hr);
      expect(prisma.attendanceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'PENDING' } }),
      );
      expect(engine.listActionableEntityIds).not.toHaveBeenCalled();
    });

    it('a manager sees only what the engine says is actionable, for both types', async () => {
      engine.listActionableEntityIds.mockImplementation(async (_a: any, type: string) =>
        type === 'WFH_REQUEST' ? ['w1'] : ['o1'],
      );
      await service.listPendingApprovals(manager);
      expect(engine.listActionableEntityIds).toHaveBeenCalledWith(manager, 'WFH_REQUEST');
      expect(engine.listActionableEntityIds).toHaveBeenCalledWith(manager, 'ON_DUTY_REQUEST');
      expect(prisma.attendanceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'PENDING', id: { in: ['w1', 'o1'] } },
        }),
      );
    });
  });

  describe('listMine / listAll', () => {
    it('listMine scopes by employee and filters, newest first', async () => {
      prisma.attendanceRequest.findMany.mockResolvedValue([]);
      await service.listMine(employee, {
        status: 'PENDING',
        from: '2026-03-01',
        to: '2026-03-31',
      });
      expect(prisma.attendanceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            employeeId: 'emp-1',
            status: 'PENDING',
          }),
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('listAll paginates with a clamped limit', async () => {
      prisma.attendanceRequest.findMany.mockResolvedValue([row()]);
      prisma.attendanceRequest.count.mockResolvedValue(1);
      const res = await service.listAll(tenantId, { type: 'WFH', page: 2, limit: 500 });
      expect(prisma.attendanceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId, type: 'WFH' }),
          skip: 100,
          take: 100,
        }),
      );
      expect(res.meta).toEqual({ total: 1, page: 2, limit: 100, totalPages: 1 });
    });
  });

  describe('describe / getContext', () => {
    it('describe returns summaries only for rows of the requested type', async () => {
      prisma.attendanceRequest.findMany.mockResolvedValue([
        { ...row(), employee: { firstName: 'A', lastName: 'B' }, createdAt: NOW },
      ]);
      const out = await service.describe(tenantId, ['req-1'], 'WFH');
      expect(prisma.attendanceRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, id: { in: ['req-1'] }, type: 'WFH' },
        }),
      );
      expect(out[0]).toMatchObject({
        entityId: 'req-1',
        title: 'Work from home',
        requesterName: 'A B',
        link: '/approvals/attendance-requests',
      });
      expect(out[0].subtitle).toMatch(/\(3 days\)/);
    });

    it('describe with no ids does not query', async () => {
      await expect(service.describe(tenantId, [], 'WFH')).resolves.toEqual([]);
      expect(prisma.attendanceRequest.findMany).not.toHaveBeenCalled();
    });

    it('getContext filters by type and PENDING status', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(null);
      await expect(service.getContext(tenantId, 'req-1', 'ON_DUTY')).resolves.toBeNull();
      expect(prisma.attendanceRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'req-1', tenantId, type: 'ON_DUTY', status: 'PENDING' },
        }),
      );
    });

    it('getContext returns requester and days', async () => {
      prisma.attendanceRequest.findFirst.mockResolvedValue(row());
      await expect(service.getContext(tenantId, 'req-1', 'WFH')).resolves.toEqual({
        requesterEmployeeId: 'emp-1',
        requesterUserId: 'user-emp',
        days: 3,
      });
    });
  });
});
