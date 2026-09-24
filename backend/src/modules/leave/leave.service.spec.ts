import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { LeaveService } from './leave.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HolidaysService } from '../holidays/holidays.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
  createMockEmailService,
} from '../../test/helpers';

describe('LeaveService', () => {
  let service: LeaveService;
  let prisma: any;
  let notifications: any;
  let holidays: { getHolidaysBetween: jest.Mock };
  let webhooks: { dispatch: jest.Mock };
  let engine: {
    start: jest.Mock;
    notifyPending: jest.Mock;
    act: jest.Mock;
    cancel: jest.Mock;
    listActionableEntityIds: jest.Mock;
  };

  const tenantId = 'test-tenant';
  const employeeId = 'emp-1';
  const approverId = 'emp-manager';

  const managerActor: AuthenticatedUser = {
    userId: 'user-manager',
    email: 'manager@test.com',
    tenantId,
    role: UserRole.MANAGER,
    employeeId: approverId,
  };

  const adminActor: AuthenticatedUser = {
    userId: 'user-admin',
    email: 'admin@test.com',
    tenantId,
    role: UserRole.SUPER_ADMIN,
    employeeId: 'super-admin-emp',
  };

  const mockLeaveType = {
    id: 'lt-1',
    tenantId,
    name: 'Casual Leave',
    code: 'CL',
    isActive: true,
    defaultDays: 12,
    carryForward: false,
    maxCarryForward: null,
    isPaid: true,
  };

  const mockBalance = {
    id: 'bal-1',
    tenantId,
    employeeId,
    leaveTypeId: 'lt-1',
    year: 2025,
    totalDays: 12,
    usedDays: 2,
    pendingDays: 0,
    carriedOver: 0,
  };

  const mockLeaveRequest = {
    id: 'req-1',
    tenantId,
    employeeId,
    leaveTypeId: 'lt-1',
    startDate: new Date('2025-03-10'),
    endDate: new Date('2025-03-12'),
    totalDays: 3,
    reason: 'Personal work',
    status: 'PENDING',
    employee: {
      id: employeeId,
      managerId: approverId,
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@test.com',
    },
  };

  beforeEach(async () => {
    engine = {
      start: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      notifyPending: jest.fn().mockResolvedValue(undefined),
      act: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
      listActionableEntityIds: jest.fn().mockResolvedValue([]),
    };
    // Default: a single-step chain, so every decision is terminal and the
    // domain's onFinal runs inside a transaction, as the real engine does.
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
        LeaveService,
        { provide: ApprovalEngineService, useValue: engine },
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: EmailService, useValue: createMockEmailService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        {
          provide: HolidaysService,
          useValue: { getHolidaysBetween: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: WebhookDispatcherService,
          useValue: { dispatch: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<LeaveService>(LeaveService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
    holidays = module.get(HolidaysService);
    webhooks = module.get(WebhookDispatcherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -----------------------------------------------------------
  // getLeaveTypes
  // -----------------------------------------------------------
  describe('getLeaveTypes', () => {
    it('should return active leave types ordered by name', async () => {
      const leaveTypes = [mockLeaveType];
      prisma.leaveType.findMany.mockResolvedValue(leaveTypes);

      const result = await service.getLeaveTypes(tenantId);

      expect(prisma.leaveType.findMany).toHaveBeenCalledWith({
        where: { tenantId, isActive: true },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(leaveTypes);
    });
  });

  // -----------------------------------------------------------
  // getBalances
  // -----------------------------------------------------------
  describe('getBalances', () => {
    it('should return balances for the specified year', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);

      const result = await service.getBalances(tenantId, employeeId, 2025);

      expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith({
        where: { tenantId, employeeId, year: 2025, leaveType: { isActive: true } },
        include: { leaveType: true },
      });
      expect(result).toHaveLength(1);
    });

    it('should default to current year when no year provided', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.getBalances(tenantId, employeeId);

      expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId,
          year: new Date().getFullYear(),
          leaveType: { isActive: true },
        },
        include: { leaveType: true },
      });
    });
  });

  // -----------------------------------------------------------
  // createRequest
  // -----------------------------------------------------------
  describe('createRequest', () => {
    const createDto = {
      leaveTypeId: 'lt-1',
      startDate: '2025-03-10',
      endDate: '2025-03-12',
      reason: 'Personal work',
    };

    it('starts the approval with the employee\'s linked user when no creator is given', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      prisma.leaveRequest.create.mockResolvedValue({
        id: 'req-new',
        totalDays: 3,
        leaveType: mockLeaveType,
        employee: { id: employeeId },
      });
      prisma.user.findFirst.mockResolvedValue({ id: 'linked-user' });

      await service.createRequest(tenantId, employeeId, createDto);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { tenantId, employeeId },
        select: { id: true },
      });
      expect(engine.start).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { requesterEmployeeId: employeeId, requesterUserId: 'linked-user', days: 3 },
        }),
      );
    });

    it('does not start an approval when validation fails', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(null);

      await expect(service.createRequest(tenantId, employeeId, createDto)).rejects.toThrow(
        NotFoundException,
      );

      expect(engine.start).not.toHaveBeenCalled();
      expect(engine.notifyPending).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when start date is after end date', async () => {
      await expect(
        service.createRequest(tenantId, employeeId, {
          ...createDto,
          startDate: '2025-03-15',
          endDate: '2025-03-10',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when leave type not found', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(null);

      await expect(
        service.createRequest(tenantId, employeeId, createDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when overlapping leave exists', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveRequest.findFirst.mockResolvedValue({ id: 'overlap-req' });

      await expect(
        service.createRequest(tenantId, employeeId, createDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException when insufficient balance', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null); // no overlap
      prisma.leaveBalance.findMany.mockResolvedValue([{
        ...mockBalance,
        totalDays: 2,
        usedDays: 1,
        pendingDays: 1,
        carriedOver: 0,
      }]);

      // Available = 2 + 0 - 1 - 1 = 0, requesting 3 days (Mon-Wed)
      await expect(
        service.createRequest(tenantId, employeeId, createDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow LOP leave even with insufficient balance', async () => {
      const lopType = { ...mockLeaveType, id: 'lt-lop', code: 'LOP' };
      prisma.leaveType.findFirst.mockResolvedValue(lopType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findMany.mockResolvedValue([]); // no balance at all

      prisma.leaveRequest.create.mockResolvedValue({
        id: 'req-new',
        ...createDto,
        leaveType: lopType,
        employee: { id: employeeId },
      });

      const result = await service.createRequest(tenantId, employeeId, {
        ...createDto,
        leaveTypeId: 'lt-lop',
      });

      expect(result.id).toBe('req-new');
    });

    it('should reserve days against each calendar year the request spans', async () => {
      // Wed 31 Dec 2025 to Fri 2 Jan 2026: one chargeable day in 2025 and
      // two in 2026 (1 Jan is a Thursday, 2 Jan a Friday).
      const crossYearDto = {
        leaveTypeId: 'lt-1',
        startDate: '2025-12-31',
        endDate: '2026-01-02',
        reason: 'New Year break',
      };
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findMany.mockResolvedValue([
        { ...mockBalance, id: 'bal-2025', year: 2025 },
        { ...mockBalance, id: 'bal-2026', year: 2026 },
      ]);
      prisma.leaveRequest.create.mockResolvedValue({
        id: 'req-new',
        totalDays: 3,
        leaveType: mockLeaveType,
        employee: { id: employeeId },
      });
      prisma.leaveBalance.update.mockResolvedValue({});

      await service.createRequest(tenantId, employeeId, crossYearDto);

      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: 'bal-2025' },
        data: { pendingDays: { increment: 1 } },
      });
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: 'bal-2026' },
        data: { pendingDays: { increment: 2 } },
      });
    });

    it('should reject when the later year lacks the balance, not just the starting year', async () => {
      const crossYearDto = {
        leaveTypeId: 'lt-1',
        startDate: '2025-12-31',
        endDate: '2026-01-02',
        reason: 'New Year break',
      };
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findMany.mockResolvedValue([
        { ...mockBalance, id: 'bal-2025', year: 2025 },
        // 2026 is exhausted: 12 total, 12 already used.
        { ...mockBalance, id: 'bal-2026', year: 2026, usedDays: 12 },
      ]);

      await expect(
        service.createRequest(tenantId, employeeId, crossYearDto),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.leaveRequest.create).not.toHaveBeenCalled();
    });

    it('should not charge leave for a company holiday inside the range', async () => {
      // Mon 10 Mar - Wed 12 Mar 2025, Tuesday is a declared holiday
      holidays.getHolidaysBetween.mockResolvedValue([
        { date: new Date('2025-03-11T00:00:00.000Z') },
      ]);
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      prisma.leaveRequest.create.mockResolvedValue({
        id: 'req-new',
        totalDays: 2,
        leaveType: mockLeaveType,
        employee: { id: employeeId },
      });
      prisma.leaveBalance.update.mockResolvedValue({});

      await service.createRequest(tenantId, employeeId, createDto);

      expect(holidays.getHolidaysBetween).toHaveBeenCalledWith(
        tenantId,
        expect.any(Date),
        expect.any(Date),
      );
      expect(prisma.leaveRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ totalDays: 2 }) }),
      );
    });

    it('should create request and increment pending days in balance', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);

      const createdRequest = {
        id: 'req-new',
        tenantId,
        employeeId,
        totalDays: 3,
        leaveType: mockLeaveType,
        employee: { id: employeeId },
      };
      prisma.leaveRequest.create.mockResolvedValue(createdRequest);
      prisma.leaveBalance.update.mockResolvedValue({});

      const result = await service.createRequest(tenantId, employeeId, createDto, 'user-1');

      expect(prisma.leaveRequest.create).toHaveBeenCalled();
      expect(engine.start).toHaveBeenCalledWith({
        tenantId,
        entityType: 'LEAVE',
        entityId: 'req-new',
        context: {
          requesterEmployeeId: employeeId,
          requesterUserId: 'user-1',
          days: expect.any(Number),
        },
        tx: prisma,
      });
      expect(engine.notifyPending).toHaveBeenCalledWith(tenantId, 'LEAVE', 'req-new');
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: mockBalance.id },
        data: {
          pendingDays: { increment: expect.any(Number) },
        },
      });
      expect(result.id).toBe('req-new');
    });

    it('should not update balance when no balance record exists', async () => {
      prisma.leaveType.findFirst.mockResolvedValue({ ...mockLeaveType, code: 'LOP' });
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      prisma.leaveRequest.create.mockResolvedValue({
        id: 'req-new',
        leaveType: { ...mockLeaveType, code: 'LOP' },
        employee: { id: employeeId },
      });

      await service.createRequest(tenantId, employeeId, createDto);

      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------
  // getMyRequests
  // -----------------------------------------------------------
  describe('getMyRequests', () => {
    it('should return paginated leave requests', async () => {
      const requests = [{ id: 'req-1' }, { id: 'req-2' }];
      prisma.leaveRequest.findMany.mockResolvedValue(requests);
      prisma.leaveRequest.count.mockResolvedValue(2);

      const result = await service.getMyRequests(tenantId, employeeId, {
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should apply date and status filters', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.leaveRequest.count.mockResolvedValue(0);

      await service.getMyRequests(tenantId, employeeId, {
        from: '2025-01-01',
        to: '2025-12-31',
        status: 'APPROVED',
        page: 1,
        limit: 10,
      });

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'APPROVED',
            startDate: {
              gte: expect.any(Date),
              lte: expect.any(Date),
            },
          }),
        }),
      );
    });

    it('should handle pagination correctly', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.leaveRequest.count.mockResolvedValue(50);

      const result = await service.getMyRequests(tenantId, employeeId, {
        page: 3,
        limit: 10,
      });

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20, // (3 - 1) * 10
          take: 10,
        }),
      );
      expect(result.meta.totalPages).toBe(5);
    });
  });

  // -----------------------------------------------------------
  // getPendingApprovals
  // -----------------------------------------------------------
  describe('getPendingApprovals', () => {
    it('shows a non-admin only what the engine says they can act on', async () => {
      engine.listActionableEntityIds.mockResolvedValue(['req-1', 'req-2']);
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      await service.getPendingApprovals(managerActor);

      expect(engine.listActionableEntityIds).toHaveBeenCalledWith(managerActor, 'LEAVE');
      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'PENDING', id: { in: ['req-1', 'req-2'] } },
        }),
      );
    });

    it('returns empty when nothing is actionable', async () => {
      engine.listActionableEntityIds.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.getPendingApprovals(managerActor);

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: [] } }),
        }),
      );
      expect(result).toEqual([]);
    });

    it('shows HR_ADMIN / SUPER_ADMIN every pending request in the tenant', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      await service.getPendingApprovals(adminActor);
      await service.getPendingApprovals({ ...adminActor, role: UserRole.HR_ADMIN });

      expect(engine.listActionableEntityIds).not.toHaveBeenCalled();
      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'PENDING' } }),
      );
    });
  });

  // -----------------------------------------------------------
  // approveRequest
  // -----------------------------------------------------------
  describe('approveRequest', () => {
    it('should throw NotFoundException when request not found', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.approveRequest(adminActor, 'req-404', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates the engine\'s 403 and writes nothing when the actor is not an approver', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      engine.act.mockRejectedValue(
        new ForbiddenException('You are not an approver for the current step of this request'),
      );

      await expect(
        service.approveRequest(managerActor, 'req-1', {}),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('asks the engine to act on LEAVE with the actor and note', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
      });
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.approveRequest(managerActor, 'req-1', { approverNote: 'ok' });

      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          entityType: 'LEAVE',
          entityId: 'req-1',
          actor: managerActor,
          decision: 'APPROVE',
          note: 'ok',
          onFinal: expect.any(Function),
        }),
      );
    });

    it('leaves the request PENDING and sends no approved notification when the chain ADVANCES', async () => {
      prisma.leaveRequest.findFirst
        .mockResolvedValueOnce(mockLeaveRequest)
        .mockResolvedValueOnce({ ...mockLeaveRequest, leaveType: mockLeaveType });
      engine.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'inst-1', nextStepOrder: 2 });

      const result = await service.approveRequest(managerActor, 'req-1', {});

      expect(result.status).toBe('PENDING');
      expect(prisma.leaveRequest.update).not.toHaveBeenCalled();
      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.upsert).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });

    it('runs the balance and attendance writes inside onFinal on the final approval', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      const tx = createMockPrismaService() as any;
      tx.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
      });
      tx.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      tx.leaveBalance.update.mockResolvedValue({});
      tx.attendanceRecord.upsert.mockResolvedValue({});
      engine.act.mockImplementation(async (input: any) => {
        // Nothing may be written before the engine hands over its transaction.
        expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
        await input.onFinal(tx);
        return { outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null };
      });

      const result = await service.approveRequest(managerActor, 'req-1', {});

      expect(result.status).toBe('APPROVED');
      expect(tx.leaveRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'req-1', status: 'PENDING' } }),
      );
      expect(tx.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: mockBalance.id },
        data: { usedDays: { increment: 3 }, pendingDays: { decrement: 3 } },
      });
      expect(tx.attendanceRecord.upsert).toHaveBeenCalledTimes(3);
      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.upsert).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        'LEAVE_APPROVED',
        'Leave Request Approved',
        expect.any(String),
        '/leave',
      );
    });

    it('records a null approverId when the approver has no employee record', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
      });
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.approveRequest({ ...adminActor, employeeId: undefined }, 'req-1', {});

      expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ approverId: null }) }),
      );
    });

    it('should allow SUPER_ADMIN to approve any request', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
        employee: { ...mockLeaveRequest.employee, email: 'john@test.com' },
      });
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      const result = await service.approveRequest(adminActor, 'req-1', { approverNote: 'Approved' },
      );

      expect(result.status).toBe('APPROVED');
      expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'APPROVED',
          approverId: 'super-admin-emp',
          approverNote: 'Approved',
          approvedAt: expect.any(Date),
        }),
        include: expect.any(Object),
      });
    });

    it('should throw ConflictException and leave the balance untouched when another approver already processed the request', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);

      await expect(
        service.approveRequest(adminActor, 'req-1', {}),
      ).rejects.toThrow(ConflictException);

      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.upsert).not.toHaveBeenCalled();
    });

    describe('leave.approved webhook', () => {
      const approvedRow = {
        ...mockLeaveRequest,
        status: 'APPROVED',
        approverId,
        approvedAt: new Date('2025-03-01T12:00:00Z'),
        leaveType: mockLeaveType,
        employee: { ...mockLeaveRequest.employee, email: 'john@test.com' },
      };

      beforeEach(() => {
        prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
        prisma.leaveRequest.update.mockResolvedValue(approvedRow);
        prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
        prisma.leaveBalance.update.mockResolvedValue({});
        prisma.attendanceRecord.upsert.mockResolvedValue({});
      });

      it('fires leave.approved with a minimal payload after the transaction commits', async () => {
        let committed = false;
        prisma.$transaction.mockImplementationOnce(async (fn: any) => {
          const result = await fn(prisma);
          committed = true;
          return result;
        });
        webhooks.dispatch.mockImplementation(async () => {
          expect(committed).toBe(true);
        });

        await service.approveRequest(managerActor, 'req-1', {});

        expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
        expect(webhooks.dispatch).toHaveBeenCalledWith(tenantId, 'leave.approved', {
          leaveRequestId: 'req-1',
          employeeId,
          leaveTypeId: 'lt-1',
          leaveTypeCode: 'CL',
          startDate: mockLeaveRequest.startDate.toISOString(),
          endDate: mockLeaveRequest.endDate.toISOString(),
          totalDays: 3,
          status: 'APPROVED',
          approverId,
          approvedAt: '2025-03-01T12:00:00.000Z',
        });
        const payload = webhooks.dispatch.mock.calls[0][2];
        expect(payload).not.toHaveProperty('reason');
        expect(payload).not.toHaveProperty('email');
      });

      it('does not wait for webhook delivery before returning', async () => {
        webhooks.dispatch.mockReturnValue(new Promise(() => {}));

        const result = await service.approveRequest(managerActor, 'req-1', {});

        expect(result.status).toBe('APPROVED');
        expect(webhooks.dispatch).toHaveBeenCalled();
      });

      it('does not fire when the approval loses the race', async () => {
        prisma.leaveRequest.update.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
            code: 'P2025',
            clientVersion: 'test',
          }),
        );

        await expect(
          service.approveRequest(managerActor, 'req-1', {}),
        ).rejects.toThrow(ConflictException);
        expect(webhooks.dispatch).not.toHaveBeenCalled();
      });
    });

    it('should update leave balance on approval', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
        employee: { ...mockLeaveRequest.employee, email: 'john@test.com' },
      });
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.approveRequest(managerActor, 'req-1', {});

      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: mockBalance.id },
        data: {
          usedDays: { increment: 3 },
          pendingDays: { decrement: 3 },
        },
      });
    });

    it('should mark attendance as LEAVE for the leave dates', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
        employee: { ...mockLeaveRequest.employee, email: 'john@test.com' },
      });
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.approveRequest(managerActor, 'req-1', {});

      // 2025-03-10 (Mon), 2025-03-11 (Tue), 2025-03-12 (Wed) - all weekdays
      expect(prisma.attendanceRecord.upsert).toHaveBeenCalledTimes(3);
    });

    // `AttendanceRecord.date` is `@db.Date` and the auto-absent sweep keys on
    // the UTC midnight of the IST calendar day. LEAVE rows written from
    // server-local parts would land on a different day, where the sweep would
    // not see them and would mark the employee ABSENT for a day they were on
    // approved leave.
    it('writes the LEAVE rows on UTC-midnight keys', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-12-31T21:30:00Z'));
      try {
        prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
        prisma.leaveRequest.update.mockResolvedValue({
          ...mockLeaveRequest,
          status: 'APPROVED',
          leaveType: mockLeaveType,
          employee: { ...mockLeaveRequest.employee, email: 'john@test.com' },
        });
        prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
        prisma.leaveBalance.update.mockResolvedValue({});
        prisma.attendanceRecord.upsert.mockResolvedValue({});

        await service.approveRequest(managerActor, 'req-1', {});

        const days = prisma.attendanceRecord.upsert.mock.calls.map(
          (c: any) => c[0].where.tenantId_employeeId_date.date,
        );
        expect(days).toEqual([
          new Date('2025-03-10T00:00:00.000Z'),
          new Date('2025-03-11T00:00:00.000Z'),
          new Date('2025-03-12T00:00:00.000Z'),
        ]);
        // The create branch has to agree with the key it upserts on.
        expect(prisma.attendanceRecord.upsert.mock.calls[0][0].create.date).toEqual(
          new Date('2025-03-10T00:00:00.000Z'),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('should notify the employee after approval', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
        employee: { ...mockLeaveRequest.employee, email: 'john@test.com' },
      });
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.approveRequest(managerActor, 'req-1', {});

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        'LEAVE_APPROVED',
        'Leave Request Approved',
        expect.stringContaining('approved'),
        '/leave',
      );
    });
  });

  // -----------------------------------------------------------
  // rejectRequest
  // -----------------------------------------------------------
  describe('rejectRequest', () => {
    it('should throw NotFoundException when request not found', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.rejectRequest(managerActor, 'req-404', {
          approverNote: 'rejected',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates the engine\'s 403 and releases nothing', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      engine.act.mockRejectedValue(new ForbiddenException('not an approver'));

      await expect(
        service.rejectRequest(managerActor, 'req-1', {}),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('asks the engine to act with REJECT', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'REJECTED',
        leaveType: mockLeaveType,
      });
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.rejectRequest(managerActor, 'req-1', { approverNote: 'no' });

      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'LEAVE',
          entityId: 'req-1',
          decision: 'REJECT',
          note: 'no',
        }),
      );
    });

    it('should reject request and decrement pending days', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'REJECTED',
        leaveType: mockLeaveType,
        employee: { ...mockLeaveRequest.employee, email: 'john@test.com' },
      });
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      prisma.leaveBalance.update.mockResolvedValue({});

      const result = await service.rejectRequest(managerActor, 'req-1', { approverNote: 'Not enough coverage' },
      );

      expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'REJECTED',
          approverNote: 'Not enough coverage',
        }),
        include: expect.any(Object),
      });
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: mockBalance.id },
        data: {
          pendingDays: { decrement: 3 },
        },
      });
      expect(result.status).toBe('REJECTED');
    });

    it('should throw ConflictException and not decrement pending days when the request was already processed', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);

      await expect(
        service.rejectRequest(managerActor, 'req-1', {}),
      ).rejects.toThrow(ConflictException);

      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    });

    it('should notify the employee after rejection', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'REJECTED',
        leaveType: mockLeaveType,
        employee: { ...mockLeaveRequest.employee, email: 'john@test.com' },
      });
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.rejectRequest(adminActor, 'req-1', {
        approverNote: 'Denied',
      });

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        employeeId,
        'LEAVE_REJECTED',
        'Leave Request Rejected',
        expect.stringContaining('rejected'),
        '/leave',
      );
    });
  });

  // -----------------------------------------------------------
  // cancelRequest
  // -----------------------------------------------------------
  describe('cancelRequest', () => {
    it('should throw NotFoundException when request not found or not owned', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelRequest(tenantId, 'req-404', employeeId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should cancel request and decrement pending days', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'CANCELLED',
      });
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);
      prisma.leaveBalance.update.mockResolvedValue({});

      const result = await service.cancelRequest(tenantId, 'req-1', employeeId);

      expect(prisma.leaveRequest.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'req-1',
          tenantId,
          employeeId,
          status: 'PENDING',
        },
      });
      expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      expect(engine.cancel).toHaveBeenCalledWith(tenantId, 'LEAVE', 'req-1', prisma);
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: mockBalance.id },
        data: {
          pendingDays: { decrement: 3 },
        },
      });
      expect(result.status).toBe('CANCELLED');
    });

    it('should throw ConflictException and not decrement pending days when the request was already processed', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );
      prisma.leaveBalance.findMany.mockResolvedValue([mockBalance]);

      await expect(
        service.cancelRequest(tenantId, 'req-1', employeeId),
      ).rejects.toThrow(ConflictException);

      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    });

    it('should not update balance when no balance record exists', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'CANCELLED',
      });
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.cancelRequest(tenantId, 'req-1', employeeId);

      expect(prisma.leaveBalance.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------
  // createLeaveType
  // -----------------------------------------------------------
  describe('createLeaveType', () => {
    const createTypeDto = {
      name: 'Sick Leave',
      code: 'SL',
      description: 'Medical leave',
      defaultDays: 10,
      carryForward: true,
      maxCarryForward: 5,
      isPaid: true,
    };

    it('should throw ConflictException when code already exists', async () => {
      prisma.leaveType.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createLeaveType(tenantId, createTypeDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a new leave type', async () => {
      prisma.leaveType.findUnique.mockResolvedValue(null);
      prisma.leaveType.create.mockResolvedValue({
        id: 'lt-new',
        tenantId,
        ...createTypeDto,
      });
      prisma.employee.findMany.mockResolvedValue([]);

      const result = await service.createLeaveType(tenantId, createTypeDto);

      expect(prisma.leaveType.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          name: 'Sick Leave',
          code: 'SL',
          description: 'Medical leave',
          defaultDays: 10,
          carryForward: true,
          maxCarryForward: 5,
          isPaid: true,
        },
      });
      expect(result.id).toBe('lt-new');
    });

    it('should use defaults for optional fields', async () => {
      prisma.leaveType.findUnique.mockResolvedValue(null);
      prisma.leaveType.create.mockResolvedValue({ id: 'lt-new' });
      prisma.employee.findMany.mockResolvedValue([]);

      await service.createLeaveType(tenantId, {
        name: 'Basic Leave',
        code: 'BL',
      });

      expect(prisma.leaveType.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          defaultDays: 0,
          carryForward: false,
          isPaid: true,
        }),
      });
    });
  });

  // -----------------------------------------------------------
  // updateBalance
  // -----------------------------------------------------------
  describe('updateBalance', () => {
    it('should update existing balance', async () => {
      // updateBalance targets one specific year, so it still uses findFirst.
      prisma.leaveBalance.findFirst.mockResolvedValue(mockBalance);
      prisma.leaveBalance.update.mockResolvedValue({
        ...mockBalance,
        totalDays: 15,
        leaveType: mockLeaveType,
      });

      const result = await service.updateBalance(
        tenantId,
        employeeId,
        'lt-1',
        2025,
        { totalDays: 15, carriedOver: 3 },
      );

      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: mockBalance.id },
        data: { totalDays: 15, carriedOver: 3 },
        include: { leaveType: true },
      });
      expect(result.totalDays).toBe(15);
    });

    it('should create balance when none exists', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([]);
      prisma.leaveBalance.create.mockResolvedValue({
        id: 'bal-new',
        totalDays: 20,
        leaveType: mockLeaveType,
      });

      const result = await service.updateBalance(
        tenantId,
        employeeId,
        'lt-1',
        2025,
        { totalDays: 20 },
      );

      expect(prisma.leaveBalance.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          employeeId,
          leaveTypeId: 'lt-1',
          year: 2025,
          totalDays: 20,
          carriedOver: 0,
          usedDays: 0,
          pendingDays: 0,
        },
        include: { leaveType: true },
      });
      expect(result.id).toBe('bal-new');
    });
  });

  // -----------------------------------------------------------
  // initializeBalances
  // -----------------------------------------------------------
  describe('initializeBalances', () => {
    it('should create balances for all employees and leave types', async () => {
      prisma.leaveType.findMany.mockResolvedValue([
        { id: 'lt-1', defaultDays: 12 },
        { id: 'lt-2', defaultDays: 6 },
      ]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1' },
        { id: 'emp-2' },
      ]);
      prisma.leaveBalance.findMany.mockResolvedValue([]); // no existing
      prisma.leaveBalance.create.mockResolvedValue({});

      const result = await service.initializeBalances(tenantId, { year: 2025 });

      // 2 employees x 2 leave types = 4 balance records
      expect(prisma.leaveBalance.create).toHaveBeenCalledTimes(4);
      expect(result.created).toBe(4);
      expect(result.skipped).toBe(0);
      expect(result.totalEmployees).toBe(2);
      expect(result.totalLeaveTypes).toBe(2);
    });

    it('should skip existing balances', async () => {
      prisma.leaveType.findMany.mockResolvedValue([{ id: 'lt-1', defaultDays: 12 }]);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
      prisma.leaveBalance.findFirst.mockResolvedValue({ id: 'existing' });

      const result = await service.initializeBalances(tenantId, { year: 2025 });

      expect(prisma.leaveBalance.create).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('should filter employees by IDs when provided', async () => {
      prisma.leaveType.findMany.mockResolvedValue([]);
      prisma.employee.findMany.mockResolvedValue([]);

      await service.initializeBalances(tenantId, {
        year: 2025,
        employeeIds: ['emp-1', 'emp-3'],
      });

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          status: 'ACTIVE',
          id: { in: ['emp-1', 'emp-3'] },
        },
        select: { id: true },
      });
    });
  });

  // -----------------------------------------------------------
  // getAllRequests
  // -----------------------------------------------------------
  describe('getAllRequests', () => {
    it('should return paginated admin results with all filters', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.leaveRequest.count.mockResolvedValue(0);

      await service.getAllRequests(tenantId, {
        from: '2025-01-01',
        to: '2025-12-31',
        status: 'APPROVED',
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        page: 2,
        limit: 10,
      });

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId,
            status: 'APPROVED',
            employeeId: 'emp-1',
            leaveTypeId: 'lt-1',
            startDate: {
              gte: expect.any(Date),
              lte: expect.any(Date),
            },
          }),
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should apply only tenantId when no filters provided', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.leaveRequest.count.mockResolvedValue(0);

      await service.getAllRequests(tenantId, {});

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId },
        }),
      );
    });
  });

  // -----------------------------------------------------------
  // getAnalytics
  // -----------------------------------------------------------
  describe('getAnalytics', () => {
    it('should return analytics for the specified year', async () => {
      prisma.leaveRequest.groupBy
        .mockResolvedValueOnce([
          { status: 'APPROVED', _count: { id: 10 } },
          { status: 'REJECTED', _count: { id: 3 } },
          { status: 'PENDING', _count: { id: 2 } },
        ])
        .mockResolvedValueOnce([
          { leaveTypeId: 'lt-1', _sum: { totalDays: 25 }, _count: { id: 8 } },
        ]);

      prisma.leaveType.findMany.mockResolvedValue([mockLeaveType]);
      prisma.leaveRequest.findMany.mockResolvedValue([
        { startDate: new Date('2025-03-10'), totalDays: 3 },
        { startDate: new Date('2025-03-20'), totalDays: 2 },
        { startDate: new Date('2025-06-15'), totalDays: 5 },
      ]);

      const result = await service.getAnalytics(tenantId, 2025);

      expect(result.year).toBe(2025);
      expect(result.requestsByStatus).toEqual({
        APPROVED: 10,
        REJECTED: 3,
        PENDING: 2,
      });
      expect(result.usageByType).toHaveLength(1);
      expect(result.usageByType[0].leaveType).toEqual(mockLeaveType);
      expect(result.usageByType[0].totalDays).toBe(25);
      // Monthly data: March (index 2) = 3 + 2 = 5, June (index 5) = 5
      expect(result.monthlyUsage[2]).toBe(5);
      expect(result.monthlyUsage[5]).toBe(5);
    });

    it('should default to current year when not specified', async () => {
      prisma.leaveRequest.groupBy.mockResolvedValue([]);
      prisma.leaveType.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.getAnalytics(tenantId);

      expect(result.year).toBe(new Date().getFullYear());
    });
  });

  // -----------------------------------------------------------
  // updateLeaveType
  // -----------------------------------------------------------
  describe('updateLeaveType', () => {
    it('should throw NotFoundException when leave type not found', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(null);

      await expect(
        service.updateLeaveType(tenantId, 'lt-404', {
          name: 'Updated',
          code: 'UP',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when changing to an existing code', async () => {
      prisma.leaveType.findFirst.mockResolvedValue({
        ...mockLeaveType,
        code: 'CL',
      });
      prisma.leaveType.findUnique.mockResolvedValue({ id: 'other-type' });

      await expect(
        service.updateLeaveType(tenantId, 'lt-1', {
          name: 'Updated',
          code: 'SL', // different from 'CL', and already exists
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should update leave type successfully', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveType.update.mockResolvedValue({
        ...mockLeaveType,
        name: 'Updated CL',
      });

      const result = await service.updateLeaveType(tenantId, 'lt-1', {
        name: 'Updated CL',
        code: 'CL', // same code, no conflict check needed
      });

      expect(prisma.leaveType.update).toHaveBeenCalledWith({
        where: { id: 'lt-1' },
        data: expect.objectContaining({ name: 'Updated CL' }),
      });
      expect(result.name).toBe('Updated CL');
    });
  });

  // -----------------------------------------------------------
  // deleteLeaveType
  // -----------------------------------------------------------
  describe('deleteLeaveType', () => {
    it('should throw NotFoundException when leave type not found', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteLeaveType(tenantId, 'lt-404'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should soft-delete by setting isActive to false', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveType.update.mockResolvedValue({
        ...mockLeaveType,
        isActive: false,
      });

      const result = await service.deleteLeaveType(tenantId, 'lt-1');

      expect(prisma.leaveType.update).toHaveBeenCalledWith({
        where: { id: 'lt-1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });
  });

  // -----------------------------------------------------------
  // getAllBalances
  // -----------------------------------------------------------
  describe('getAllBalances', () => {
    it('should return all balances for the target year', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.getAllBalances(tenantId, 2025);

      expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith({
        where: { tenantId, year: 2025 },
        include: expect.objectContaining({
          leaveType: true,
          employee: expect.any(Object),
        }),
        orderBy: expect.any(Array),
      });
    });

    it('should default to current year when not specified', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      await service.getAllBalances(tenantId);

      expect(prisma.leaveBalance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, year: new Date().getFullYear() },
        }),
      );
    });
  });
});
