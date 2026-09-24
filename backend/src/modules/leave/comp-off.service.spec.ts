import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { CompOffService } from './comp-off.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('CompOffService', () => {
  let service: CompOffService;
  let prisma: any;
  let notifications: any;
  let engine: {
    start: jest.Mock;
    notifyPending: jest.Mock;
    act: jest.Mock;
    cancel: jest.Mock;
    listActionableEntityIds: jest.Mock;
  };

  const tenantId = 'test-tenant';
  const approverId = 'emp-manager';

  const managerActor: AuthenticatedUser = {
    userId: 'user-manager',
    email: 'manager@test.com',
    tenantId,
    role: UserRole.MANAGER,
    employeeId: approverId,
  };

  const pendingRequest = {
    id: 'co-1',
    tenantId,
    employeeId: 'emp-1',
    workedDate: new Date('2025-03-15T12:00:00Z'),
    earnedDays: 1,
    expiryDate: new Date('2999-01-01T00:00:00Z'),
    status: 'PENDING',
    employee: { id: 'emp-1', managerId: approverId, firstName: 'A', lastName: 'B' },
  };

  const alreadyProcessed = () =>
    new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
      code: 'P2025',
      clientVersion: 'test',
    });

  beforeEach(async () => {
    engine = {
      start: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      notifyPending: jest.fn().mockResolvedValue(undefined),
      act: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
      listActionableEntityIds: jest.fn().mockResolvedValue([]),
    };
    // Default: single-step chain, onFinal runs inside a transaction.
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
        CompOffService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        { provide: ApprovalEngineService, useValue: engine },
      ],
    }).compile();

    service = module.get(CompOffService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
  });

  describe('create', () => {
    // 2025-03-15 is a Saturday.
    const dto = { workedDate: '2025-03-15T12:00:00Z', reason: 'Release weekend', earnedDays: 1 };

    it('starts a COMP_OFF approval with earnedDays inside the create transaction', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);
      prisma.compOffRequest.findUnique.mockResolvedValue(null);
      prisma.compOffRequest.create.mockResolvedValue({ id: 'co-new' });

      await service.create(tenantId, 'emp-1', dto as any, 'user-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(engine.start).toHaveBeenCalledWith({
        tenantId,
        entityType: 'COMP_OFF',
        entityId: 'co-new',
        context: { requesterEmployeeId: 'emp-1', requesterUserId: 'user-1', days: 1 },
        tx: prisma,
      });
      expect(engine.notifyPending).toHaveBeenCalledWith(tenantId, 'COMP_OFF', 'co-new');
    });

    it('falls back to the employee\'s linked user as requester', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);
      prisma.compOffRequest.findUnique.mockResolvedValue(null);
      prisma.compOffRequest.create.mockResolvedValue({ id: 'co-new' });
      prisma.user.findFirst.mockResolvedValue(null);

      await service.create(tenantId, 'emp-1', dto as any);

      expect(engine.start).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ requesterUserId: null }),
        }),
      );
    });

    it('does not start an approval for a duplicate request', async () => {
      prisma.holiday.findFirst.mockResolvedValue(null);
      prisma.compOffRequest.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.create(tenantId, 'emp-1', dto as any, 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(engine.start).not.toHaveBeenCalled();
    });
  });

  describe('getPendingApprovals', () => {
    it('scopes non-admins to the engine\'s actionable ids', async () => {
      engine.listActionableEntityIds.mockResolvedValue(['co-1']);
      prisma.compOffRequest.findMany.mockResolvedValue([]);

      await service.getPendingApprovals(managerActor);

      expect(engine.listActionableEntityIds).toHaveBeenCalledWith(managerActor, 'COMP_OFF');
      expect(prisma.compOffRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'PENDING', id: { in: ['co-1'] } },
        }),
      );
    });

    it('shows HR_ADMIN every pending request', async () => {
      prisma.compOffRequest.findMany.mockResolvedValue([]);

      await service.getPendingApprovals({ ...managerActor, role: UserRole.HR_ADMIN });

      expect(engine.listActionableEntityIds).not.toHaveBeenCalled();
      expect(prisma.compOffRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'PENDING' } }),
      );
    });
  });

  describe('approve', () => {
    it('should only transition a request that is still PENDING', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      prisma.leaveType.findUnique.mockResolvedValue({ id: 'lt-co' });
      prisma.leaveBalance.findFirst.mockResolvedValue({ id: 'bal-1' });
      prisma.leaveBalance.update.mockResolvedValue({});

      await service.approve(managerActor, 'co-1', {});

      expect(prisma.compOffRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'co-1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'APPROVED', approverId }),
        }),
      );
      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          entityType: 'COMP_OFF',
          entityId: 'co-1',
          actor: managerActor,
          decision: 'APPROVE',
        }),
      );
    });

    it('should refuse to credit a comp-off whose expiry has already passed', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue({
        ...pendingRequest,
        expiryDate: new Date('2025-01-01T00:00:00Z'),
      });

      await expect(service.approve(managerActor, 'co-1', {})).rejects.toThrow(BadRequestException);

      // The expiry pre-check runs before the engine records anything.
      expect(engine.act).not.toHaveBeenCalled();
      expect(prisma.compOffRequest.update).not.toHaveBeenCalled();
      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    });

    it('credits the balance inside onFinal on the final approval', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      const tx = createMockPrismaService() as any;
      tx.compOffRequest.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      tx.leaveType.findUnique.mockResolvedValue({ id: 'lt-co' });
      tx.leaveBalance.findFirst.mockResolvedValue({ id: 'bal-1' });
      tx.leaveBalance.update.mockResolvedValue({});
      engine.act.mockImplementation(async (input: any) => {
        await input.onFinal(tx);
        return { outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null };
      });

      const result = await service.approve(managerActor, 'co-1', {});

      expect(result.status).toBe('APPROVED');
      expect(tx.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: 'bal-1' },
        data: { totalDays: { increment: 1 } },
      });
      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        'emp-1',
        'COMP_OFF_APPROVED',
        'Comp-Off Approved',
        expect.any(String),
        '/leave/comp-off',
      );
    });

    it('stays PENDING with no credit and no notification when the chain ADVANCES', async () => {
      prisma.compOffRequest.findFirst
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(pendingRequest);
      engine.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'inst-1', nextStepOrder: 2 });

      const result = await service.approve(managerActor, 'co-1', {});

      expect(result.status).toBe('PENDING');
      expect(prisma.compOffRequest.update).not.toHaveBeenCalled();
      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('propagates the engine\'s 403', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      engine.act.mockRejectedValue(new ForbiddenException('not an approver'));

      await expect(service.approve(managerActor, 'co-1', {})).rejects.toThrow(ForbiddenException);
      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    });

    it('should propagate a balance-credit failure so the approval is rolled back', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });
      prisma.leaveType.findUnique.mockResolvedValue({ id: 'lt-co' });
      prisma.leaveBalance.findFirst.mockResolvedValue({ id: 'bal-1' });
      prisma.leaveBalance.update.mockRejectedValue(new Error('balance write failed'));

      await expect(service.approve(managerActor, 'co-1', {})).rejects.toThrow(
        'balance write failed',
      );
    });

    it('should throw ConflictException and not credit balance when already processed concurrently', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockRejectedValue(alreadyProcessed());

      await expect(service.approve(managerActor, 'co-1', {})).rejects.toThrow(ConflictException);

      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('rejects through the engine and notifies the employee', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockResolvedValue({ ...pendingRequest, status: 'REJECTED' });

      const result = await service.reject(
        { ...managerActor, employeeId: undefined },
        'co-1',
        { approverNote: 'no' },
      );

      expect(result.status).toBe('REJECTED');
      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'COMP_OFF', decision: 'REJECT', note: 'no' }),
      );
      expect(prisma.compOffRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED', approverId: null }),
        }),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        'emp-1',
        'COMP_OFF_REJECTED',
        'Comp-Off Rejected',
        expect.stringContaining('Note: no'),
        '/leave/comp-off',
      );
    });

    it('should throw ConflictException when already processed concurrently', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.compOffRequest.update.mockRejectedValue(alreadyProcessed());

      await expect(service.reject(managerActor, 'co-1', {})).rejects.toThrow(ConflictException);
    });
  });
});
