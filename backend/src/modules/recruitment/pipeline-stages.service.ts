import { BadRequestException, Injectable } from '@nestjs/common';
import { PipelineStageCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_PIPELINE_STAGES, PipelineStageView } from './recruitment.types';

/**
 * Per-tenant pipeline stages; defaults (DEFAULT_PIPELINE_STAGES) created on first read.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, D1.
 */
@Injectable()
export class PipelineStagesService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaults(tenantId: string): Promise<void> {
    const existing = await this.prisma.pipelineStage.count({ where: { tenantId } });
    if (existing > 0) return;

    await this.prisma.pipelineStage.createMany({
      data: DEFAULT_PIPELINE_STAGES.map((stage, index) => ({
        tenantId,
        name: stage.name,
        category: stage.category,
        sortOrder: index + 1,
      })),
      skipDuplicates: true,
    });
  }

  async list(tenantId: string, includeInactive = false): Promise<PipelineStageView[]> {
    await this.ensureDefaults(tenantId);
    const stages = await this.prisma.pipelineStage.findMany({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { sortOrder: 'asc' },
    });
    return stages.map((s) => this.toView(s));
  }

  /**
   * Replace the ordered active list. Names must be unique, there must be at
   * least one active stage in APPLIED, HIRED and REJECTED, the first active
   * stage must be APPLIED, and a stage with applications attached to it
   * cannot be removed outright — it is deactivated instead and kept for
   * history.
   */
  async replace(
    tenantId: string,
    stages: Array<{ id?: string; name: string; category: PipelineStageCategory }>,
  ): Promise<PipelineStageView[]> {
    if (stages.length === 0) {
      throw new BadRequestException('At least one pipeline stage is required');
    }

    const names = stages.map((s) => s.name.trim());
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
      throw new BadRequestException('Pipeline stage names must be unique');
    }

    const categories = new Set(stages.map((s) => s.category));
    for (const required of ['APPLIED', 'HIRED', 'REJECTED'] as PipelineStageCategory[]) {
      if (!categories.has(required)) {
        throw new BadRequestException(
          `At least one active stage of category ${required} is required`,
        );
      }
    }
    if (stages[0].category !== 'APPLIED') {
      throw new BadRequestException('The first active stage must be of category APPLIED');
    }

    const existing = await this.prisma.pipelineStage.findMany({ where: { tenantId } });
    const existingById = new Map(existing.map((s) => [s.id, s]));
    const keepIds = new Set(stages.filter((s) => s.id).map((s) => s.id as string));

    for (const id of keepIds) {
      if (!existingById.has(id)) {
        throw new BadRequestException('One of the stages does not belong to this tenant');
      }
    }

    const toDeactivate = existing.filter((s) => s.isActive && !keepIds.has(s.id));

    await this.prisma.$transaction(async (tx) => {
      for (const stage of toDeactivate) {
        await tx.pipelineStage.update({ where: { id: stage.id }, data: { isActive: false } });
      }
      for (let i = 0; i < stages.length; i++) {
        const input = stages[i];
        const sortOrder = i + 1;
        if (input.id) {
          await tx.pipelineStage.update({
            where: { id: input.id },
            data: { name: input.name.trim(), category: input.category, sortOrder, isActive: true },
          });
        } else {
          await tx.pipelineStage.create({
            data: {
              tenantId,
              name: input.name.trim(),
              category: input.category,
              sortOrder,
              isActive: true,
            },
          });
        }
      }
    });

    return this.list(tenantId, true);
  }

  private toView(stage: {
    id: string;
    name: string;
    sortOrder: number;
    category: PipelineStageCategory;
    isActive: boolean;
  }): PipelineStageView {
    return {
      id: stage.id,
      name: stage.name,
      sortOrder: stage.sortOrder,
      category: stage.category,
      isActive: stage.isActive,
    };
  }
}
