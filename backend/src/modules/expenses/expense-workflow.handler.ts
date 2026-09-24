import { Injectable, OnModuleInit } from '@nestjs/common';
import { ExpenseClaimStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { EXPENSE_APPROVALS_LINK, ExpensesService } from './expenses.service';

/**
 * Plugs expense claims into the approval engine. approve/reject delegate to
 * ExpensesService so the unified /approvals endpoints and the per-flow
 * /expenses endpoints share one code path.
 */
@Injectable()
export class ExpenseWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = 'EXPENSE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly expenses: ExpensesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    return this.expenses.getWorkflowContext(tenantId, entityId);
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const claims = await this.prisma.expenseClaim.findMany({
      where: { tenantId, id: { in: entityIds } },
      select: {
        id: true,
        amount: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return claims.map((claim) => ({
      entityId: claim.id,
      title: `${claim.category?.name ?? 'Expense'} · ₹${Number(claim.amount).toLocaleString('en-IN')}`,
      subtitle: claim.description || null,
      requesterName: claim.employee
        ? `${claim.employee.firstName} ${claim.employee.lastName}`.trim()
        : null,
      link: EXPENSE_APPROVALS_LINK,
      // A claim has no submittedAt column; submitting is its last edit.
      submittedAt: (claim.status === ExpenseClaimStatus.SUBMITTED
        ? claim.updatedAt
        : claim.createdAt
      ).toISOString(),
    }));
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.expenses.approveClaim(actor, entityId, { approverNote: note ?? undefined });
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.expenses.rejectClaim(actor, entityId, { approverNote: note ?? undefined });
  }
}
