import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SecuritySettingsService } from './security-settings.service';
import { SsoConfigService } from './sso-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { createMockPrismaService } from '../../test/helpers';

describe('SecuritySettingsService', () => {
  let service: SecuritySettingsService;
  let prisma: any;
  let ssoConfig: { listViews: jest.Mock; hasEnabledProvider: jest.Mock };
  let audit: { log: jest.Mock };

  const actor = { userId: 'admin-1', tenantId: 'tenant-1', role: 'HR_ADMIN' } as any;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    ssoConfig = { listViews: jest.fn().mockResolvedValue([]), hasEnabledProvider: jest.fn() };
    audit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecuritySettingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SsoConfigService, useValue: ssoConfig },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<SecuritySettingsService>(SecuritySettingsService);
  });

  describe('get', () => {
    it('returns defaults when no row exists', async () => {
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue(null);

      await expect(service.get('tenant-1')).resolves.toEqual({
        requireSso: false,
        twoFactorRequiredRoles: [],
      });
    });

    it('returns the stored row', async () => {
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({
        requireSso: true,
        twoFactorRequiredRoles: ['MANAGER'],
      });

      await expect(service.get('tenant-1')).resolves.toEqual({
        requireSso: true,
        twoFactorRequiredRoles: ['MANAGER'],
      });
    });
  });

  describe('view', () => {
    it('combines settings with SSO provider views', async () => {
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue(null);
      ssoConfig.listViews.mockResolvedValue([{ provider: 'GOOGLE', enabled: true }]);

      const result = await service.view('tenant-1');

      expect(ssoConfig.listViews).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual({
        requireSso: false,
        twoFactorRequiredRoles: [],
        providers: [{ provider: 'GOOGLE', enabled: true }],
      });
    });
  });

  describe('update', () => {
    it('upserts the row, audits, and returns the combined view', async () => {
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue(null);
      ssoConfig.listViews.mockResolvedValue([]);

      const result = await service.update(
        'tenant-1',
        { twoFactorRequiredRoles: ['MANAGER', 'HR_ADMIN'] },
        actor,
      );

      expect(prisma.tenantSecuritySettings.upsert).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        create: expect.objectContaining({
          tenantId: 'tenant-1',
          requireSso: false,
          twoFactorRequiredRoles: ['MANAGER', 'HR_ADMIN'],
          updatedById: 'admin-1',
        }),
        update: expect.objectContaining({
          requireSso: false,
          twoFactorRequiredRoles: ['MANAGER', 'HR_ADMIN'],
          updatedById: 'admin-1',
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'admin-1',
          entityType: 'TenantSecuritySettings',
        }),
      );
      expect(result).toEqual({
        requireSso: false,
        twoFactorRequiredRoles: ['MANAGER', 'HR_ADMIN'],
        providers: [],
      });
    });

    it('keeps the current value for a field the caller omits', async () => {
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({
        requireSso: false,
        twoFactorRequiredRoles: ['MANAGER'],
      });
      ssoConfig.listViews.mockResolvedValue([]);

      await service.update('tenant-1', { requireSso: false }, actor);

      expect(prisma.tenantSecuritySettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ twoFactorRequiredRoles: ['MANAGER'] }),
        }),
      );
    });

    it('400s when turning on requireSso with no enabled SSO provider', async () => {
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue(null);
      ssoConfig.hasEnabledProvider.mockResolvedValue(false);

      await expect(service.update('tenant-1', { requireSso: true }, actor)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.tenantSecuritySettings.upsert).not.toHaveBeenCalled();
    });

    it('allows requireSso: true when a provider is enabled', async () => {
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue(null);
      ssoConfig.hasEnabledProvider.mockResolvedValue(true);
      ssoConfig.listViews.mockResolvedValue([{ provider: 'GOOGLE', enabled: true }]);

      await expect(
        service.update('tenant-1', { requireSso: true }, actor),
      ).resolves.toMatchObject({ requireSso: true });
    });
  });
});
