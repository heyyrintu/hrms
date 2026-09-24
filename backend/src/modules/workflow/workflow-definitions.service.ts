import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole, WorkflowEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WORKFLOW_DEFAULTS, WORKFLOW_ENTITY_TYPES } from './workflow.defaults';
import { WorkflowDefinitionView, WorkflowStepConfig } from './workflow.types';
import { toNumber } from './workflow.utils';
import { MAX_WORKFLOW_STEPS, UpsertWorkflowDto } from './dto/upsert-workflow.dto';

type DefinitionWithSteps = {
  id: string;
  entityType: WorkflowEntityType;
  name: string;
  adminOverride: boolean;
  allowSelfApproval: boolean;
  steps: Array<{
    stepOrder: number;
    name: string;
    approverType: WorkflowStepConfig['approverType'];
    approverUserId: string | null;
    approverRole: UserRole | null;
    minAmount: unknown;
    minDays: unknown;
  }>;
};

/**
 * Tenant approval chains (admin builder). A type with no row runs the
 * built-in default; saving replaces the whole chain and affects only
 * requests that enter approval afterwards.
 */
@Injectable()
export class WorkflowDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<WorkflowDefinitionView[]> {
    const definitions = (await this.prisma.workflowDefinition.findMany({
      where: { tenantId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    })) as DefinitionWithSteps[];
    const byType = new Map(definitions.map((d) => [d.entityType, d]));
    const names = await this.userNames(
      tenantId,
      definitions.flatMap((d) => d.steps.map((s) => s.approverUserId)),
    );
    return WORKFLOW_ENTITY_TYPES.map((type) => this.toView(type, byType.get(type), names));
  }

  async get(tenantId: string, entityType: WorkflowEntityType): Promise<WorkflowDefinitionView> {
    const definition = (await this.prisma.workflowDefinition.findUnique({
      where: { tenantId_entityType: { tenantId, entityType } },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    })) as DefinitionWithSteps | null;
    const names = await this.userNames(
      tenantId,
      definition?.steps.map((s) => s.approverUserId) ?? [],
    );
    return this.toView(entityType, definition ?? undefined, names);
  }

  async upsert(
    tenantId: string,
    entityType: WorkflowEntityType,
    dto: UpsertWorkflowDto,
  ): Promise<WorkflowDefinitionView> {
    const steps = dto.steps ?? [];
    if (steps.length < 1 || steps.length > MAX_WORKFLOW_STEPS) {
      throw new BadRequestException(
        `A workflow needs between 1 and ${MAX_WORKFLOW_STEPS} steps`,
      );
    }

    const specificUserIds = new Set<string>();
    steps.forEach((step, index) => {
      const label = `Step ${index + 1}`;
      if (!step.name?.trim()) {
        throw new BadRequestException(`${label} needs a name`);
      }
      if (step.approverType === 'SPECIFIC_USER') {
        if (!step.approverUserId) {
          throw new BadRequestException(`${label} needs an approver user`);
        }
        specificUserIds.add(step.approverUserId);
      }
      if (step.approverType === 'ROLE' && !step.approverRole) {
        throw new BadRequestException(`${label} needs an approver role`);
      }
      for (const [field, value] of [
        ['minAmount', step.minAmount],
        ['minDays', step.minDays],
      ] as const) {
        if (value === null || value === undefined) continue;
        if (index === 0) {
          throw new BadRequestException(
            'Step 1 cannot have a condition; every request needs a first approver',
          );
        }
        if (!Number.isFinite(value) || value < 0) {
          throw new BadRequestException(`${label}: ${field} must be 0 or more`);
        }
      }
    });

    if (specificUserIds.size > 0) {
      const found = await this.prisma.user.findMany({
        where: { tenantId, isActive: true, id: { in: [...specificUserIds] } },
        select: { id: true },
      });
      const active = new Set(found.map((u) => u.id));
      const missing = [...specificUserIds].filter((id) => !active.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          'Every specific approver must be an active user in this organisation',
        );
      }
    }

    const fallback = WORKFLOW_DEFAULTS[entityType];
    const fields = {
      name: dto.name?.trim() || fallback.name,
      adminOverride: dto.adminOverride ?? fallback.adminOverride,
      allowSelfApproval: dto.allowSelfApproval ?? fallback.allowSelfApproval,
    };

    await this.prisma.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.upsert({
        where: { tenantId_entityType: { tenantId, entityType } },
        create: { tenantId, entityType, ...fields },
        update: fields,
      });
      await tx.workflowStep.deleteMany({ where: { definitionId: definition.id } });
      await tx.workflowStep.createMany({
        data: steps.map((step, index) => ({
          definitionId: definition.id,
          stepOrder: index + 1,
          name: step.name.trim(),
          approverType: step.approverType,
          approverUserId: step.approverType === 'SPECIFIC_USER' ? step.approverUserId! : null,
          approverRole: step.approverType === 'ROLE' ? step.approverRole! : null,
          minAmount: step.minAmount ?? null,
          minDays: step.minDays ?? null,
        })),
      });
    });

    return this.get(tenantId, entityType);
  }

  /** Drop the tenant's chain for a type; the built-in default applies again. */
  async reset(tenantId: string, entityType: WorkflowEntityType): Promise<WorkflowDefinitionView> {
    await this.prisma.workflowDefinition.deleteMany({ where: { tenantId, entityType } });
    return this.toView(entityType, undefined, new Map());
  }

  private toView(
    entityType: WorkflowEntityType,
    definition: DefinitionWithSteps | undefined,
    names: Map<string, string>,
  ): WorkflowDefinitionView {
    if (!definition) {
      const fallback = WORKFLOW_DEFAULTS[entityType];
      return {
        entityType,
        isCustom: false,
        name: fallback.name,
        adminOverride: fallback.adminOverride,
        allowSelfApproval: fallback.allowSelfApproval,
        steps: fallback.steps.map((s, i) => ({
          order: i + 1,
          name: s.name,
          approverType: s.approverType,
          approverUserId: s.approverUserId ?? null,
          approverUserName: s.approverUserId ? (names.get(s.approverUserId) ?? null) : null,
          approverRole: s.approverRole ?? null,
          minAmount: s.minAmount ?? null,
          minDays: s.minDays ?? null,
        })),
      };
    }
    return {
      entityType,
      isCustom: true,
      name: definition.name,
      adminOverride: definition.adminOverride,
      allowSelfApproval: definition.allowSelfApproval,
      steps: definition.steps.map((s) => ({
        order: s.stepOrder,
        name: s.name,
        approverType: s.approverType,
        approverUserId: s.approverUserId,
        approverUserName: s.approverUserId ? (names.get(s.approverUserId) ?? null) : null,
        approverRole: s.approverRole ?? null,
        minAmount: toNumber(s.minAmount),
        minDays: toNumber(s.minDays),
      })),
    };
  }

  private async userNames(
    tenantId: string,
    ids: Array<string | null>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { tenantId, id: { in: unique } },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return new Map(
      users.map((u) => [
        u.id,
        u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
      ]),
    );
  }
}
