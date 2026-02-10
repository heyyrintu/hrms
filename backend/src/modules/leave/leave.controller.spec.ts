import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockLeaveService = {
  getLeaveTypes: jest.fn(),
  getBalances: jest.fn(),
  getMyRequests: jest.fn(),
  getPendingApprovals: jest.fn(),
  createRequest: jest.fn(),
  cancelRequest: jest.fn(),
  approveRequest: jest.fn(),
  rejectRequest: jest.fn(),
  createLeaveType: jest.fn(),
  updateLeaveType: jest.fn(),
  deleteLeaveType: jest.fn(),
  getAllBalances: jest.fn(),
  updateBalance: jest.fn(),
  initializeBalances: jest.fn(),
  getAllRequests: jest.fn(),
  getAnalytics: jest.fn(),
};

describe('LeaveController', () => {
  let controller: LeaveController;
  let service: typeof mockLeaveService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  const managerUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'manager@test.com',
    tenantId: 'tenant-1',
    role: UserRole.MANAGER,
    employeeId: 'emp-mgr',
  };

  const employeeUser: AuthenticatedUser = {
    userId: 'user-3',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-3',
  };

  const userWithoutEmployee: AuthenticatedUser = {
    userId: 'user-4',
    email: 'noemp@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockLeaveService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaveController],
      providers: [{ provide: LeaveService, useValue: mockLeaveService }],
    }).compile();

    controller = module.get<LeaveController>(LeaveController);
    service = module.get(LeaveService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ==========================================
  // Employee Endpoints
  // ==========================================

  describe('getLeaveTypes', () => {
    it('should call leaveService.getLeaveTypes with tenantId', async () => {
      const mockResult = [{ id: 'lt-1', name: 'Casual Leave' }];
      service.getLeaveTypes.mockResolvedValue(mockResult);

      const result = await controller.getLeaveTypes(employeeUser);

      expect(service.getLeaveTypes).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getMyBalances', () => {
    it('should call leaveService.getBalances with tenantId, employeeId, and year', async () => {
      const query = { year: 2025 };
      const mockResult = [{ leaveType: 'CL', balance: 10, used: 2 }];
      service.getBalances.mockResolvedValue(mockResult);

      const result = await controller.getMyBalances(
        employeeUser,
        query as any,
      );

      expect(service.getBalances).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        2025,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.getMyBalances(userWithoutEmployee, { year: 2025 } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMyRequests', () => {
    it('should call leaveService.getMyRequests with tenantId, employeeId, and query', async () => {
      const query = { status: 'PENDING' };
      const mockResult = { data: [], total: 0 };
      service.getMyRequests.mockResolvedValue(mockResult);

      const result = await controller.getMyRequests(
        employeeUser,
        query as any,
      );

      expect(service.getMyRequests).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        query,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.getMyRequests(userWithoutEmployee, {} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPendingApprovals', () => {
    it('should call leaveService.getPendingApprovals with tenantId and employeeId', async () => {
      const mockResult = [{ id: 'lr-1', status: 'PENDING' }];
      service.getPendingApprovals.mockResolvedValue(mockResult);

      const result = await controller.getPendingApprovals(managerUser);

      expect(service.getPendingApprovals).toHaveBeenCalledWith(
        'tenant-1',
        'emp-mgr',
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.getPendingApprovals(userWithoutEmployee),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createRequest', () => {
    it('should call leaveService.createRequest with tenantId, employeeId, and dto', async () => {
      const dto = {
        leaveTypeId: 'lt-1',
        startDate: '2025-02-01',
        endDate: '2025-02-03',
      };
      const mockResult = { id: 'lr-1', status: 'PENDING' };
      service.createRequest.mockResolvedValue(mockResult);

      const result = await controller.createRequest(
        employeeUser,
        dto as any,
      );

      expect(service.createRequest).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        dto,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.createRequest(userWithoutEmployee, {} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelRequest', () => {
    it('should call leaveService.cancelRequest with tenantId, id, and employeeId', async () => {
      const mockResult = { id: 'lr-1', status: 'CANCELLED' };
      service.cancelRequest.mockResolvedValue(mockResult);

      const result = await controller.cancelRequest(employeeUser, 'lr-1');

      expect(service.cancelRequest).toHaveBeenCalledWith(
        'tenant-1',
        'lr-1',
        'emp-3',
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.cancelRequest(userWithoutEmployee, 'lr-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveRequest', () => {
    it('should call leaveService.approveRequest with tenantId, id, employeeId, role, and dto', async () => {
      const dto = { comment: 'Approved' };
      const mockResult = { id: 'lr-1', status: 'APPROVED' };
      service.approveRequest.mockResolvedValue(mockResult);

      const result = await controller.approveRequest(
        managerUser,
        'lr-1',
        dto as any,
      );

      expect(service.approveRequest).toHaveBeenCalledWith(
        'tenant-1',
        'lr-1',
        'emp-mgr',
        UserRole.MANAGER,
        dto,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.approveRequest(userWithoutEmployee, 'lr-1', {} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectRequest', () => {
    it('should call leaveService.rejectRequest with tenantId, id, employeeId, role, and dto', async () => {
      const dto = { reason: 'Staffing issues' };
      const mockResult = { id: 'lr-1', status: 'REJECTED' };
      service.rejectRequest.mockResolvedValue(mockResult);

      const result = await controller.rejectRequest(
        managerUser,
        'lr-1',
        dto as any,
      );

      expect(service.rejectRequest).toHaveBeenCalledWith(
        'tenant-1',
        'lr-1',
        'emp-mgr',
        UserRole.MANAGER,
        dto,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.rejectRequest(userWithoutEmployee, 'lr-1', {} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================
  // Admin Endpoints
  // ==========================================

  describe('createLeaveType', () => {
    it('should call leaveService.createLeaveType with tenantId and dto', async () => {
      const dto = { name: 'Sick Leave', daysAllowed: 12 };
      const mockResult = { id: 'lt-new', ...dto };
      service.createLeaveType.mockResolvedValue(mockResult);

      const result = await controller.createLeaveType(adminUser, dto as any);

      expect(service.createLeaveType).toHaveBeenCalledWith('tenant-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('updateLeaveType', () => {
    it('should call leaveService.updateLeaveType with tenantId, id, and dto', async () => {
      const dto = { name: 'Updated Sick Leave', daysAllowed: 15 };
      const mockResult = { id: 'lt-1', ...dto };
      service.updateLeaveType.mockResolvedValue(mockResult);

      const result = await controller.updateLeaveType(
        adminUser,
        'lt-1',
        dto as any,
      );

      expect(service.updateLeaveType).toHaveBeenCalledWith(
        'tenant-1',
        'lt-1',
        dto,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('deleteLeaveType', () => {
    it('should call leaveService.deleteLeaveType with tenantId and id', async () => {
      const mockResult = { id: 'lt-1', deletedAt: new Date() };
      service.deleteLeaveType.mockResolvedValue(mockResult);

      const result = await controller.deleteLeaveType(adminUser, 'lt-1');

      expect(service.deleteLeaveType).toHaveBeenCalledWith('tenant-1', 'lt-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getAllBalances', () => {
    it('should call leaveService.getAllBalances with tenantId and year', async () => {
      const query = { year: 2025 };
      const mockResult = [{ employeeId: 'emp-1', balances: [] }];
      service.getAllBalances.mockResolvedValue(mockResult);

      const result = await controller.getAllBalances(adminUser, query as any);

      expect(service.getAllBalances).toHaveBeenCalledWith('tenant-1', 2025);
      expect(result).toEqual(mockResult);
    });
  });

  describe('getEmployeeBalance', () => {
    it('should call leaveService.getBalances with tenantId, employeeId, and year', async () => {
      const query = { year: 2025 };
      const mockResult = [{ leaveType: 'CL', balance: 10 }];
      service.getBalances.mockResolvedValue(mockResult);

      const result = await controller.getEmployeeBalance(
        adminUser,
        'emp-3',
        query as any,
      );

      expect(service.getBalances).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        2025,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('updateEmployeeBalance', () => {
    it('should call leaveService.updateBalance with tenantId, employeeId, leaveTypeId, year, and dto', async () => {
      const dto = { totalDays: 15 };
      const mockResult = { id: 'bal-1', totalDays: 15 };
      service.updateBalance.mockResolvedValue(mockResult);

      const result = await controller.updateEmployeeBalance(
        adminUser,
        'emp-3',
        'lt-1',
        2025,
        dto as any,
      );

      expect(service.updateBalance).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        'lt-1',
        2025,
        dto,
      );
      expect(result).toEqual(mockResult);
    });

    it('should default to current year if year is not provided', async () => {
      const dto = { totalDays: 10 };
      const currentYear = new Date().getFullYear();
      service.updateBalance.mockResolvedValue({});

      await controller.updateEmployeeBalance(
        adminUser,
        'emp-3',
        'lt-1',
        undefined as any,
        dto as any,
      );

      expect(service.updateBalance).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        'lt-1',
        currentYear,
        dto,
      );
    });
  });

  describe('initializeBalances', () => {
    it('should call leaveService.initializeBalances with tenantId and dto', async () => {
      const dto = { year: 2025 };
      const mockResult = { initialized: 50 };
      service.initializeBalances.mockResolvedValue(mockResult);

      const result = await controller.initializeBalances(
        adminUser,
        dto as any,
      );

      expect(service.initializeBalances).toHaveBeenCalledWith(
        'tenant-1',
        dto,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('getAllRequests', () => {
    it('should call leaveService.getAllRequests with tenantId and query', async () => {
      const query = { status: 'PENDING', page: 1, limit: 10 };
      const mockResult = { data: [], total: 0 };
      service.getAllRequests.mockResolvedValue(mockResult);

      const result = await controller.getAllRequests(adminUser, query as any);

      expect(service.getAllRequests).toHaveBeenCalledWith('tenant-1', query);
      expect(result).toEqual(mockResult);
    });
  });

  describe('getAnalytics', () => {
    it('should call leaveService.getAnalytics with tenantId and year', async () => {
      const mockResult = { totalRequests: 100, approved: 80 };
      service.getAnalytics.mockResolvedValue(mockResult);

      const result = await controller.getAnalytics(adminUser, 2025);

      expect(service.getAnalytics).toHaveBeenCalledWith('tenant-1', 2025);
      expect(result).toEqual(mockResult);
    });

    it('should pass undefined year if not provided', async () => {
      service.getAnalytics.mockResolvedValue({});

      await controller.getAnalytics(adminUser, undefined);

      expect(service.getAnalytics).toHaveBeenCalledWith(
        'tenant-1',
        undefined,
      );
    });
  });
});
