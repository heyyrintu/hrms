import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { LeaveService } from './leave.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('LeaveService', () => {
  let service: LeaveService;
  let prisma: any;
  let notifications: any;

  const tenantId = 'test-tenant';
  const employeeId = 'emp-1';
  const approverId = 'emp-manager';

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
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();

    service = module.get<LeaveService>(LeaveService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
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
        where: { tenantId, employeeId, year: 2025 },
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
      prisma.leaveBalance.findFirst.mockResolvedValue({
        ...mockBalance,
        totalDays: 2,
        usedDays: 1,
        pendingDays: 1,
        carriedOver: 0,
      });

      // Available = 2 + 0 - 1 - 1 = 0, requesting 3 days (Mon-Wed)
      await expect(
        service.createRequest(tenantId, employeeId, createDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow LOP leave even with insufficient balance', async () => {
      const lopType = { ...mockLeaveType, id: 'lt-lop', code: 'LOP' };
      prisma.leaveType.findFirst.mockResolvedValue(lopType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findFirst.mockResolvedValue(null); // no balance at all

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

    it('should create request and increment pending days in balance', async () => {
      prisma.leaveType.findFirst.mockResolvedValue(mockLeaveType);
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      prisma.leaveBalance.findFirst.mockResolvedValue(mockBalance);

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

      const result = await service.createRequest(tenantId, employeeId, createDto);

      expect(prisma.leaveRequest.create).toHaveBeenCalled();
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
      prisma.leaveBalance.findFirst.mockResolvedValue(null);

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
    it('should return pending requests for the manager direct reports', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1' },
        { id: 'emp-2' },
      ]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      await service.getPendingApprovals(tenantId, approverId);

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          managerId: approverId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: { in: ['emp-1', 'emp-2'] },
            status: 'PENDING',
          }),
        }),
      );
    });

    it('should return empty when manager has no direct reports', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.getPendingApprovals(tenantId, approverId);

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: { in: [] },
          }),
        }),
      );
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------
  // approveRequest
  // -----------------------------------------------------------
  describe('approveRequest', () => {
    it('should throw NotFoundException when request not found', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.approveRequest(tenantId, 'req-404', approverId, 'SUPER_ADMIN', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when MANAGER approves non-direct report', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue({
        ...mockLeaveRequest,
        employee: { id: employeeId, managerId: 'some-other-manager' },
      });

      await expect(
        service.approveRequest(tenantId, 'req-1', approverId, 'MANAGER', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow SUPER_ADMIN to approve any request', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
        employee: mockLeaveRequest.employee,
      });
      prisma.leaveBalance.findFirst.mockResolvedValue(mockBalance);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      const result = await service.approveRequest(
        tenantId,
        'req-1',
        'super-admin-emp',
        'SUPER_ADMIN',
        { approverNote: 'Approved' },
      );

      expect(result.status).toBe('APPROVED');
      expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: expect.objectContaining({
          status: 'APPROVED',
          approverId: 'super-admin-emp',
          approverNote: 'Approved',
          approvedAt: expect.any(Date),
        }),
        include: expect.any(Object),
      });
    });

    it('should update leave balance on approval', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
        employee: mockLeaveRequest.employee,
      });
      prisma.leaveBalance.findFirst.mockResolvedValue(mockBalance);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.approveRequest(tenantId, 'req-1', approverId, 'MANAGER', {});

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
        employee: mockLeaveRequest.employee,
      });
      prisma.leaveBalance.findFirst.mockResolvedValue(mockBalance);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.approveRequest(tenantId, 'req-1', approverId, 'MANAGER', {});

      // 2025-03-10 (Mon), 2025-03-11 (Tue), 2025-03-12 (Wed) - all weekdays
      expect(prisma.attendanceRecord.upsert).toHaveBeenCalledTimes(3);
    });

    it('should notify the employee after approval', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'APPROVED',
        leaveType: mockLeaveType,
        employee: mockLeaveRequest.employee,
      });
      prisma.leaveBalance.findFirst.mockResolvedValue(mockBalance);
      prisma.leaveBalance.update.mockResolvedValue({});
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.approveRequest(tenantId, 'req-1', approverId, 'MANAGER', {});

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
        service.rejectRequest(tenantId, 'req-404', approverId, 'MANAGER', {
          approverNote: 'rejected',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when MANAGER rejects non-direct report', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue({
        ...mockLeaveRequest,
        employee: { id: employeeId, managerId: 'another-mgr' },
      });

      await expect(
        service.rejectRequest(tenantId, 'req-1', approverId, 'MANAGER', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject request and decrement pending days', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'REJECTED',
        leaveType: mockLeaveType,
        employee: mockLeaveRequest.employee,
      });
      prisma.leaveBalance.findFirst.mockResolvedValue(mockBalance);
      prisma.leaveBalance.update.mockResolvedValue({});

      const result = await service.rejectRequest(
        tenantId,
        'req-1',
        approverId,
        'MANAGER',
        { approverNote: 'Not enough coverage' },
      );

      expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
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

    it('should notify the employee after rejection', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'REJECTED',
        leaveType: mockLeaveType,
        employee: mockLeaveRequest.employee,
      });
      prisma.leaveBalance.findFirst.mockResolvedValue(null);

      await service.rejectRequest(tenantId, 'req-1', approverId, 'SUPER_ADMIN', {
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
      prisma.leaveBalance.findFirst.mockResolvedValue(mockBalance);
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
        where: { id: 'req-1' },
        data: { status: 'CANCELLED' },
      });
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith({
        where: { id: mockBalance.id },
        data: {
          pendingDays: { decrement: 3 },
        },
      });
      expect(result.status).toBe('CANCELLED');
    });

    it('should not update balance when no balance record exists', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(mockLeaveRequest);
      prisma.leaveRequest.update.mockResolvedValue({
        ...mockLeaveRequest,
        status: 'CANCELLED',
      });
      prisma.leaveBalance.findFirst.mockResolvedValue(null);

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
      prisma.leaveBalance.findFirst.mockResolvedValue(null);
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
      prisma.leaveBalance.findFirst.mockResolvedValue(null); // no existing
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
