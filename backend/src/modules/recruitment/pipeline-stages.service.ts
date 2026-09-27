import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PipelineStageView } from './recruitment.types';

/**
 * Per-tenant pipeline stages; defaults (DEFAULT_PIPELINE_STAGES) created on first read.
 * Scaffold stub (Keka wave D) — implemented by WS-D1.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class PipelineStagesService {
  constructor(private readonly prisma: PrismaService) {}

  ensureDefaults(tenantId: string): Promise<void> {
    void tenantId;
    throw new NotImplementedException();
  }

  list(tenantId: string, includeInactive?: boolean): Promise<PipelineStageView[]> {
    void tenantId;
    void includeInactive;
    throw new NotImplementedException();
  }

  replace(tenantId: string, stages: Array<Record<string, unknown>>): Promise<PipelineStageView[]> {
    void tenantId;
    void stages;
    throw new NotImplementedException();
  }
}
