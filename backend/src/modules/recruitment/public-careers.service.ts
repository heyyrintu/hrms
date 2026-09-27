import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicCareersView, PublicJobView } from './recruitment.types';

/**
 * Public careers page per tenant (by Tenant.code) and public apply.
 * Scaffold stub (Keka wave D) — implemented by WS-D3.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class PublicCareersService {
  constructor(private readonly prisma: PrismaService) {}

  getCareers(tenantCode: string): Promise<PublicCareersView> {
    void tenantCode;
    throw new NotImplementedException();
  }

  getJob(tenantCode: string, slug: string): Promise<PublicJobView> {
    void tenantCode;
    void slug;
    throw new NotImplementedException();
  }

  apply(tenantCode: string, slug: string, input: Record<string, unknown>, resume: Express.Multer.File): Promise<{ message: string }> {
    void tenantCode;
    void slug;
    void input;
    void resume;
    throw new NotImplementedException();
  }
}
