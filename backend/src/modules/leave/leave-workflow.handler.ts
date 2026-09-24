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
import { LeaveService } from './leave.service';

const fmtDay = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' });
const fmtFull = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "12 Oct 2026" for a single day, "12 Oct – 14 Oct 2026" for a range. */
export function formatDateRange(start: Date, end: Date): string {
  if (start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)) {
    return fmtFull(start);
  }
  return `${fmtDay(start)} – ${fmtFull(end)}`;
}

/** Connects leave requests to the approval engine. */
@Injectable()
export class LeaveWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = WorkflowEntityType.LEAVE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly leaveService: LeaveService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: entityId, tenantId },
      select: { status: true, employeeId: true, totalDays: true },
    });
    if (!request || request.status !== 'PENDING') {
      return null;
    }
    return {
      requesterEmployeeId: request.employeeId,
      requesterUserId: await findUserIdForEmployee(this.prisma, tenantId, request.employeeId),
      days: Number(request.totalDays),
    };
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const rows = await this.prisma.leaveRequest.findMany({
      where: { tenantId, id: { in: entityIds } },
      include: {
        leaveType: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return rows.map((row) => {
      const days = Number(row.totalDays);
      return {
        entityId: row.id,
        title: `${row.leaveType.name} · ${days} day${days === 1 ? '' : 's'}`,
        subtitle: formatDateRange(row.startDate, row.endDate),
        requesterName: `${row.employee.firstName} ${row.employee.lastName}`,
        link: '/approvals/leave',
        submittedAt: row.createdAt.toISOString(),
      };
    });
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.leaveService.approveRequest(actor, entityId, { approverNote: note ?? undefined });
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.leaveService.rejectRequest(actor, entityId, { approverNote: note ?? undefined });
  }
}
