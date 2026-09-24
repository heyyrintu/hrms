import { Injectable, OnModuleInit } from '@nestjs/common';
import { RegularizationStatus, WorkflowEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { RegularizationService } from './regularization.service';

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Connects attendance regularization requests to the approval engine. */
@Injectable()
export class RegularizationWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = WorkflowEntityType.REGULARIZATION;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly regularizationService: RegularizationService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    const request = await this.prisma.attendanceRegularization.findFirst({
      where: { id: entityId, tenantId },
      select: { status: true, employeeId: true },
    });
    if (!request || request.status !== RegularizationStatus.PENDING) {
      return null;
    }
    return {
      requesterEmployeeId: request.employeeId,
      requesterUserId: await this.regularizationService.resolveRequesterUserId(
        tenantId,
        request.employeeId,
      ),
      days: null,
    };
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const rows = await this.prisma.attendanceRegularization.findMany({
      where: { tenantId, id: { in: entityIds } },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((row) => ({
      entityId: row.id,
      title: 'Attendance regularization',
      subtitle: fmtDate(row.date),
      requesterName: `${row.employee.firstName} ${row.employee.lastName}`,
      link: '/approvals/regularization',
      submittedAt: row.createdAt.toISOString(),
    }));
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.regularizationService.approve(actor, entityId, {
      approverNote: note ?? undefined,
    });
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.regularizationService.reject(actor, entityId, {
      approverNote: note ?? undefined,
    });
  }
}
