import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { PayrollService } from './payroll.service';

export const PAYROLL_NOT_REJECTED = 'Payroll runs are not rejected; reset the run instead';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Payroll maker-checker through the approval engine. The "requester" is the
 * user who computed the run (processedById); the built-in PAYROLL_RUN chain
 * forbids that user from approving it.
 */
@Injectable()
export class PayrollWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = 'PAYROLL_RUN' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly payroll: PayrollService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Null unless the run is COMPUTED (awaiting approval). */
  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    return this.payroll.getWorkflowContext(tenantId, entityId);
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const runs = await this.prisma.payrollRun.findMany({
      where: { tenantId, id: { in: entityIds } },
      select: {
        id: true,
        month: true,
        year: true,
        totalNet: true,
        processedCount: true,
        processedById: true,
        processedAt: true,
        updatedAt: true,
      },
    });

    const makerIds = [
      ...new Set(runs.map((r) => r.processedById).filter((id): id is string => !!id)),
    ];
    const makers = makerIds.length
      ? await this.prisma.user.findMany({
          where: { tenantId, id: { in: makerIds } },
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
    const makerName = new Map(
      makers.map((u) => [
        u.id,
        u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
      ]),
    );

    return runs.map((run) => ({
      entityId: run.id,
      title: `Payroll ${MONTHS[run.month - 1] ?? run.month} ${run.year}`,
      subtitle: `₹${Number(run.totalNet).toLocaleString('en-IN')} net · ${run.processedCount} employees`,
      requesterName: run.processedById ? (makerName.get(run.processedById) ?? null) : null,
      link: '/payroll',
      submittedAt: (run.processedAt ?? run.updatedAt).toISOString(),
    }));
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.payroll.approveRun(actor.tenantId, entityId, actor, note);
  }

  async reject(): Promise<unknown> {
    throw new BadRequestException(PAYROLL_NOT_REJECTED);
  }
}
