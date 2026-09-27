import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole, WorkflowEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WORKFLOW_DEFAULTS, WORKFLOW_ENTITY_TYPES } from './workflow.defaults';
import { WorkflowDefinitionView, WorkflowStepConfig } from './workflow.types';
import { toNumber } from './workflow.utils';
import { MAX_WORKFLOW_STEPS, UpsertWorkflowDto } from './dto/upsert-workflow.dto';

type Db = Prisma.TransactionClient | PrismaService;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
    actorUserId?: string,
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

    // Read the row (if any) before the write, so the audit entry can carry
    // the exact chain that is about to be replaced.
    const existingDefinition = (await this.prisma.workflowDefinition.findUnique({
      where: { tenantId_entityType: { tenantId, entityType } },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    })) as DefinitionWithSteps | null;
    const beforeNames = await this.userNames(
      tenantId,
      existingDefinition?.steps.map((s) => s.approverUserId) ?? [],
    );
    const before = this.toView(entityType, existingDefinition ?? undefined, beforeNames);

    await this.prisma.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.upsert({
        where: { tenantId_entityType: { tenantId, entityType } },
        create: { tenantId, entityType, ...fields },
        update: fields,
      });
      await tx.workflowStep.deleteMany({ where: { definitionId: definition.id } });
      const stepRows = steps.map((step, index) => ({
        definitionId: definition.id,
        stepOrder: index + 1,
        name: step.name.trim(),
        approverType: step.approverType,
        approverUserId: step.approverType === 'SPECIFIC_USER' ? step.approverUserId! : null,
        approverRole: step.approverType === 'ROLE' ? step.approverRole! : null,
        minAmount: step.minAmount ?? null,
        minDays: step.minDays ?? null,
      }));
      await tx.workflowStep.createMany({ data: stepRows });

      const afterNames = await this.userNames(
        tenantId,
        stepRows.map((s) => s.approverUserId),
        tx,
      );
      const after = this.toView(
        entityType,
        {
          id: definition.id,
          entityType,
          name: fields.name,
          adminOverride: fields.adminOverride,
          allowSelfApproval: fields.allowSelfApproval,
          steps: stepRows,
        },
        afterNames,
      );

      await this.audit.log(
        {
          tenantId,
          userId: actorUserId,
          action: existingDefinition ? 'UPDATE' : 'CREATE',
          entityType: 'WorkflowDefinition',
          entityId: definition.id,
          oldValues: { entityType, view: before },
          newValues: { entityType, view: after },
        },
        tx,
      );
    });

    return this.get(tenantId, entityType);
  }

  /** Drop the tenant's chain for a type; the built-in default applies again. */
  async reset(
    tenantId: string,
    entityType: WorkflowEntityType,
    actorUserId?: string,
  ): Promise<WorkflowDefinitionView> {
    const existingDefinition = (await this.prisma.workflowDefinition.findUnique({
      where: { tenantId_entityType: { tenantId, entityType } },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    })) as DefinitionWithSteps | null;
    const after = this.toView(entityType, undefined, new Map());

    await this.prisma.$transaction(async (tx) => {
      await tx.workflowDefinition.deleteMany({ where: { tenantId, entityType } });
      if (!existingDefinition) return;

      const beforeNames = await this.userNames(
        tenantId,
        existingDefinition.steps.map((s) => s.approverUserId),
        tx,
      );
      const before = this.toView(entityType, existingDefinition, beforeNames);
      await this.audit.log(
        {
          tenantId,
          userId: actorUserId,
          action: 'DELETE',
          entityType: 'WorkflowDefinition',
          entityId: existingDefinition.id,
          oldValues: { entityType, view: before },
          newValues: { entityType, view: after },
        },
        tx,
      );
    });

    return after;
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
    db: Db = this.prisma,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await db.user.findMany({
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
