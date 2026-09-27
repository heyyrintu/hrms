import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { FunnelReport } from './recruitment.types';

/**
 * Hiring funnel report.
 * Scaffold stub (Keka wave D) — implemented by WS-D3.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class RecruitmentReportsService {
  constructor(private readonly prisma: PrismaService) {}

  funnel(actor: AuthenticatedUser, query: { jobOpeningId?: string; from?: string; to?: string }): Promise<FunnelReport> {
    void actor;
    void query;
    throw new NotImplementedException();
  }
}
