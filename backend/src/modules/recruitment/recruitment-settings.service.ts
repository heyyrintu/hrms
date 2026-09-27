import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_PRE_ONBOARDING_DOCUMENTS,
  PreOnboardingDocumentDefinition,
  RecruitmentSettingsView,
} from './recruitment.types';

/**
 * Per-tenant hiring settings (careers page switch, expiries, pre-onboarding checklist).
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part D3.
 */
@Injectable()
export class RecruitmentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async get(tenantId: string): Promise<RecruitmentSettingsView> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const row = await this.prisma.recruitmentSettings.findUnique({ where: { tenantId } });

    return this.toView(tenant.code, {
      careersPageEnabled: row?.careersPageEnabled ?? false,
      careersIntro: row?.careersIntro ?? null,
      offerExpiryDays: row?.offerExpiryDays ?? 7,
      preOnboardingExpiryDays: row?.preOnboardingExpiryDays ?? 14,
      preOnboardingDocuments: row
        ? (row.preOnboardingDocuments as unknown as PreOnboardingDocumentDefinition[])
        : [...DEFAULT_PRE_ONBOARDING_DOCUMENTS],
    });
  }

  async update(
    tenantId: string,
    input: Partial<Omit<RecruitmentSettingsView, 'careersUrl'>>,
  ): Promise<RecruitmentSettingsView> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const existing = await this.prisma.recruitmentSettings.findUnique({ where: { tenantId } });

    const merged = {
      careersPageEnabled: input.careersPageEnabled ?? existing?.careersPageEnabled ?? false,
      careersIntro:
        input.careersIntro !== undefined ? input.careersIntro : existing?.careersIntro ?? null,
      offerExpiryDays: input.offerExpiryDays ?? existing?.offerExpiryDays ?? 7,
      preOnboardingExpiryDays: input.preOnboardingExpiryDays ?? existing?.preOnboardingExpiryDays ?? 14,
      preOnboardingDocuments:
        input.preOnboardingDocuments ??
        (existing
          ? (existing.preOnboardingDocuments as unknown as PreOnboardingDocumentDefinition[])
          : [...DEFAULT_PRE_ONBOARDING_DOCUMENTS]),
    };

    const row = await this.prisma.recruitmentSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        careersPageEnabled: merged.careersPageEnabled,
        careersIntro: merged.careersIntro,
        offerExpiryDays: merged.offerExpiryDays,
        preOnboardingExpiryDays: merged.preOnboardingExpiryDays,
        preOnboardingDocuments: merged.preOnboardingDocuments as unknown as Prisma.InputJsonValue,
      },
      update: {
        careersPageEnabled: merged.careersPageEnabled,
        careersIntro: merged.careersIntro,
        offerExpiryDays: merged.offerExpiryDays,
        preOnboardingExpiryDays: merged.preOnboardingExpiryDays,
        preOnboardingDocuments: merged.preOnboardingDocuments as unknown as Prisma.InputJsonValue,
      },
    });

    return this.toView(tenant.code, {
      careersPageEnabled: row.careersPageEnabled,
      careersIntro: row.careersIntro,
      offerExpiryDays: row.offerExpiryDays,
      preOnboardingExpiryDays: row.preOnboardingExpiryDays,
      preOnboardingDocuments: row.preOnboardingDocuments as unknown as PreOnboardingDocumentDefinition[],
    });
  }

  private toView(
    tenantCode: string,
    settings: Omit<RecruitmentSettingsView, 'careersUrl'>,
  ): RecruitmentSettingsView {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    return {
      ...settings,
      careersUrl: `${frontendUrl}/careers/${tenantCode}`,
    };
  }
}
