import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RecruitmentSettingsView } from './recruitment.types';

/**
 * Per-tenant hiring settings (careers page switch, expiries, pre-onboarding checklist).
 * Scaffold stub (Keka wave D) — implemented by WS-D3.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class RecruitmentSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get(tenantId: string): Promise<RecruitmentSettingsView> {
    void tenantId;
    throw new NotImplementedException();
  }

  update(tenantId: string, input: Partial<RecruitmentSettingsView>): Promise<RecruitmentSettingsView> {
    void tenantId;
    void input;
    throw new NotImplementedException();
  }
}
