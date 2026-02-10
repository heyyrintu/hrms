import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getLogs: jest.fn(),
  getEntityHistory: jest.fn(),
};

describe('AuditController', () => {
  let controller: AuditController;
  let service: typeof mockService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    employeeId: 'emp-1',
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [{ provide: AuditService, useValue: mockService }],
    }).compile();
    controller = module.get<AuditController>(AuditController);
    service = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // getLogs
  // ============================================
  describe('getLogs', () => {
    it('should return audit logs with query params', async () => {
      const expected = {
        data: [
          {
            id: 'log-1',
            action: 'CREATE',
            entityType: 'Employee',
            entityId: 'emp-1',
          },
        ],
        total: 1,
      };
      const query = {
        action: 'CREATE' as any,
        entityType: 'Employee',
        page: '1',
        limit: '50',
      };
      service.getLogs.mockResolvedValue(expected);

      const result = await controller.getLogs(adminUser, query);

      expect(result).toEqual(expected);
      expect(service.getLogs).toHaveBeenCalledWith(adminUser.tenantId, query);
    });

    it('should pass empty query params', async () => {
      service.getLogs.mockResolvedValue({ data: [], total: 0 });

      await controller.getLogs(adminUser, {});

      expect(service.getLogs).toHaveBeenCalledWith(adminUser.tenantId, {});
    });

    it('should pass date range filters', async () => {
      const query = {
        from: '2025-01-01',
        to: '2025-01-31',
        userId: 'user-99',
      };
      service.getLogs.mockResolvedValue({ data: [], total: 0 });

      await controller.getLogs(adminUser, query);

      expect(service.getLogs).toHaveBeenCalledWith(adminUser.tenantId, query);
    });

    it('should filter by entityId', async () => {
      const query = { entityType: 'Employee', entityId: 'emp-5' };
      service.getLogs.mockResolvedValue({ data: [], total: 0 });

      await controller.getLogs(adminUser, query);

      expect(service.getLogs).toHaveBeenCalledWith(adminUser.tenantId, query);
    });
  });

  // ============================================
  // getEntityHistory
  // ============================================
  describe('getEntityHistory', () => {
    it('should return entity history', async () => {
      const expected = [
        {
          id: 'log-1',
          action: 'CREATE',
          entityType: 'Employee',
          entityId: 'emp-1',
        },
        {
          id: 'log-2',
          action: 'UPDATE',
          entityType: 'Employee',
          entityId: 'emp-1',
        },
      ];
      service.getEntityHistory.mockResolvedValue(expected);

      const result = await controller.getEntityHistory(
        adminUser,
        'Employee',
        'emp-1',
      );

      expect(result).toEqual(expected);
      expect(service.getEntityHistory).toHaveBeenCalledWith(
        adminUser.tenantId,
        'Employee',
        'emp-1',
      );
    });

    it('should handle different entity types', async () => {
      service.getEntityHistory.mockResolvedValue([]);

      await controller.getEntityHistory(adminUser, 'LeaveRequest', 'lr-1');

      expect(service.getEntityHistory).toHaveBeenCalledWith(
        adminUser.tenantId,
        'LeaveRequest',
        'lr-1',
      );
    });
  });
});
