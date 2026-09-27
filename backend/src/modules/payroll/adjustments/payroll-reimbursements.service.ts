import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ExpenseClaimStatus,
  NotificationType,
  PayrollRunStatus,
  PayrollRunType,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { RunReimbursementClaim, RunReimbursementsView } from '../payroll-depth.types';
import { PayrollSettingsService } from './payroll-settings.service';
import { EMPLOYEE_REF_SELECT, iso, num, toEmployeeRef } from './views';

const CLAIM_INCLUDE = {
  employee: { select: EMPLOYEE_REF_SELECT },
  category: { select: { name: true } },
} as const;

type ClaimRow = Prisma.ExpenseClaimGetPayload<{ include: typeof CLAIM_INCLUDE }>;

function toClaim(row: ClaimRow, attached: boolean): RunReimbursementClaim {
  return {
    id: row.id,
    employee: toEmployeeRef(row.employee),
    categoryName: row.category?.name ?? '',
    amount: num(row.amount),
    expenseDate: iso(row.expenseDate) as string,
    approvedAt: iso(row.approvedAt),
    attached,
  };
}

/** A claim settled by a paid run, for the EXPENSE_REIMBURSED notification. */
export interface SettledClaim {
  id: string;
  employeeId: string;
  amount: Decimal | number | string;
}

/**
 * WS-C1 (Keka wave C, spec C4): approved expense claims paid through payroll,
 * opt-in per tenant (`PayrollSettings.reimburseExpensesViaPayroll`).
 *
 * Claims attach to a run in its write transaction by a guarded update
 * (`payrollRunId: null`), so two runs processed together cannot both pay a
 * claim; they become REIMBURSED when the run is marked PAID — when the money
 * actually moves — not at approval.
 */
@Injectable()
export class PayrollReimbursementsService {
  private readonly logger = new Logger(PayrollReimbursementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PayrollSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async getForRun(tenantId: string, runId: string): Promise<RunReimbursementsView> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, tenantId },
      select: { id: true, status: true, runType: true, scopeEmployeeIds: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const { reimburseExpensesViaPayroll: enabled } = await this.settings.get(tenantId);

    const attached =
      (await this.prisma.expenseClaim.findMany({
        where: { tenantId, payrollRunId: runId },
        include: CLAIM_INCLUDE,
        orderBy: { expenseDate: 'asc' },
      })) ?? [];

    // Eligible = what a (re)compute would attach now.
    const open = run.status === PayrollRunStatus.DRAFT || run.status === PayrollRunStatus.COMPUTED;
    const eligible =
      enabled && open
        ? (await this.prisma.expenseClaim.findMany({
            where: {
              tenantId,
              status: ExpenseClaimStatus.APPROVED,
              payrollRunId: null,
              ...(run.runType === PayrollRunType.OFF_CYCLE
                ? { employeeId: { in: run.scopeEmployeeIds } }
                : { employee: { status: 'ACTIVE' as const } }),
            },
            include: CLAIM_INCLUDE,
            orderBy: { expenseDate: 'asc' },
          })) ?? []
        : [];

    const claims = [
      ...attached.map((c) => toClaim(c, true)),
      ...eligible.map((c) => toClaim(c, false)),
    ];
    const total = num(claims.reduce((sum, c) => sum.add(c.amount), new Decimal(0)));
    return { enabled, claims, total };
  }

  // --------------------------------------------------------------------------
  // Run helpers (called by PayrollService)
  // --------------------------------------------------------------------------

  /** APPROVED claims of the run's employees, unattached or already in this run. */
  async claimsForRun(tenantId: string, runId: string, employeeIds: string[]) {
    if (employeeIds.length === 0) return [];
    return (
      (await this.prisma.expenseClaim.findMany({
        where: {
          tenantId,
          employeeId: { in: employeeIds },
          status: ExpenseClaimStatus.APPROVED,
          OR: [{ payrollRunId: null }, { payrollRunId: runId }],
        },
        select: { id: true, employeeId: true, amount: true },
        orderBy: { expenseDate: 'asc' },
      })) ?? []
    );
  }

  detachFromRun(tx: Prisma.TransactionClient, tenantId: string, runId: string) {
    return tx.expenseClaim.updateMany({
      where: { tenantId, payrollRunId: runId, status: ExpenseClaimStatus.APPROVED },
      data: { payrollRunId: null },
    });
  }

  async attachToRun(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const res = await tx.expenseClaim.updateMany({
      where: { id: { in: ids }, tenantId, status: ExpenseClaimStatus.APPROVED, payrollRunId: null },
      data: { payrollRunId: runId },
    });
    if (!res || res.count !== ids.length) {
      throw new ConflictException(
        'An expense claim this run reimburses was reimbursed or taken by another run meanwhile; process the run again',
      );
    }
  }

  /** The run was paid: its claims are REIMBURSED as of the payment. */
  async settleForRun(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runId: string,
    paidAt: Date,
  ): Promise<SettledClaim[]> {
    const claims =
      (await tx.expenseClaim.findMany({
        where: { tenantId, payrollRunId: runId, status: ExpenseClaimStatus.APPROVED },
        select: { id: true, employeeId: true, amount: true },
      })) ?? [];
    if (claims.length === 0) return [];
    await tx.expenseClaim.updateMany({
      where: {
        id: { in: claims.map((c) => c.id) },
        tenantId,
        payrollRunId: runId,
        status: ExpenseClaimStatus.APPROVED,
      },
      data: { status: ExpenseClaimStatus.REIMBURSED, reimbursedAt: paidAt },
    });
    return claims;
  }

  /** After the payment commits. Fire-and-forget. */
  notifyReimbursed(tenantId: string, claims: SettledClaim[]): void {
    for (const claim of claims) {
      Promise.resolve()
        .then(() =>
          this.notifications.notifyEmployee(
            tenantId,
            claim.employeeId,
            NotificationType.EXPENSE_REIMBURSED,
            'Expense Reimbursed',
            `Your expense claim of ${claim.amount} has been reimbursed with your salary.`,
            '/expenses',
          ),
        )
        .catch((err: unknown) =>
          this.logger.warn(`Reimbursement notification failed: ${err instanceof Error ? err.message : err}`),
        );
    }
  }
}
