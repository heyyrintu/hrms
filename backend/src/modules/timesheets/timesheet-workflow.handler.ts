import { Injectable, OnModuleInit } from '@nestjs/common';
import { TimesheetStatus, WorkflowEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import { findUserIdForEmployee } from '../workflow/workflow.utils';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { TimesheetsService } from './timesheets.service';
import { toHours } from './timesheet-week';

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Connects weekly timesheets to the approval engine (Keka wave G, WS-T). */
@Injectable()
export class TimesheetWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = WorkflowEntityType.TIMESHEET;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly timesheets: TimesheetsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    const sheet = await this.prisma.timesheet.findFirst({
      where: { id: entityId, tenantId },
      select: { status: true, employeeId: true },
    });
    if (!sheet || sheet.status !== TimesheetStatus.SUBMITTED) {
      return null;
    }
    return {
      requesterEmployeeId: sheet.employeeId,
      requesterUserId: await findUserIdForEmployee(this.prisma, tenantId, sheet.employeeId),
      days: null,
    };
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const rows = await this.prisma.timesheet.findMany({
      where: { tenantId, id: { in: entityIds } },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((row) => ({
      entityId: row.id,
      title: 'Timesheet',
      subtitle: `Week of ${fmtDate(row.weekStart)} · ${toHours(row.totalHours)} h`,
      requesterName: `${row.employee.firstName} ${row.employee.lastName}`,
      link: '/approvals/timesheets',
      submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    }));
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.timesheets.approve(actor, entityId, note);
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.timesheets.reject(actor, entityId, note);
  }
}
