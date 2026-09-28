import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SsoProvider, AuditAction } from '@prisma/client';
import { SsoConfigService } from './sso-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { createMockPrismaService } from '../../test/helpers';

describe('SsoConfigService', () => {
  let service: SsoConfigService;
  let prisma: any;
  let audit: { log: jest.Mock };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };

  const actor = { userId: 'admin-1', tenantId: 'tenant-1', role: 'HR_ADMIN' } as any;
  const tenantId = 'tenant-1';

  const baseDto = {
    clientId: 'client-abc',
    clientSecret: 'super-secret',
    enabled: true,
    allowedDomains: [],
    autoCreateUsers: false,
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    audit = { log: jest.fn() };
    encryption = {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn((v: string) => v.replace('enc:', '')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SsoConfigService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: FieldEncryptionService, useValue: encryption },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get(SsoConfigService);
  });

  describe('listViews', () => {
    it('maps rows to views without the encrypted secret', async () => {
      prisma.tenantSsoProvider.findMany.mockResolvedValue([
        {
          id: 'row-1',
          tenantId,
          provider: SsoProvider.GOOGLE,
          clientId: 'client-abc',
          clientSecretEnc: 'enc:super-secret',
          entraTenantId: null,
          enabled: true,
          allowedDomains: ['acme.com'],
          autoCreateUsers: true,
          updatedById: 'admin-1',
          updatedAt: new Date('2026-01-01T12:00:00Z'),
          createdAt: new Date('2026-01-01T12:00:00Z'),
        },
      ]);

      const views = await service.listViews(tenantId);

      expect(views).toHaveLength(1);
      expect(views[0]).toEqual({
        provider: SsoProvider.GOOGLE,
        clientId: 'client-abc',
        hasClientSecret: true,
        entraTenantId: null,
        enabled: true,
        allowedDomains: ['acme.com'],
        autoCreateUsers: true,
        redirectUri: 'http://localhost:3001/api/auth/sso/google/callback',
        updatedAt: new Date('2026-01-01T12:00:00Z'),
      });
      const serialised = JSON.stringify(views);
      expect(serialised).not.toContain('clientSecretEnc');
      expect(serialised).not.toContain('super-secret');
    });

    it('builds the redirect URI from API_PUBLIC_URL when configured', async () => {
      const configWithUrl = { get: jest.fn().mockReturnValue('https://hrms.example.com/api') };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SsoConfigService,
          { provide: PrismaService, useValue: prisma },
          { provide: AuditService, useValue: audit },
          { provide: FieldEncryptionService, useValue: encryption },
          { provide: ConfigService, useValue: configWithUrl },
        ],
      }).compile();
      const scoped = module.get(SsoConfigService);

      prisma.tenantSsoProvider.findMany.mockResolvedValue([
        {
          id: 'row-1',
          provider: SsoProvider.MICROSOFT,
          clientId: 'c',
          clientSecretEnc: 'enc:x',
          entraTenantId: '11111111-2222-3333-4444-555555555555',
          enabled: false,
          allowedDomains: [],
          autoCreateUsers: false,
          updatedAt: new Date('2026-01-01T12:00:00Z'),
        },
      ]);

      const views = await scoped.listViews(tenantId);
      expect(views[0].redirectUri).toBe('https://hrms.example.com/api/auth/sso/microsoft/callback');
    });
  });

  describe('hasEnabledProvider', () => {
    it('true when at least one provider is enabled', async () => {
      prisma.tenantSsoProvider.count.mockResolvedValue(1);
      await expect(service.hasEnabledProvider(tenantId)).resolves.toBe(true);
      expect(prisma.tenantSsoProvider.count).toHaveBeenCalledWith({
        where: { tenantId, enabled: true },
      });
    });

    it('false when none are enabled', async () => {
      prisma.tenantSsoProvider.count.mockResolvedValue(0);
      await expect(service.hasEnabledProvider(tenantId)).resolves.toBe(false);
    });
  });

  describe('upsert', () => {
    it('creates a new GOOGLE config, encrypting the secret', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);
      prisma.tenantSsoProvider.upsert.mockImplementation(({ create }: any) => ({
        id: 'row-1',
        ...create,
        updatedAt: new Date('2026-01-01T12:00:00Z'),
      }));

      const view = await service.upsert(tenantId, SsoProvider.GOOGLE, baseDto as any, actor);

      expect(encryption.encrypt).toHaveBeenCalledWith('super-secret');
      expect(prisma.tenantSsoProvider.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId_provider: { tenantId, provider: SsoProvider.GOOGLE } },
          create: expect.objectContaining({
            tenantId,
            provider: SsoProvider.GOOGLE,
            clientId: 'client-abc',
            clientSecretEnc: 'enc:super-secret',
            entraTenantId: null,
            enabled: true,
            allowedDomains: [],
            autoCreateUsers: false,
            updatedById: 'admin-1',
          }),
        }),
      );
      expect(view.hasClientSecret).toBe(true);
      expect((view as any).clientSecretEnc).toBeUndefined();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CREATE,
          entityType: 'TenantSsoProvider',
          newValues: expect.objectContaining({ secretChanged: true }),
        }),
      );
    });

    it('400s creating a config with no clientSecret', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);

      await expect(
        service.upsert(tenantId, SsoProvider.GOOGLE, { ...baseDto, clientSecret: undefined } as any, actor),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.tenantSsoProvider.upsert).not.toHaveBeenCalled();
    });

    it('updates without a clientSecret keeps the existing encrypted secret', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        tenantId,
        provider: SsoProvider.GOOGLE,
        clientSecretEnc: 'enc:old-secret',
        enabled: true,
        allowedDomains: [],
        autoCreateUsers: false,
      });
      prisma.tenantSsoProvider.upsert.mockImplementation(({ update }: any) => ({
        id: 'row-1',
        provider: SsoProvider.GOOGLE,
        clientId: update.clientId,
        clientSecretEnc: 'enc:old-secret',
        entraTenantId: null,
        enabled: update.enabled,
        allowedDomains: update.allowedDomains,
        autoCreateUsers: update.autoCreateUsers,
        updatedAt: new Date(),
      }));

      await service.upsert(
        tenantId,
        SsoProvider.GOOGLE,
        { ...baseDto, clientSecret: undefined } as any,
        actor,
      );

      expect(encryption.encrypt).not.toHaveBeenCalled();
      expect(prisma.tenantSsoProvider.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.not.objectContaining({ clientSecretEnc: expect.anything() }),
        }),
      );
      const auditCall = audit.log.mock.calls[0][0];
      expect(auditCall.newValues.secretChanged).toBe(false);
      expect(auditCall.action).toBe(AuditAction.UPDATE);
    });

    it('400s MICROSOFT without a valid GUID entraTenantId', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);

      await expect(
        service.upsert(tenantId, SsoProvider.MICROSOFT, { ...baseDto, entraTenantId: 'not-a-guid' } as any, actor),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.upsert(tenantId, SsoProvider.MICROSOFT, { ...baseDto } as any, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts MICROSOFT with a valid GUID entraTenantId', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);
      prisma.tenantSsoProvider.upsert.mockImplementation(({ create }: any) => ({
        id: 'row-1',
        ...create,
        updatedAt: new Date(),
      }));

      const view = await service.upsert(
        tenantId,
        SsoProvider.MICROSOFT,
        { ...baseDto, entraTenantId: '11111111-2222-3333-4444-555555555555' } as any,
        actor,
      );

      expect(view.entraTenantId).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('normalises allowedDomains: trims, lower-cases and dedupes', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);
      prisma.tenantSsoProvider.upsert.mockImplementation(({ create }: any) => ({
        id: 'row-1',
        ...create,
        updatedAt: new Date(),
      }));

      const view = await service.upsert(
        tenantId,
        SsoProvider.GOOGLE,
        { ...baseDto, allowedDomains: [' Acme.com ', 'acme.com', 'sub.acme.co'] } as any,
        actor,
      );

      expect(view.allowedDomains).toEqual(['acme.com', 'sub.acme.co']);
    });

    it('400s on a domain that is not a valid hostname', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);

      await expect(
        service.upsert(tenantId, SsoProvider.GOOGLE, { ...baseDto, allowedDomains: ['not a domain'] } as any, actor),
      ).rejects.toThrow(BadRequestException);
    });

    it('400s autoCreateUsers with no allowedDomains', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);

      await expect(
        service.upsert(
          tenantId,
          SsoProvider.GOOGLE,
          { ...baseDto, autoCreateUsers: true, allowedDomains: [] } as any,
          actor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // I2: PUT is also a way to disable a provider (enabled: false in the
    // body). Only DELETE was guarded against locking the tenant out; a PUT
    // that flips the last enabled provider to disabled must be refused the
    // same way.
    it('400s disabling the last enabled provider via PUT while requireSso is on', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        tenantId,
        provider: SsoProvider.GOOGLE,
        clientSecretEnc: 'enc:old-secret',
        enabled: true,
        allowedDomains: [],
        autoCreateUsers: false,
      });
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({ requireSso: true });
      prisma.tenantSsoProvider.count.mockResolvedValue(1);

      await expect(
        service.upsert(tenantId, SsoProvider.GOOGLE, { ...baseDto, enabled: false } as any, actor),
      ).rejects.toThrow(
        'Cannot remove the last enabled SSO provider while single sign-on is required.',
      );
      expect(prisma.tenantSsoProvider.upsert).not.toHaveBeenCalled();
    });

    it('allows disabling via PUT when another enabled provider remains', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        tenantId,
        provider: SsoProvider.GOOGLE,
        clientSecretEnc: 'enc:old-secret',
        enabled: true,
        allowedDomains: [],
        autoCreateUsers: false,
      });
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({ requireSso: true });
      prisma.tenantSsoProvider.count.mockResolvedValue(2);
      prisma.tenantSsoProvider.upsert.mockImplementation(({ update }: any) => ({
        id: 'row-1',
        provider: SsoProvider.GOOGLE,
        clientId: update.clientId,
        clientSecretEnc: 'enc:old-secret',
        entraTenantId: null,
        enabled: update.enabled,
        allowedDomains: update.allowedDomains,
        autoCreateUsers: update.autoCreateUsers,
        updatedAt: new Date(),
      }));

      await service.upsert(tenantId, SsoProvider.GOOGLE, { ...baseDto, enabled: false } as any, actor);
      expect(prisma.tenantSsoProvider.upsert).toHaveBeenCalled();
    });

    it('allows disabling via PUT when requireSso is off, with no count check', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        tenantId,
        provider: SsoProvider.GOOGLE,
        clientSecretEnc: 'enc:old-secret',
        enabled: true,
        allowedDomains: [],
        autoCreateUsers: false,
      });
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({ requireSso: false });
      prisma.tenantSsoProvider.upsert.mockImplementation(({ update }: any) => ({
        id: 'row-1',
        provider: SsoProvider.GOOGLE,
        ...update,
        updatedAt: new Date(),
      }));

      await service.upsert(tenantId, SsoProvider.GOOGLE, { ...baseDto, enabled: false } as any, actor);

      expect(prisma.tenantSsoProvider.count).not.toHaveBeenCalled();
      expect(prisma.tenantSsoProvider.upsert).toHaveBeenCalled();
    });

    it('allows disabling a provider that was already disabled (not "the last enabled" one)', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        tenantId,
        provider: SsoProvider.GOOGLE,
        clientSecretEnc: 'enc:old-secret',
        enabled: false,
        allowedDomains: [],
        autoCreateUsers: false,
      });
      prisma.tenantSsoProvider.upsert.mockImplementation(({ update }: any) => ({
        id: 'row-1',
        provider: SsoProvider.GOOGLE,
        ...update,
        updatedAt: new Date(),
      }));

      await service.upsert(tenantId, SsoProvider.GOOGLE, { ...baseDto, enabled: false } as any, actor);

      expect(prisma.tenantSecuritySettings.findUnique).not.toHaveBeenCalled();
      expect(prisma.tenantSsoProvider.upsert).toHaveBeenCalled();
    });

    // M7: the audit trail should record which Entra tenant a Microsoft
    // config points at (no secret involved, safe to log).
    it('includes entraTenantId in the audit newValues', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);
      prisma.tenantSsoProvider.upsert.mockImplementation(({ create }: any) => ({
        id: 'row-1',
        ...create,
        updatedAt: new Date(),
      }));

      await service.upsert(
        tenantId,
        SsoProvider.MICROSOFT,
        { ...baseDto, entraTenantId: '11111111-2222-3333-4444-555555555555' } as any,
        actor,
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          newValues: expect.objectContaining({
            entraTenantId: '11111111-2222-3333-4444-555555555555',
          }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('404s when the config does not exist', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);
      await expect(service.remove(tenantId, SsoProvider.GOOGLE, actor)).rejects.toThrow(NotFoundException);
    });

    it('deletes a disabled provider without checking requireSso', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        provider: SsoProvider.GOOGLE,
        enabled: false,
      });
      prisma.tenantSsoProvider.delete.mockResolvedValue({});

      await service.remove(tenantId, SsoProvider.GOOGLE, actor);

      expect(prisma.tenantSecuritySettings.findUnique).not.toHaveBeenCalled();
      expect(prisma.tenantSsoProvider.delete).toHaveBeenCalledWith({ where: { id: 'row-1' } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.DELETE }));
    });

    it('400s deleting the last enabled provider while requireSso is on', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        provider: SsoProvider.GOOGLE,
        enabled: true,
      });
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({ requireSso: true });
      prisma.tenantSsoProvider.count.mockResolvedValue(1);

      await expect(service.remove(tenantId, SsoProvider.GOOGLE, actor)).rejects.toThrow(BadRequestException);
      expect(prisma.tenantSsoProvider.delete).not.toHaveBeenCalled();
    });

    it('deletes an enabled provider when another enabled provider remains', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        provider: SsoProvider.GOOGLE,
        enabled: true,
      });
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({ requireSso: true });
      prisma.tenantSsoProvider.count.mockResolvedValue(2);
      prisma.tenantSsoProvider.delete.mockResolvedValue({});

      await service.remove(tenantId, SsoProvider.GOOGLE, actor);
      expect(prisma.tenantSsoProvider.delete).toHaveBeenCalled();
    });

    it('deletes an enabled provider when requireSso is off, with no count check', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        id: 'row-1',
        provider: SsoProvider.GOOGLE,
        enabled: true,
      });
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({ requireSso: false });
      prisma.tenantSsoProvider.delete.mockResolvedValue({});

      await service.remove(tenantId, SsoProvider.GOOGLE, actor);

      expect(prisma.tenantSsoProvider.count).not.toHaveBeenCalled();
      expect(prisma.tenantSsoProvider.delete).toHaveBeenCalled();
    });
  });
});
