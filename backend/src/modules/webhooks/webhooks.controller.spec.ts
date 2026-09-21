import { Test, TestingModule } from '@nestjs/testing';
import { WebhookLogStatus } from '@prisma/client';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { mockHrAdmin, mockSuperAdmin, mockEmployee } from '../../test/helpers';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

const mockService = {
  getEvents: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  sendTest: jest.fn(),
  getLogs: jest.fn(),
};

describe('WebhooksController', () => {
  let controller: WebhooksController;
  let service: typeof mockService;

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: mockService }],
    }).compile();

    controller = module.get<WebhooksController>(WebhooksController);
    service = module.get(WebhooksService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ==========================================================================
  // Authorization metadata
  // ==========================================================================

  describe('authorization', () => {
    it('restricts the whole controller to SUPER_ADMIN and HR_ADMIN', () => {
      const roles = Reflect.getMetadata('roles', WebhooksController);
      expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN]);
      expect(roles).not.toContain(UserRole.MANAGER);
      expect(roles).not.toContain(UserRole.EMPLOYEE);
    });

    it('does not loosen the roles on any individual handler', () => {
      const handlers = [
        'getEvents',
        'findAll',
        'findById',
        'create',
        'update',
        'delete',
        'sendTest',
        'getLogs',
      ] as const;

      for (const handler of handlers) {
        const roles = Reflect.getMetadata(
          'roles',
          WebhooksController.prototype[handler],
        );
        // Either no override at all, or the same admin-only pair.
        if (roles) {
          expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN]);
        }
      }
      // `Roles` is imported so the decorator contract is exercised above.
      expect(typeof Roles).toBe('function');
      expect(mockEmployee.role).toBe(UserRole.EMPLOYEE);
    });
  });

  // ==========================================================================
  // Delegation
  // ==========================================================================

  describe('getEvents', () => {
    it('returns the catalogue from the service', () => {
      service.getEvents.mockReturnValue({ events: ['leave.approved'] });

      expect(controller.getEvents()).toEqual({ events: ['leave.approved'] });
    });
  });

  describe('findAll', () => {
    it("passes the caller's tenant", async () => {
      service.findAll.mockResolvedValue([]);

      await controller.findAll(mockHrAdmin);

      expect(service.findAll).toHaveBeenCalledWith(mockHrAdmin.tenantId);
    });
  });

  describe('findById', () => {
    it('passes the tenant and the id', async () => {
      service.findById.mockResolvedValue({ id: 'wh-1' });

      const result = await controller.findById(mockSuperAdmin, 'wh-1');

      expect(service.findById).toHaveBeenCalledWith(
        mockSuperAdmin.tenantId,
        'wh-1',
      );
      expect(result).toEqual({ id: 'wh-1' });
    });
  });

  describe('create', () => {
    it('passes the tenant and the dto', async () => {
      const dto = {
        url: 'https://example.com/hooks',
        events: ['leave.approved'],
      };
      service.create.mockResolvedValue({ id: 'wh-1' });

      await controller.create(mockHrAdmin, dto);

      expect(service.create).toHaveBeenCalledWith(mockHrAdmin.tenantId, dto);
    });
  });

  describe('update', () => {
    it('passes the tenant, the id and the dto', async () => {
      const dto = { isActive: false };
      service.update.mockResolvedValue({ id: 'wh-1' });

      await controller.update(mockHrAdmin, 'wh-1', dto);

      expect(service.update).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        'wh-1',
        dto,
      );
    });
  });

  describe('delete', () => {
    it('passes the tenant and the id', async () => {
      service.delete.mockResolvedValue({ message: 'Webhook deleted' });

      const result = await controller.delete(mockHrAdmin, 'wh-1');

      expect(service.delete).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'wh-1');
      expect(result).toEqual({ message: 'Webhook deleted' });
    });
  });

  describe('sendTest', () => {
    it('returns the resulting log row', async () => {
      const log = { id: 'log-1', status: WebhookLogStatus.SUCCESS };
      service.sendTest.mockResolvedValue(log);

      const result = await controller.sendTest(mockHrAdmin, 'wh-1');

      expect(service.sendTest).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        'wh-1',
      );
      expect(result).toBe(log);
    });
  });

  describe('getLogs', () => {
    it('passes the query through', async () => {
      const query = { page: 2, limit: 10, status: WebhookLogStatus.FAILED };
      service.getLogs.mockResolvedValue({ data: [], meta: {} });

      await controller.getLogs(mockHrAdmin, 'wh-1', query);

      expect(service.getLogs).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        'wh-1',
        query,
      );
    });
  });
});
