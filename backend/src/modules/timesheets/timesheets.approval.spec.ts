import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { TimesheetsService } from './timesheets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { createMockNotificationsService, createMockPrismaService } from '../../test/helpers';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dec = (n: number | string) => new Prisma.Decimal(n);

const tenantId = 'test-tenant';

const actor = (role: UserRole, employeeId?: string): AuthenticatedUser => ({
  userId: `user-${role}`,
  email: 'x@test.com',
  tenantId,
  role,
  employeeId,
});

const manager = actor(UserRole.MANAGER, 'emp-manager');
const hr = actor(UserRole.HR_ADMIN, 'emp-hr');
const owner = actor(UserRole.EMPLOYEE, 'emp-1');
const stranger = actor(UserRole.EMPLOYEE, 'emp-9');

const submittedRow = {
  id: 'ts-1',
  tenantId,
  employeeId: 'emp-1',
  weekStart: d('2026-03-16'),
  status: 'SUBMITTED',
  totalHours: dec('38.5'),
  submittedAt: new Date('2026-03-20T10:00:00Z'),
  decidedAt: null,
  approverNote: null,
  employee: {
    id: 'emp-1',
    firstName: 'Asha',
    lastName: 'Rao',
    employeeCode: 'E001',
    managerId: 'emp-manager',
  },
  entries: [
    {
      id: 'e1',
      date: d('2026-03-16'),
      projectId: 'p1',
      taskId: 't1',
      hours: dec('7.5'),
      billable: true,
      note: null,
      project: { id: 'p1', code: 'ALPHA', name: 'Alpha' },
      task: { id: 't1', name: 'Build' },
    },
  ],
};

describe('TimesheetsService (approval and reads)', () => {
  let service: TimesheetsService;
  let prisma: any;
  let notifications: ReturnType<typeof createMockNotificationsService>;
  let engine: Record<string, jest.Mock>;

  const alreadyProcessed = () =>
    new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: 't' });

  beforeEach(async () => {
    prisma = createMockPrismaService();
    notifications = createMockNotificationsService();
    engine = {
      start: jest.fn(),
      cancel: jest.fn(),
      notifyPending: jest.fn(),
      listActionableEntityIds: jest.fn().mockResolvedValue([]),
      act: jest.fn(),
    };
    // Default: a single-step chain whose onFinal runs inside a transaction.
    engine.act.mockImplementation(async (input: any) => {
      await prisma.$transaction((tx: any) => input.onFinal?.(tx));
      return {
        outcome: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        instanceId: 'inst-1',
        nextStepOrder: null,
      };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimesheetsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalEngineService, useValue: engine },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(TimesheetsService);

    prisma.timesheet.findFirst.mockResolvedValue(submittedRow);
    prisma.user.findFirst.mockResolvedValue({ id: 'user-owner' });
  });

  describe.each([
    ['approve', 'APPROVE', 'APPROVED', 'TIMESHEET_APPROVED'],
    ['reject', 'REJECT', 'REJECTED', 'TIMESHEET_REJECTED'],
  ] as const)('%s', (method, decision, status, notificationType) => {
    beforeEach(() => {
      prisma.timesheet.update.mockResolvedValue({ ...submittedRow, status });
    });

    it('404s for a missing timesheet', async () => {
      prisma.timesheet.findFirst.mockResolvedValue(null);
      await expect((service as any)[method](manager, 'ts-1', 'n')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a timesheet that is not SUBMITTED', async () => {
      prisma.timesheet.findFirst.mockResolvedValue({ ...submittedRow, status: 'APPROVED' });
      await expect((service as any)[method](manager, 'ts-1', 'n')).rejects.toThrow(
        BadRequestException,
      );
      expect(engine.act).not.toHaveBeenCalled();
    });

    it('acts through the engine with a status-guarded transition', async () => {
      await (service as any)[method](manager, 'ts-1', 'looks fine');

      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          entityType: 'TIMESHEET',
          entityId: 'ts-1',
          actor: manager,
          decision,
          note: 'looks fine',
        }),
      );
      expect(prisma.timesheet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ts-1', status: 'SUBMITTED' },
          data: expect.objectContaining({
            status,
            decidedAt: expect.any(Date),
            approverId: 'emp-manager',
            approverNote: 'looks fine',
          }),
        }),
      );
    });

    it('409s when a concurrent decision won the race', async () => {
      prisma.timesheet.update.mockRejectedValue(alreadyProcessed());
      await expect((service as any)[method](manager, 'ts-1')).rejects.toThrow(ConflictException);
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('does not notify the owner on an intermediate step', async () => {
      engine.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'i', nextStepOrder: 2 });
      const result: any = await (service as any)[method](manager, 'ts-1');
      expect(prisma.timesheet.update).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
      expect(result.status).toBe('SUBMITTED');
    });

    it('notifies the owner on the final outcome', async () => {
      const result: any = await (service as any)[method](manager, 'ts-1', 'n');

      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          userId: 'user-owner',
          type: notificationType,
          link: '/timesheets',
        }),
      );
      expect(result.status).toBe(status);
    });

    it('still returns the row when the owner has no login to notify', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect((service as any)[method](manager, 'ts-1')).resolves.toBeDefined();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('survives a failing notification', async () => {
      notifications.create.mockRejectedValue(new Error('smtp down'));
      await expect((service as any)[method](manager, 'ts-1')).resolves.toBeDefined();
    });
  });

  describe('get', () => {
    it('lets the owner read it, with entries, project and task names', async () => {
      const result: any = await service.get(owner, 'ts-1');
      expect(result.id).toBe('ts-1');
      expect(result.weekStart).toBe('2026-03-16');
      expect(result.employee).toEqual({ id: 'emp-1', name: 'Asha Rao', code: 'E001' });
      expect(result.entries).toEqual([
        expect.objectContaining({
          date: '2026-03-16',
          hours: 7.5,
          project: { id: 'p1', code: 'ALPHA', name: 'Alpha' },
          task: { id: 't1', name: 'Build' },
        }),
      ]);
      expect(prisma.timesheet.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ts-1', tenantId } }),
      );
    });

    it('lets HR read it', async () => {
      await expect(service.get(hr, 'ts-1')).resolves.toBeDefined();
    });

    it('lets the direct manager read it', async () => {
      await expect(service.get(manager, 'ts-1')).resolves.toBeDefined();
    });

    it('lets an actionable approver read it', async () => {
      engine.listActionableEntityIds.mockResolvedValue(['ts-1']);
      await expect(service.get(stranger, 'ts-1')).resolves.toBeDefined();
      expect(engine.listActionableEntityIds).toHaveBeenCalledWith(stranger, 'TIMESHEET');
    });

    it('404s for anyone else', async () => {
      await expect(service.get(stranger, 'ts-1')).rejects.toThrow(NotFoundException);
    });

    it('404s for another manager, and for a caller with no employee record', async () => {
      await expect(service.get(actor(UserRole.MANAGER, 'emp-other'), 'ts-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.get(actor(UserRole.EMPLOYEE), 'ts-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s for a missing timesheet', async () => {
      prisma.timesheet.findFirst.mockResolvedValue(null);
      await expect(service.get(hr, 'ts-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listPendingApprovals', () => {
    beforeEach(() => {
      prisma.timesheet.findMany.mockResolvedValue([submittedRow]);
    });

    it('shows HR every SUBMITTED timesheet', async () => {
      const result: any[] = await service.listPendingApprovals(hr);
      expect(prisma.timesheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'SUBMITTED' } }),
      );
      expect(engine.listActionableEntityIds).not.toHaveBeenCalled();
      expect(result[0]).toMatchObject({ id: 'ts-1', totalHours: 38.5 });
    });

    it('shows others only what the engine says they can act on', async () => {
      engine.listActionableEntityIds.mockResolvedValue(['ts-1', 'ts-2']);
      await service.listPendingApprovals(manager);
      expect(engine.listActionableEntityIds).toHaveBeenCalledWith(manager, 'TIMESHEET');
      expect(prisma.timesheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'SUBMITTED', id: { in: ['ts-1', 'ts-2'] } },
        }),
      );
    });
  });

  describe('listAll', () => {
    it('paginates with filters and a limit capped at 100', async () => {
      prisma.timesheet.findMany.mockResolvedValue([submittedRow]);
      prisma.timesheet.count.mockResolvedValue(45);

      const result: any = await service.listAll(hr, {
        status: 'SUBMITTED' as any,
        from: '2026-03-01',
        to: '2026-03-31',
        employeeId: 'emp-1',
        departmentId: 'dep-1',
        page: 2,
        limit: 500,
      });

      expect(prisma.timesheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            status: 'SUBMITTED',
            weekStart: { gte: d('2026-03-01'), lte: d('2026-03-31') },
            employeeId: 'emp-1',
            employee: { departmentId: 'dep-1' },
          },
          skip: 100,
          take: 100,
          orderBy: { weekStart: 'desc' },
        }),
      );
      expect(result.meta).toEqual({ total: 45, page: 2, limit: 100, totalPages: 1 });
      expect(result.data).toHaveLength(1);
    });

    it('defaults to page 1 of 20', async () => {
      prisma.timesheet.findMany.mockResolvedValue([]);
      prisma.timesheet.count.mockResolvedValue(0);
      const result: any = await service.listAll(hr, {});
      expect(prisma.timesheet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId }, skip: 0, take: 20 }),
      );
      expect(result.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    });
  });
});
