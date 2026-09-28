import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { SecuritySettingsView, SsoProviderView } from '../auth/auth.types';
import { SsoConfigService } from './sso-config.service';
import { UpdateSecuritySettingsDto } from './dto/security-settings.dto';

export interface SecuritySettingsWithProviders extends SecuritySettingsView {
  providers: SsoProviderView[];
}

/**
 * Tenant sign-in policy: SSO-only and per-role 2FA requirement.
 * Owned by WS-2 (plan Task 2.5).
 */
@Injectable()
export class SecuritySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssoConfig: SsoConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Defaults ({ requireSso: false, twoFactorRequiredRoles: [] }) when no row exists. */
  async get(tenantId: string): Promise<SecuritySettingsView> {
    const row = await this.prisma.tenantSecuritySettings.findUnique({ where: { tenantId } });
    return {
      requireSso: row?.requireSso ?? false,
      twoFactorRequiredRoles: row?.twoFactorRequiredRoles ?? [],
    };
  }

  async view(tenantId: string): Promise<SecuritySettingsWithProviders> {
    const [settings, providers] = await Promise.all([
      this.get(tenantId),
      this.ssoConfig.listViews(tenantId),
    ]);
    return { ...settings, providers };
  }

  async update(
    tenantId: string,
    dto: UpdateSecuritySettingsDto,
    actor: AuthenticatedUser,
  ): Promise<SecuritySettingsWithProviders> {
    const current = await this.get(tenantId);
    const next: SecuritySettingsView = {
      requireSso: dto.requireSso ?? current.requireSso,
      twoFactorRequiredRoles: dto.twoFactorRequiredRoles ?? current.twoFactorRequiredRoles,
    };

    if (next.requireSso) {
      const hasProvider = await this.ssoConfig.hasEnabledProvider(tenantId);
      if (!hasProvider) {
        throw new BadRequestException(
          'Enable at least one SSO provider before requiring single sign-on.',
        );
      }
    }

    await this.prisma.tenantSecuritySettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        requireSso: next.requireSso,
        twoFactorRequiredRoles: next.twoFactorRequiredRoles,
        updatedById: actor.userId,
      },
      update: {
        requireSso: next.requireSso,
        twoFactorRequiredRoles: next.twoFactorRequiredRoles,
        updatedById: actor.userId,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'TenantSecuritySettings',
      newValues: { ...next },
    });

    // Built from `next` rather than re-reading, so the response reflects the
    // write that was just made even if a caller in the same request re-reads
    // through a client that has not observed it yet.
    const providers = await this.ssoConfig.listViews(tenantId);
    return { ...next, providers };
  }
}
