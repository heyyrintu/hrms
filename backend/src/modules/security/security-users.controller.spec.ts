import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { SecurityUsersController } from './security-users.controller';
import { SecurityUsersService } from './security-users.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const mockService = {
  list: jest.fn(),
  setRoles: jest.fn(),
};

describe('SecurityUsersController', () => {
  let controller: SecurityUsersController;
  let service: typeof mockService;

  const user: AuthenticatedUser = {
    userId: 'admin-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SecurityUsersController],
      providers: [{ provide: SecurityUsersService, useValue: mockService }],
    }).compile();

    controller = module.get(SecurityUsersController);
    service = module.get(SecurityUsersService);
  });

  it('is guarded by SUPER_ADMIN and HR_ADMIN at the class level', () => {
    const reflector = new Reflector();
    const roles = reflector.get(ROLES_KEY, SecurityUsersController);
    expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN]);
  });

  it('GET /security/users delegates to the service', async () => {
    service.list.mockResolvedValue({ data: [], meta: {} });
    const query = { search: 'jane', page: 2, limit: 10 };
    await controller.list(user, query as any);
    expect(service.list).toHaveBeenCalledWith(user.tenantId, query);
  });

  it('PUT /security/users/:id/roles delegates to the service', async () => {
    service.setRoles.mockResolvedValue([]);
    const dto = { customRoleIds: ['role-1', 'role-2'] };
    await controller.setRoles(user, 'user-1', dto as any);
    expect(service.setRoles).toHaveBeenCalledWith(user.tenantId, 'user-1', dto.customRoleIds, user);
  });
});
