import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { SsoProvider, UserRole } from '@prisma/client';
import { SsoConfigController } from './sso-config.controller';
import { SsoConfigService } from './sso-config.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const mockService = {
  upsert: jest.fn(),
  remove: jest.fn(),
};

describe('SsoConfigController', () => {
  let controller: SsoConfigController;

  const user: AuthenticatedUser = {
    userId: 'admin-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SsoConfigController],
      providers: [{ provide: SsoConfigService, useValue: mockService }],
    }).compile();

    controller = module.get(SsoConfigController);
  });

  it('is guarded by SUPER_ADMIN and HR_ADMIN at the class level', () => {
    const reflector = new Reflector();
    const roles = reflector.get(ROLES_KEY, SsoConfigController);
    expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN]);
  });

  it('PUT /security/sso/:provider delegates to the service with the resolved enum', async () => {
    const dto = { clientId: 'c', enabled: true, allowedDomains: [], autoCreateUsers: false };
    mockService.upsert.mockResolvedValue({});
    await controller.upsert(user, SsoProvider.GOOGLE, dto as any);
    expect(mockService.upsert).toHaveBeenCalledWith('tenant-1', SsoProvider.GOOGLE, dto, user);
  });

  it('DELETE /security/sso/:provider delegates to the service', async () => {
    mockService.remove.mockResolvedValue({ success: true });
    await controller.remove(user, SsoProvider.MICROSOFT);
    expect(mockService.remove).toHaveBeenCalledWith('tenant-1', SsoProvider.MICROSOFT, user);
  });
});
