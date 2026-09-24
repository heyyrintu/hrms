import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoanType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { LOAN_APPROVALS_LINK, LoansService } from './loans.service';

/**
 * Plugs loan and salary-advance requests into the approval engine.
 * approve/reject delegate to LoansService, the single approval code path.
 */
@Injectable()
export class LoanWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = 'LOAN' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly loans: LoansService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    return this.loans.getWorkflowContext(tenantId, entityId);
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    if (entityIds.length === 0) return [];
    const loans = await this.prisma.employeeLoan.findMany({
      where: { tenantId, id: { in: entityIds } },
      select: {
        id: true,
        type: true,
        principal: true,
        tenureMonths: true,
        emiAmount: true,
        createdAt: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return loans.map((loan) => ({
      entityId: loan.id,
      title: `${loan.type === LoanType.SALARY_ADVANCE ? 'Salary advance' : 'Loan'} · ₹${Number(
        loan.principal,
      ).toLocaleString('en-IN')}`,
      subtitle: `${loan.tenureMonths} month${loan.tenureMonths === 1 ? '' : 's'} · EMI ₹${Number(
        loan.emiAmount,
      ).toLocaleString('en-IN')}`,
      requesterName: loan.employee
        ? `${loan.employee.firstName} ${loan.employee.lastName}`.trim()
        : null,
      link: LOAN_APPROVALS_LINK,
      submittedAt: loan.createdAt.toISOString(),
    }));
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.loans.approve(actor, entityId, note);
  }

  /** The unified route's note is the employee-facing reason (required; 400 when blank). */
  reject(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.loans.reject(actor, entityId, { reason: note ?? '' });
  }
}
