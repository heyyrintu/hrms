import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, SsoProvider, TenantSsoProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { SsoProviderView } from '../auth/auth.types';
import { UpsertSsoConfigDto } from './dto/sso-config.dto';

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A dotted hostname: at least one label, a TLD of 2+ letters. Matches the spec verbatim.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

/**
 * Per-tenant Google / Microsoft OIDC configuration. The client secret is
 * stored encrypted and never returned. Owned by WS-3 (plan Task 3.1).
 */
@Injectable()
export class SsoConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private redirectUri(provider: SsoProvider): string {
    const base = this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3001/api';
    return `${base}/auth/sso/${provider.toLowerCase()}/callback`;
  }

  private toView(row: TenantSsoProvider): SsoProviderView {
    return {
      provider: row.provider,
      clientId: row.clientId,
      hasClientSecret: true,
      entraTenantId: row.entraTenantId,
      enabled: row.enabled,
      allowedDomains: row.allowedDomains,
      autoCreateUsers: row.autoCreateUsers,
      redirectUri: this.redirectUri(row.provider),
      updatedAt: row.updatedAt,
    };
  }

  private normaliseDomains(domains: string[] | undefined): string[] {
    const cleaned = [...new Set((domains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean))];
    for (const domain of cleaned) {
      if (!HOSTNAME_RE.test(domain)) {
        throw new BadRequestException(`"${domain}" is not a valid domain`);
      }
    }
    return cleaned;
  }

  /** Explicit field list; never `...row` (clientSecretEnc must never leave the service). */
  async listViews(tenantId: string): Promise<SsoProviderView[]> {
    const rows = await this.prisma.tenantSsoProvider.findMany({
      where: { tenantId },
      orderBy: { provider: 'asc' },
    });
    return rows.map((row) => this.toView(row));
  }

  async hasEnabledProvider(tenantId: string): Promise<boolean> {
    const count = await this.prisma.tenantSsoProvider.count({
      where: { tenantId, enabled: true },
    });
    return count > 0;
  }

  async upsert(
    tenantId: string,
    provider: SsoProvider,
    dto: UpsertSsoConfigDto,
    actor: AuthenticatedUser,
  ): Promise<SsoProviderView> {
    const existing = await this.prisma.tenantSsoProvider.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });

    if (!existing && !dto.clientSecret) {
      throw new BadRequestException('clientSecret is required when configuring this provider for the first time');
    }

    if (provider === SsoProvider.MICROSOFT) {
      if (!dto.entraTenantId || !GUID_RE.test(dto.entraTenantId)) {
        throw new BadRequestException('entraTenantId is required for Microsoft and must be a GUID');
      }
    }

    const allowedDomains = this.normaliseDomains(dto.allowedDomains);

    if (dto.autoCreateUsers && allowedDomains.length === 0) {
      throw new BadRequestException('autoCreateUsers requires at least one allowed domain');
    }

    const secretChanged = !!dto.clientSecret;
    const clientSecretEnc = dto.clientSecret ? this.encryption.encrypt(dto.clientSecret) : undefined;

    const entraTenantId = provider === SsoProvider.MICROSOFT ? (dto.entraTenantId ?? null) : null;

    const row = await this.prisma.tenantSsoProvider.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      create: {
        tenantId,
        provider,
        clientId: dto.clientId,
        // Guaranteed non-empty above: !existing && !dto.clientSecret already refused.
        clientSecretEnc: clientSecretEnc as string,
        entraTenantId,
        enabled: dto.enabled,
        allowedDomains,
        autoCreateUsers: dto.autoCreateUsers,
        updatedById: actor.userId,
      },
      update: {
        clientId: dto.clientId,
        ...(clientSecretEnc ? { clientSecretEnc } : {}),
        entraTenantId,
        enabled: dto.enabled,
        allowedDomains,
        autoCreateUsers: dto.autoCreateUsers,
        updatedById: actor.userId,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actor.userId,
      action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
      entityType: 'TenantSsoProvider',
      entityId: row.id,
      newValues: {
        provider,
        clientId: dto.clientId,
        enabled: dto.enabled,
        allowedDomains,
        autoCreateUsers: dto.autoCreateUsers,
        secretChanged,
      },
    });

    return this.toView(row);
  }

  /**
   * Deletes the provider config. `UserIdentity` rows are left in place so a
   * re-created config still matches the same people by `sub` (spec §3.4).
   *
   * Reads `tenantSecuritySettings` directly rather than injecting
   * SecuritySettingsService: that service already injects SsoConfigService
   * (for `listViews`/`hasEnabledProvider`), and NestJS constructor injection
   * cannot resolve a two-way cycle without `forwardRef` on both sides, which
   * would mean editing SecuritySettingsService (owned by WS-2). Reading the
   * row here mirrors SecuritySettingsService.get's own default exactly
   * (absent row = `requireSso: false`), so the observable behaviour is the
   * one the brief and spec describe either way.
   */
  async remove(tenantId: string, provider: SsoProvider, actor: AuthenticatedUser): Promise<{ success: true }> {
    const existing = await this.prisma.tenantSsoProvider.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    if (!existing) {
      throw new NotFoundException('SSO configuration not found');
    }

    if (existing.enabled) {
      const settings = await this.prisma.tenantSecuritySettings.findUnique({ where: { tenantId } });
      if (settings?.requireSso) {
        const enabledCount = await this.prisma.tenantSsoProvider.count({
          where: { tenantId, enabled: true },
        });
        if (enabledCount <= 1) {
          throw new BadRequestException(
            'Cannot remove the last enabled SSO provider while single sign-on is required.',
          );
        }
      }
    }

    await this.prisma.tenantSsoProvider.delete({ where: { id: existing.id } });

    await this.audit.log({
      tenantId,
      userId: actor.userId,
      action: AuditAction.DELETE,
      entityType: 'TenantSsoProvider',
      entityId: existing.id,
      newValues: { provider },
    });

    return { success: true };
  }
}
