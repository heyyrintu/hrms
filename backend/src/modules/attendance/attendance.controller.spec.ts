import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockAttendanceService = {
  clockIn: jest.fn(),
  clockOut: jest.fn(),
  getTodayStatus: jest.fn(),
  getMyAttendance: jest.fn(),
  getAttendanceSummary: jest.fn(),
  createManualAttendance: jest.fn(),
  getEmployeeAttendance: jest.fn(),
  getPayableHours: jest.fn(),
  getPendingOtApprovals: jest.fn(),
  approveOt: jest.fn(),
};

const mockPrismaService = {
  employee: {
    findFirst: jest.fn(),
  },
};

describe('AttendanceController', () => {
  let controller: AttendanceController;
  let service: typeof mockAttendanceService;
  let prisma: typeof mockPrismaService;

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
    Object.values(mockAttendanceService).forEach((fn) => fn.mockReset());
    mockPrismaService.employee.findFirst.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        { provide: AttendanceService, useValue: mockAttendanceService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    controller = module.get<AttendanceController>(AttendanceController);
    service = module.get(AttendanceService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ==========================================
  // clockIn
  // ==========================================
  describe('clockIn', () => {
    it('should call attendanceService.clockIn with tenantId, employeeId, and dto', async () => {
      const dto = { notes: 'Morning shift' };
      const mockResult = { id: 'att-1', clockIn: new Date() };
      service.clockIn.mockResolvedValue(mockResult);

      const result = await controller.clockIn(employeeUser, dto as any);

      expect(service.clockIn).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        dto,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      const dto = { notes: 'test' };

      await expect(
        controller.clockIn(userWithoutEmployee, dto as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================
  // clockOut
  // ==========================================
  describe('clockOut', () => {
    it('should call attendanceService.clockOut with tenantId, employeeId, and dto', async () => {
      const dto = { notes: 'End of shift' };
      const mockResult = { id: 'att-1', clockOut: new Date() };
      service.clockOut.mockResolvedValue(mockResult);

      const result = await controller.clockOut(employeeUser, dto as any);

      expect(service.clockOut).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        dto,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      const dto = { notes: 'test' };

      await expect(
        controller.clockOut(userWithoutEmployee, dto as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================
  // getTodayStatus
  // ==========================================
  describe('getTodayStatus', () => {
    it('should call attendanceService.getTodayStatus with tenantId and employeeId', async () => {
      const mockResult = { status: 'clocked-in', clockIn: new Date() };
      service.getTodayStatus.mockResolvedValue(mockResult);

      const result = await controller.getTodayStatus(employeeUser);

      expect(service.getTodayStatus).toHaveBeenCalledWith('tenant-1', 'emp-3');
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.getTodayStatus(userWithoutEmployee),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================
  // getMyAttendance
  // ==========================================
  describe('getMyAttendance', () => {
    it('should call attendanceService.getMyAttendance with tenantId, employeeId, and query', async () => {
      const query = { startDate: '2025-01-01', endDate: '2025-01-31' };
      const mockResult = { data: [], total: 0 };
      service.getMyAttendance.mockResolvedValue(mockResult);

      const result = await controller.getMyAttendance(
        employeeUser,
        query as any,
      );

      expect(service.getMyAttendance).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        query,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw BadRequestException if user has no employeeId', async () => {
      await expect(
        controller.getMyAttendance(userWithoutEmployee, {} as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================
  // getAttendanceSummary
  // ==========================================
  describe('getAttendanceSummary', () => {
    it('should call attendanceService.getAttendanceSummary with tenantId and query', async () => {
      const query = { date: '2025-01-15' };
      const mockResult = { present: 10, absent: 2, late: 1 };
      service.getAttendanceSummary.mockResolvedValue(mockResult);

      const result = await controller.getAttendanceSummary(
        adminUser,
        query as any,
      );

      expect(service.getAttendanceSummary).toHaveBeenCalledWith(
        'tenant-1',
        query,
      );
      expect(result).toEqual(mockResult);
    });
  });

  // ==========================================
  // createManualAttendance
  // ==========================================
  describe('createManualAttendance', () => {
    it('should call attendanceService.createManualAttendance with tenantId and dto', async () => {
      const dto = {
        employeeId: 'emp-3',
        date: '2025-01-15',
        clockIn: '09:00',
        clockOut: '17:00',
      };
      const mockResult = { id: 'att-manual', ...dto };
      service.createManualAttendance.mockResolvedValue(mockResult);

      const result = await controller.createManualAttendance(
        adminUser,
        dto as any,
      );

      expect(service.createManualAttendance).toHaveBeenCalledWith(
        'tenant-1',
        dto,
      );
      expect(result).toEqual(mockResult);
    });
  });

  // ==========================================
  // getEmployeeAttendance
  // ==========================================
  describe('getEmployeeAttendance', () => {
    it('should call attendanceService.getEmployeeAttendance for admin user', async () => {
      const query = { startDate: '2025-01-01' };
      const mockResult = { data: [], total: 0 };
      service.getEmployeeAttendance.mockResolvedValue(mockResult);

      const result = await controller.getEmployeeAttendance(
        adminUser,
        'emp-3',
        query as any,
      );

      expect(service.getEmployeeAttendance).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        query,
      );
      expect(result).toEqual(mockResult);
    });

    it('should allow manager to view own attendance without prisma check', async () => {
      const query = {};
      const mockResult = { data: [] };
      service.getEmployeeAttendance.mockResolvedValue(mockResult);

      const result = await controller.getEmployeeAttendance(
        managerUser,
        'emp-mgr', // same as managerUser.employeeId
        query as any,
      );

      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
      expect(service.getEmployeeAttendance).toHaveBeenCalledWith(
        'tenant-1',
        'emp-mgr',
        query,
      );
      expect(result).toEqual(mockResult);
    });

    it('should allow manager to view direct report attendance', async () => {
      const query = {};
      const mockResult = { data: [] };
      service.getEmployeeAttendance.mockResolvedValue(mockResult);
      prisma.employee.findFirst.mockResolvedValue({
        id: 'emp-subordinate',
        managerId: 'emp-mgr',
      });

      const result = await controller.getEmployeeAttendance(
        managerUser,
        'emp-subordinate',
        query as any,
      );

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'emp-subordinate',
          tenantId: 'tenant-1',
          managerId: 'emp-mgr',
        },
      });
      expect(service.getEmployeeAttendance).toHaveBeenCalledWith(
        'tenant-1',
        'emp-subordinate',
        query,
      );
      expect(result).toEqual(mockResult);
    });

    it('should throw ForbiddenException if manager views non-report employee', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.getEmployeeAttendance(
          managerUser,
          'emp-other',
          {} as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==========================================
  // getPayableHours
  // ==========================================
  describe('getPayableHours', () => {
    it('should call attendanceService.getPayableHours for admin user', async () => {
      const query = { month: 1, year: 2025 };
      const mockResult = { totalHours: 160, otHours: 10 };
      service.getPayableHours.mockResolvedValue(mockResult);

      const result = await controller.getPayableHours(
        adminUser,
        'emp-3',
        query as any,
      );

      expect(service.getPayableHours).toHaveBeenCalledWith(
        'tenant-1',
        'emp-3',
        query,
      );
      expect(result).toEqual(mockResult);
    });

    it('should allow manager to view own payable hours without prisma check', async () => {
      const query = { month: 1, year: 2025 };
      service.getPayableHours.mockResolvedValue({ totalHours: 160 });

      await controller.getPayableHours(
        managerUser,
        'emp-mgr',
        query as any,
      );

      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
      expect(service.getPayableHours).toHaveBeenCalledWith(
        'tenant-1',
        'emp-mgr',
        query,
      );
    });

    it('should allow manager to view direct report payable hours', async () => {
      const query = { month: 1, year: 2025 };
      prisma.employee.findFirst.mockResolvedValue({
        id: 'emp-sub',
        managerId: 'emp-mgr',
      });
      service.getPayableHours.mockResolvedValue({ totalHours: 150 });

      await controller.getPayableHours(
        managerUser,
        'emp-sub',
        query as any,
      );

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'emp-sub',
          tenantId: 'tenant-1',
          managerId: 'emp-mgr',
        },
      });
      expect(service.getPayableHours).toHaveBeenCalledWith(
        'tenant-1',
        'emp-sub',
        query,
      );
    });

    it('should throw ForbiddenException if manager views non-report payable hours', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        controller.getPayableHours(managerUser, 'emp-other', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==========================================
  // getPendingOtApprovals
  // ==========================================
  describe('getPendingOtApprovals', () => {
    it('should call attendanceService.getPendingOtApprovals with the user object', async () => {
      const mockResult = [{ id: 'att-1', otHours: 2 }];
      service.getPendingOtApprovals.mockResolvedValue(mockResult);

      const result = await controller.getPendingOtApprovals(adminUser);

      expect(service.getPendingOtApprovals).toHaveBeenCalledWith(adminUser);
      expect(result).toEqual(mockResult);
    });
  });

  // ==========================================
  // approveOt
  // ==========================================
  describe('approveOt', () => {
    it('should call attendanceService.approveOt with tenantId, id, and dto', async () => {
      const dto = { approved: true, approvedHours: 2 };
      const mockResult = { id: 'att-1', otApproved: true };
      service.approveOt.mockResolvedValue(mockResult);

      const result = await controller.approveOt(
        adminUser,
        'att-1',
        dto as any,
      );

      expect(service.approveOt).toHaveBeenCalledWith('tenant-1', 'att-1', dto);
      expect(result).toEqual(mockResult);
    });
  });
});
