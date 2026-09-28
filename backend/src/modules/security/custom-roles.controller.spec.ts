import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { CustomRolesController } from './custom-roles.controller';
import { CustomRolesService } from './custom-roles.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PERMISSIONS } from '../../common/permissions/permissions';

const mockService = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};

describe('CustomRolesController', () => {
  let controller: CustomRolesController;
  let service: typeof mockService;

  const user: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomRolesController],
      providers: [{ provide: CustomRolesService, useValue: mockService }],
    }).compile();

    controller = module.get(CustomRolesController);
    service = module.get(CustomRolesService);
  });

  it('is guarded by SUPER_ADMIN and HR_ADMIN at the class level', () => {
    const reflector = new Reflector();
    const roles = reflector.get(ROLES_KEY, CustomRolesController);
    expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN]);
  });

  it('GET /security/permissions returns the catalogue', () => {
    expect(controller.getPermissions()).toBe(PERMISSIONS);
  });

  it('GET /security/roles delegates to the service', async () => {
    service.list.mockResolvedValue([]);
    await controller.list(user);
    expect(service.list).toHaveBeenCalledWith(user.tenantId);
  });

  it('POST /security/roles delegates to the service', async () => {
    const dto = { name: 'Payroll Lead', permissions: ['payroll.statutory.manage'] };
    service.create.mockResolvedValue({});
    await controller.create(user, dto as any);
    expect(service.create).toHaveBeenCalledWith(user.tenantId, user, dto);
  });

  it('PATCH /security/roles/:id delegates to the service', async () => {
    const dto = { name: 'New Name' };
    service.update.mockResolvedValue({});
    await controller.update(user, 'role-1', dto as any);
    expect(service.update).toHaveBeenCalledWith(user.tenantId, 'role-1', user, dto);
  });

  it('DELETE /security/roles/:id delegates to the service', async () => {
    service.remove.mockResolvedValue({ success: true });
    await controller.remove(user, 'role-1');
    expect(service.remove).toHaveBeenCalledWith(user.tenantId, 'role-1', user);
  });
});
