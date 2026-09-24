import { Injectable, OnModuleInit } from '@nestjs/common';
import { WorkflowEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import { findUserIdForEmployee } from '../workflow/workflow.utils';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { CompOffService } from './comp-off.service';
import { formatDateRange } from './leave-workflow.handler';

/** Connects comp-off requests to the approval engine. */
@Injectable()
export class CompOffWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = WorkflowEntityType.COMP_OFF;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly compOffService: CompOffService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    const request = await this.prisma.compOffRequest.findFirst({
      where: { id: entityId, tenantId },
      select: { status: true, employeeId: true, earnedDays: true },
    });
    if (!request || request.status !== 'PENDING') {
      return null;
    }
    return {
      requesterEmployeeId: request.employeeId,
      requesterUserId: await findUserIdForEmployee(
        this.prisma,
        tenantId,
        request.employeeId,
      ),
      days: Number(request.earnedDays),
    };
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const rows = await this.prisma.compOffRequest.findMany({
      where: { tenantId, id: { in: entityIds } },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((row) => {
      const days = Number(row.earnedDays);
      return {
        entityId: row.id,
        title: `Comp-off · ${days} day${days === 1 ? '' : 's'}`,
        subtitle: `Worked ${formatDateRange(row.workedDate, row.workedDate)}`,
        requesterName: `${row.employee.firstName} ${row.employee.lastName}`,
        link: '/approvals/comp-off',
        submittedAt: row.createdAt.toISOString(),
      };
    });
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.compOffService.approve(actor, entityId, { approverNote: note ?? undefined });
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.compOffService.reject(actor, entityId, { approverNote: note ?? undefined });
  }
}
