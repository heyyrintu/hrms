import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { mockEmployee, mockHrAdmin } from '../../../test/helpers';
import { EngagementSettingsController } from './engagement-settings.controller';
import { DEFAULT_ENGAGEMENT_SETTINGS } from './engagement-settings.service';

describe('EngagementSettingsController', () => {
  const service = { get: jest.fn(), update: jest.fn() };
  let controller: EngagementSettingsController;
  const reflector = new Reflector();

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new EngagementSettingsController(service as any);
  });

  it('GET returns the tenant settings', async () => {
    service.get.mockResolvedValue(DEFAULT_ENGAGEMENT_SETTINGS);

    await expect(controller.get(mockEmployee)).resolves.toEqual(DEFAULT_ENGAGEMENT_SETTINGS);
    expect(service.get).toHaveBeenCalledWith('test-tenant');
  });

  it('PUT forwards the dto for the caller tenant', async () => {
    const dto = { pointsEnabled: true, monthlyPointsAllowance: 50 };
    service.update.mockResolvedValue({ ...DEFAULT_ENGAGEMENT_SETTINGS, ...dto });

    await controller.update(mockHrAdmin, dto);

    expect(service.update).toHaveBeenCalledWith('test-tenant', dto);
  });

  describe('role metadata', () => {
    const rolesOn = (method: keyof EngagementSettingsController) =>
      reflector.get<UserRole[]>(
        ROLES_KEY,
        EngagementSettingsController.prototype[method] as any,
      );

    it('lets every role read the settings', () => {
      expect(rolesOn('get')).toEqual([
        UserRole.SUPER_ADMIN,
        UserRole.HR_ADMIN,
        UserRole.MANAGER,
        UserRole.EMPLOYEE,
      ]);
    });

    it('limits updates to HR_ADMIN and SUPER_ADMIN', () => {
      expect(rolesOn('update')).toEqual([UserRole.HR_ADMIN, UserRole.SUPER_ADMIN]);
    });
  });
});
