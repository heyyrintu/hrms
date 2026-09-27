import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { REQUISITIONS_LINK, RequisitionsService } from './requisitions.service';

/**
 * JOB_REQUISITION approvals through the Wave B engine. approve / reject /
 * getContext delegate to the service so there is one approval code path.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, D1.
 */
@Injectable()
export class RequisitionWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = 'JOB_REQUISITION' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly requisitions: RequisitionsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    return this.requisitions.getWorkflowContext(tenantId, entityId);
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const requisitions = await this.prisma.jobRequisition.findMany({
      where: { tenantId, id: { in: entityIds } },
      select: {
        id: true,
        title: true,
        headcount: true,
        submittedAt: true,
        createdAt: true,
        requestedById: true,
      },
    });

    const userIds = [...new Set(requisitions.map((r) => r.requestedById))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId, id: { in: userIds } },
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
    const nameByUserId = new Map(
      users.map((u) => [
        u.id,
        u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
      ]),
    );

    return requisitions.map((r) => ({
      entityId: r.id,
      title: `Requisition · ${r.title} × ${r.headcount}`,
      subtitle: null,
      requesterName: nameByUserId.get(r.requestedById) ?? null,
      link: REQUISITIONS_LINK,
      submittedAt: (r.submittedAt ?? r.createdAt).toISOString(),
    }));
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.requisitions.approve(actor, entityId, note);
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.requisitions.reject(actor, entityId, note);
  }
}
