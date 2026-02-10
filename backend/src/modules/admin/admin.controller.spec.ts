import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockAdminService = {
  getDashboardStats: jest.fn(),
  getManagerDashboardStats: jest.fn(),
  getOtRules: jest.fn(),
  getOtRule: jest.fn(),
  createOtRule: jest.fn(),
  updateOtRule: jest.fn(),
  deleteOtRule: jest.fn(),
};

describe('AdminController', () => {
  let controller: AdminController;
  let service: typeof mockAdminService;

  const superAdminUser: AuthenticatedUser = {
    userId: 'user-sa',
    email: 'superadmin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    employeeId: 'emp-sa',
  };

  const hrAdminUser: AuthenticatedUser = {
    userId: 'user-hr',
    email: 'hr@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-hr',
  };

  const managerUser: AuthenticatedUser = {
    userId: 'user-mgr',
    email: 'manager@test.com',
    tenantId: 'tenant-1',
    role: UserRole.MANAGER,
    employeeId: 'emp-mgr',
  };

  const managerWithoutEmployee: AuthenticatedUser = {
    userId: 'user-mgr2',
    email: 'manager2@test.com',
    tenantId: 'tenant-1',
    role: UserRole.MANAGER,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockAdminService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: mockAdminService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    service = module.get(AdminService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ==========================================
  // getDashboardStats
  // ==========================================
  describe('getDashboardStats', () => {
    it('should return manager dashboard stats when user is a MANAGER with employeeId', async () => {
      const mockResult = { directReports: 5, pendingApprovals: 2 };
      service.getManagerDashboardStats.mockResolvedValue(mockResult);

      const result = await controller.getDashboardStats(managerUser);

      expect(service.getManagerDashboardStats).toHaveBeenCalledWith(
        'tenant-1',
        'emp-mgr',
      );
      expect(service.getDashboardStats).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should return regular dashboard stats when user is a MANAGER without employeeId', async () => {
      const mockResult = { totalEmployees: 50, activeToday: 40 };
      service.getDashboardStats.mockResolvedValue(mockResult);

      const result = await controller.getDashboardStats(
        managerWithoutEmployee,
      );

      expect(service.getDashboardStats).toHaveBeenCalledWith('tenant-1');
      expect(service.getManagerDashboardStats).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should return regular dashboard stats when user is HR_ADMIN', async () => {
      const mockResult = { totalEmployees: 50, activeToday: 40 };
      service.getDashboardStats.mockResolvedValue(mockResult);

      const result = await controller.getDashboardStats(hrAdminUser);

      expect(service.getDashboardStats).toHaveBeenCalledWith('tenant-1');
      expect(service.getManagerDashboardStats).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should return regular dashboard stats when user is SUPER_ADMIN', async () => {
      const mockResult = { totalEmployees: 100 };
      service.getDashboardStats.mockResolvedValue(mockResult);

      const result = await controller.getDashboardStats(superAdminUser);

      expect(service.getDashboardStats).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockResult);
    });
  });

  // ==========================================
  // OT Rules
  // ==========================================
  describe('getOtRules', () => {
    it('should call adminService.getOtRules with tenantId', async () => {
      const mockResult = [{ id: 'ot-1', name: 'Default OT' }];
      service.getOtRules.mockResolvedValue(mockResult);

      const result = await controller.getOtRules(hrAdminUser);

      expect(service.getOtRules).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getOtRule', () => {
    it('should call adminService.getOtRule with tenantId and id', async () => {
      const mockResult = { id: 'ot-1', name: 'Default OT', multiplier: 1.5 };
      service.getOtRule.mockResolvedValue(mockResult);

      const result = await controller.getOtRule(hrAdminUser, 'ot-1');

      expect(service.getOtRule).toHaveBeenCalledWith('tenant-1', 'ot-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('createOtRule', () => {
    it('should call adminService.createOtRule with tenantId and dto', async () => {
      const dto = { name: 'Weekend OT', multiplier: 2.0 };
      const mockResult = { id: 'ot-new', ...dto };
      service.createOtRule.mockResolvedValue(mockResult);

      const result = await controller.createOtRule(hrAdminUser, dto as any);

      expect(service.createOtRule).toHaveBeenCalledWith('tenant-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('updateOtRule', () => {
    it('should call adminService.updateOtRule with tenantId, id, and dto', async () => {
      const dto = { name: 'Updated OT', multiplier: 2.5 };
      const mockResult = { id: 'ot-1', ...dto };
      service.updateOtRule.mockResolvedValue(mockResult);

      const result = await controller.updateOtRule(
        hrAdminUser,
        'ot-1',
        dto as any,
      );

      expect(service.updateOtRule).toHaveBeenCalledWith(
        'tenant-1',
        'ot-1',
        dto,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('deleteOtRule', () => {
    it('should call adminService.deleteOtRule with tenantId and id', async () => {
      const mockResult = { id: 'ot-1', deletedAt: new Date() };
      service.deleteOtRule.mockResolvedValue(mockResult);

      const result = await controller.deleteOtRule(hrAdminUser, 'ot-1');

      expect(service.deleteOtRule).toHaveBeenCalledWith('tenant-1', 'ot-1');
      expect(result).toEqual(mockResult);
    });
  });
});
