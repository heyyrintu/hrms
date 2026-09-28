import { Test, TestingModule } from '@nestjs/testing';
import { ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { SecuritySettingsController } from './security-settings.controller';
import { SecuritySettingsService } from './security-settings.service';
import { TwoFactorService } from '../auth/two-factor/two-factor.service';

const mockSettingsService = { view: jest.fn(), update: jest.fn() };
const mockTwoFactorService = { resetForUser: jest.fn() };

const actor = { userId: 'admin-1', tenantId: 'tenant-1', role: 'HR_ADMIN' } as any;

describe('SecuritySettingsController', () => {
  let controller: SecuritySettingsController;

  beforeEach(async () => {
    Object.values(mockSettingsService).forEach((fn) => fn.mockReset());
    Object.values(mockTwoFactorService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SecuritySettingsController],
      providers: [
        { provide: SecuritySettingsService, useValue: mockSettingsService },
        { provide: TwoFactorService, useValue: mockTwoFactorService },
      ],
    }).compile();

    controller = module.get<SecuritySettingsController>(SecuritySettingsController);
  });

  it('getSettings delegates to service.view scoped to the caller tenant', async () => {
    mockSettingsService.view.mockResolvedValue({
      requireSso: false,
      twoFactorRequiredRoles: [],
      providers: [],
    });

    const result = await controller.getSettings(actor);

    expect(mockSettingsService.view).toHaveBeenCalledWith('tenant-1');
    expect(result.requireSso).toBe(false);
  });

  it('updateSettings delegates to service.update with the dto and actor', async () => {
    mockSettingsService.update.mockResolvedValue({
      requireSso: true,
      twoFactorRequiredRoles: ['MANAGER'],
      providers: [],
    });

    const dto = { requireSso: true, twoFactorRequiredRoles: ['MANAGER'] as any };
    const result = await controller.updateSettings(actor, dto);

    expect(mockSettingsService.update).toHaveBeenCalledWith('tenant-1', dto, actor);
    expect(result.requireSso).toBe(true);
  });

  it('resetTwoFactor delegates to TwoFactorService.resetForUser', async () => {
    mockTwoFactorService.resetForUser.mockResolvedValue({ message: 'ok' });

    const result = await controller.resetTwoFactor(actor, 'user-2');

    expect(mockTwoFactorService.resetForUser).toHaveBeenCalledWith('tenant-1', 'user-2', actor);
    expect(result).toEqual({ message: 'ok' });
  });

  // M8: the sibling security routes (custom-roles, security-users) validate
  // their :id param as a UUID; resetTwoFactor's :id was missing the same
  // guard, so a malformed id fell through to the service instead of a 400.
  it('validates the :id param as a UUID on resetTwoFactor, like the sibling security routes', () => {
    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      SecuritySettingsController,
      'resetTwoFactor',
    );
    const idParam = Object.values(metadata ?? {}).find(
      (entry: any) => entry.data === 'id',
    ) as { pipes: unknown[] } | undefined;

    expect(idParam?.pipes).toContain(ParseUUIDPipe);
  });
});
