import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollCalculationService, PayslipData } from './payroll-calculation.service';
import {
  CreatePayrollRunDto,
  PayrollRunQueryDto,
  PayslipQueryDto,
} from './dto/payroll.dto';
import { PayrollRun, PayrollRunStatus, Prisma, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from '../../common/utils/prisma-errors';
import {
  ClosedLoan,
  LoansService,
  PayrollRepaymentLine,
} from '../loans/loans.service';

/**
 * The run's write transaction now also reverses the month's earlier loan
 * instalments and re-records them, one guarded write per loan, on top of
 * replacing every payslip. Prisma's 5s default is too tight for that on a
 * large tenant; the calculation itself still happens outside, so this only
 * has to cover the writes.
 */
const PAYROLL_WRITE_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { PayslipEmailService } from './payslip-email.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { WorkflowEntityContext } from '../workflow/workflow.types';

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private prisma: PrismaService,
    private calculationService: PayrollCalculationService,
    private loansService: LoansService,
    private payslipEmailService: PayslipEmailService,
    private webhookDispatcher: WebhookDispatcherService,
    private workflow: ApprovalEngineService,
  ) {}

  // ============================================
  // Payroll Runs
  // ============================================

  async getRuns(tenantId: string, query: PayrollRunQueryDto) {
    const where: any = { tenantId };
    if (query.year) where.year = parseInt(query.year);
    if (query.status) where.status = query.status;

    return this.prisma.payrollRun.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        _count: { select: { payslips: true } },
      },
    });
  }

  async getRun(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
      include: {
        payslips: {
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                designation: true,
                department: { select: { name: true } },
              },
            },
          },
          orderBy: { employee: { firstName: 'asc' } },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  async createRun(tenantId: string, dto: CreatePayrollRunDto) {
    // Check for duplicate
    const existing = await this.prisma.payrollRun.findUnique({
      where: {
        tenantId_month_year: {
          tenantId,
          month: dto.month,
          year: dto.year,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Payroll run for ${dto.month}/${dto.year} already exists`,
      );
    }

    return this.prisma.payrollRun.create({
      data: {
        tenantId,
        month: dto.month,
        year: dto.year,
        remarks: dto.remarks,
      },
    });
  }

  /**
   * `userId` is the maker: it is stored as `processedById` and, through the
   * PAYROLL_RUN approval (maker-checker), may not approve the run.
   */
  async processRun(tenantId: string, id: string, userId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot process run in ${run.status} status. Only DRAFT runs can be processed.`,
      );
    }

    // Claim the run atomically: only one caller can move DRAFT -> PROCESSING.
    // A second concurrent call finds no DRAFT row to update and gets a 409
    // instead of wiping and regenerating payslips underneath the first.
    try {
      await this.prisma.payrollRun.update({
        where: { id, status: PayrollRunStatus.DRAFT },
        data: { status: PayrollRunStatus.PROCESSING },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException('Payroll run is already being processed');
      }
      throw err;
    }

    try {
      // Loan instalments an earlier attempt at this month recorded are
      // reversed inside the write transaction below, not here. The
      // calculation reads loan balances as if they already were
      // (`getPayrollDeductions`), so it proposes the right EMI either way.

      // Get all active employees with salary assignments
      const employees = await this.prisma.employee.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true },
      });

      // Compute every payslip first (reads only), so the write transaction
      // below stays short and cannot time out mid-run on a large tenant.
      const results: PayslipData[] = [];
      for (const emp of employees) {
        const result = await this.calculationService.calculateForEmployee(
          tenantId,
          emp.id,
          run.month,
          run.year,
        );
        if (result) results.push(result); // No salary assigned, skip
      }

      // Totals are summed as exact decimals, so they always match the sum of
      // the payslip line items rather than drifting by fractions of a paisa.
      const totalGross = results.reduce(
        (sum, r) => sum.add(r.grossPay),
        new Decimal(0),
      );
      const totalDeductions = results.reduce(
        (sum, r) => sum.add(r.totalDeductions),
        new Decimal(0),
      );
      const totalNet = results.reduce(
        (sum, r) => sum.add(r.netPay),
        new Decimal(0),
      );

      // Reverse any earlier attempt's loan instalments, replace the payslips,
      // re-record the instalments against them and publish the totals — all
      // atomically: a failure part way through must not leave a
      // half-generated run, or loan balances reversed but not re-recorded.
      let closedLoans: ClosedLoan[] = [];
      const publishedRun = await this.prisma.$transaction(async (tx) => {
        await this.loansService.clearPayrollRepayments(
          tenantId,
          run.month,
          run.year,
          tx,
        );

        await tx.payslip.deleteMany({ where: { payrollRunId: id } });

        if (results.length > 0) {
          await tx.payslip.createMany({
            data: results.map((result) => ({
              tenantId,
              payrollRunId: id,
              employeeId: result.employeeId,
              workingDays: result.workingDays,
              presentDays: result.presentDays,
              leaveDays: result.leaveDays,
              lopDays: result.lopDays,
              otHours: result.otHours,
              basePay: result.basePay,
              // JSON columns cannot hold Decimal; these are already rounded to
              // paise, so a number round-trips exactly at this magnitude.
              earnings: result.earnings.map((e) => ({
                name: e.name,
                amount: e.amount.toNumber(),
              })) as any,
              deductions: result.deductions.map((d) => ({
                name: d.name,
                amount: d.amount.toNumber(),
              })) as any,
              grossPay: result.grossPay,
              totalDeductions: result.totalDeductions,
              netPay: result.netPay,
              otPay: result.otPay,
              pfWages: result.statutory.pfWages,
              pfEmployee: result.statutory.pfEmployee,
              pfEmployer: result.statutory.pfEmployer,
              epsEmployer: result.statutory.epsEmployer,
              edliEmployer: result.statutory.edliEmployer,
              pfAdminEmployer: result.statutory.pfAdminEmployer,
              esiWages: result.statutory.esiWages,
              esiEmployee: result.statutory.esiEmployee,
              esiEmployer: result.statutory.esiEmployer,
              professionalTax: result.statutory.professionalTax,
              lwfEmployee: result.statutory.lwfEmployee,
              lwfEmployer: result.statutory.lwfEmployer,
              tds: result.statutory.tds,
              taxComputation: (result.statutory.taxComputation ?? undefined) as any,
            })),
          });
        }

        closedLoans = await this.recordLoanRepayments(
          tx,
          tenantId,
          id,
          run.month,
          run.year,
          results,
        );

        const computed = await tx.payrollRun.update({
          where: { id },
          data: {
            status: PayrollRunStatus.COMPUTED,
            totalGross,
            totalDeductions,
            totalNet,
            processedCount: results.length,
            processedAt: new Date(),
            processedById: userId,
          },
          include: {
            _count: { select: { payslips: true } },
          },
        });
        await this.startApproval(tx, tenantId, id, userId, totalNet);
        return computed;
      }, PAYROLL_WRITE_TX_OPTIONS);

      // Only now that it has committed can a borrower be told a loan closed.
      await this.loansService.notifyLoansClosed(tenantId, closedLoans);
      void this.workflow.notifyPending(tenantId, 'PAYROLL_RUN', id);

      return publishedRun;
    } catch (error) {
      // Revert to DRAFT on failure
      await this.prisma.payrollRun.update({
        where: { id },
        data: { status: PayrollRunStatus.DRAFT },
      });
      throw error;
    }
  }

  /**
   * Recompute a run that has already been COMPUTED — e.g. a rate was fixed
   * after the first compute and the payslips need to be regenerated from
   * the corrected configuration. Discards the existing payslips and
   * regenerates them, the same way processRun does for a fresh DRAFT run.
   *
   * APPROVED and PAID runs are refused. Their figures have been signed off
   * or paid out: rewriting them would silently change what someone was
   * told they were paid, and would desynchronise the run from any return
   * already filed from it. The correct fix for an error found after
   * approval is an adjustment in a later run, not editing this one's
   * history. A DRAFT run has nothing computed yet to recompute — it is
   * processed via processRun instead.
   */
  async recomputeRun(tenantId: string, id: string, userId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    if (
      run.status === PayrollRunStatus.APPROVED ||
      run.status === PayrollRunStatus.PAID
    ) {
      const verb =
        run.status === PayrollRunStatus.PAID ? 'paid out' : 'approved';
      throw new BadRequestException(
        `Cannot recompute a ${run.status} payroll run: it has already been ${verb}, and its figures are the record of what employees were told they would receive. Rewriting them now would silently change that record and could desynchronise it from any statutory return already filed from it. If a rate was wrong, correct it with an adjustment in a later payroll run instead of editing this one.`,
      );
    }
    if (run.status !== PayrollRunStatus.COMPUTED) {
      throw new BadRequestException(
        `Cannot recompute run in ${run.status} status. Only a COMPUTED run can be recomputed; a DRAFT run has nothing to recompute yet — process it instead.`,
      );
    }

    const previousTotals = {
      totalGross: run.totalGross,
      totalDeductions: run.totalDeductions,
      totalNet: run.totalNet,
      processedCount: run.processedCount,
    };

    // Claim the run atomically: only one caller can move COMPUTED ->
    // PROCESSING. A second concurrent recompute finds no COMPUTED row to
    // update and gets a 409 instead of interleaving with the first and
    // producing a run with duplicated or missing payslips.
    try {
      await this.prisma.payrollRun.update({
        where: { id, status: PayrollRunStatus.COMPUTED },
        data: { status: PayrollRunStatus.PROCESSING },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException('Payroll run is already being processed');
      }
      throw err;
    }

    try {
      // Get all active employees with salary assignments
      // The employees this run already covers, not whoever is active today. A
      // run computed in April and recomputed in June must still cover somebody
      // who left in May: taking the current active list would delete their
      // payslip and quietly shrink a run that may already have been reported
      // on. Anyone hired since belongs in their own run, not retrofitted here.
      const covered = await this.prisma.payslip.findMany({
        where: { payrollRunId: id, tenantId },
        select: { employeeId: true },
      });
      const employees = covered.map((slip) => ({ id: slip.employeeId }));

      // The instalments the previous compute recorded belong to payslips that
      // are about to be deleted, so they are reversed — but inside the write
      // transaction below, together with the re-recording, not here on their
      // own. The calculation reads loan balances as if that reversal had
      // already happened (`getPayrollDeductions`), so it proposes the same
      // EMI it would after a separate reversal, without a failure in between
      // being able to leave every balance reversed and nothing re-recorded.

      // Compute every payslip first (reads only), so the write transaction
      // below stays short and cannot time out mid-run on a large tenant.
      const results: PayslipData[] = [];
      for (const emp of employees) {
        const result = await this.calculationService.calculateForEmployee(
          tenantId,
          emp.id,
          run.month,
          run.year,
        );
        if (result) results.push(result); // No salary assigned, skip
      }

      const totalGross = results.reduce(
        (sum, r) => sum.add(r.grossPay),
        new Decimal(0),
      );
      const totalDeductions = results.reduce(
        (sum, r) => sum.add(r.totalDeductions),
        new Decimal(0),
      );
      const totalNet = results.reduce(
        (sum, r) => sum.add(r.netPay),
        new Decimal(0),
      );

      // Reverse the previous instalments, replace the payslips, re-record the
      // instalments and publish the totals atomically: a failure part way
      // through must not leave the run with some old payslips and some new,
      // nor loan balances reversed with nothing re-recorded.
      let closedLoans: ClosedLoan[] = [];
      const updatedRun = await this.prisma.$transaction(async (tx) => {
        await this.loansService.clearPayrollRepayments(
          tenantId,
          run.month,
          run.year,
          tx,
        );

        await tx.payslip.deleteMany({ where: { payrollRunId: id } });

        if (results.length > 0) {
          await tx.payslip.createMany({
            data: results.map((result) => ({
              tenantId,
              payrollRunId: id,
              employeeId: result.employeeId,
              workingDays: result.workingDays,
              presentDays: result.presentDays,
              leaveDays: result.leaveDays,
              lopDays: result.lopDays,
              otHours: result.otHours,
              basePay: result.basePay,
              earnings: result.earnings.map((e) => ({
                name: e.name,
                amount: e.amount.toNumber(),
              })) as any,
              deductions: result.deductions.map((d) => ({
                name: d.name,
                amount: d.amount.toNumber(),
              })) as any,
              grossPay: result.grossPay,
              totalDeductions: result.totalDeductions,
              netPay: result.netPay,
              otPay: result.otPay,
              pfWages: result.statutory.pfWages,
              pfEmployee: result.statutory.pfEmployee,
              pfEmployer: result.statutory.pfEmployer,
              epsEmployer: result.statutory.epsEmployer,
              edliEmployer: result.statutory.edliEmployer,
              pfAdminEmployer: result.statutory.pfAdminEmployer,
              esiWages: result.statutory.esiWages,
              esiEmployee: result.statutory.esiEmployee,
              esiEmployer: result.statutory.esiEmployer,
              professionalTax: result.statutory.professionalTax,
              lwfEmployee: result.statutory.lwfEmployee,
              lwfEmployer: result.statutory.lwfEmployer,
              tds: result.statutory.tds,
              taxComputation: (result.statutory.taxComputation ?? undefined) as any,
            })),
          });
        }

        closedLoans = await this.recordLoanRepayments(
          tx,
          tenantId,
          id,
          run.month,
          run.year,
          results,
        );

        // Guarded on the claim this recompute still holds. A reset can move
        // the run back to DRAFT and clear its payslips while this was still
        // calculating; publishing on the id alone would recreate payslips on a
        // run somebody deliberately emptied. A refusal here rolls the loan
        // reversal and re-recording above back with it.
        const recomputed = await tx.payrollRun.update({
          where: { id, status: PayrollRunStatus.PROCESSING },
          data: {
            status: PayrollRunStatus.COMPUTED,
            totalGross,
            totalDeductions,
            totalNet,
            processedCount: results.length,
            processedAt: new Date(),
            processedById: userId,
          },
          include: {
            _count: { select: { payslips: true } },
          },
        });
        // New figures need a fresh sign-off: restart the approval (round + 1)
        // with whoever recomputed as the maker.
        await this.startApproval(tx, tenantId, id, userId, totalNet);
        return recomputed;
      }, PAYROLL_WRITE_TX_OPTIONS);

      await this.loansService.notifyLoansClosed(tenantId, closedLoans);
      void this.workflow.notifyPending(tenantId, 'PAYROLL_RUN', id);

      // Tell the caller what actually changed, not just that it succeeded.
      return {
        ...updatedRun,
        previousTotals,
        changed: {
          totalGross: new Decimal(updatedRun.totalGross).sub(
            new Decimal(previousTotals.totalGross),
          ),
          totalDeductions: new Decimal(updatedRun.totalDeductions).sub(
            new Decimal(previousTotals.totalDeductions),
          ),
          totalNet: new Decimal(updatedRun.totalNet).sub(
            new Decimal(previousTotals.totalNet),
          ),
          processedCount:
            updatedRun.processedCount - previousTotals.processedCount,
        },
      };
    } catch (error) {
      // Revert to COMPUTED — the status this run was in before the claim —
      // not DRAFT. A failed recompute must not leave the run looking like
      // it was never computed at all.
      // Same guard: only revert a run this recompute still holds. If somebody
      // reset it meanwhile, marking it COMPUTED would leave a run with that
      // status and no payslips.
      await this.prisma.payrollRun.updateMany({
        where: { id, status: PayrollRunStatus.PROCESSING },
        data: { status: PayrollRunStatus.COMPUTED },
      });
      throw error;
    }
  }

  /**
   * Release a run that is stuck in PROCESSING.
   *
   * The claim that moves DRAFT -> PROCESSING is deliberately outside the write
   * transaction so it acts as a lock. That means a hard crash (pod restart, OOM)
   * between the claim and the commit leaves the run PROCESSING forever, with no
   * payslips, and every retry refused. This is the manual way out.
   *
   * Like deleteRun and recomputeRun, it is refused (409, from
   * `clearPayrollRepayments`) when a loan this month's payroll repaid has
   * since been recovered by a final settlement: reversing the instalment
   * would reopen a leaver's loan with a balance nothing collects.
   */
  async resetRun(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.PROCESSING) {
      throw new BadRequestException(
        `Only a run stuck in PROCESSING can be reset. This run is ${run.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // An approval left pending by an earlier compute has nothing to sign
      // off any more; the next process starts a new round. Cancelled first:
      // approve locks the approval instance before the run, so this does too.
      await this.workflow.cancel(tenantId, 'PAYROLL_RUN', id, tx);

      // Loan instalments the abandoned attempt managed to record are reversed
      // too, in the same transaction that discards their payslips. A
      // repayment with no payslip behind it is money taken off a loan that
      // nobody was ever charged for.
      await this.loansService.clearPayrollRepayments(
        tenantId,
        run.month,
        run.year,
        tx,
      );

      // Any payslips from the abandoned attempt are discarded so the rerun
      // starts clean.
      await tx.payslip.deleteMany({ where: { payrollRunId: id } });
      return tx.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.DRAFT,
          processedCount: 0,
          processedAt: null,
        },
      });
    });
  }

  /**
   * Credit each loan with what its payslip actually deducted, inside the
   * run's write transaction.
   *
   * The repayment row carries the payslip's id and `createMany` does not hand
   * one back, so the ids are read back inside the same transaction, off the
   * rows it has just written. Employees whose payslip took no instalment are
   * not passed to the loans service at all.
   *
   * The loans service is strict inside this transaction: every line a
   * payslip deducts must be credited in full. The calculation ran outside
   * the transaction, so a loan can change under it — a settlement that
   * closed it, a manual repayment that left less owing than the EMI
   * computed, or a balance moving between the read and the guarded write.
   * Each is a 409 rather than a skipped or trimmed line, since either would
   * leave a payslip deducting money the loan is never credited with.
   *
   * There is no retry on that 409. Retrying inside the transaction would
   * re-read a loan whose repayment row this attempt had already written and
   * skip its decrement, and the payslips were calculated against the old
   * balance anyway; instead the whole run rolls back — reversal, payslips and
   * repayments together — the run returns to its previous status, and the
   * caller runs it again to recalculate against the current balances.
   *
   * Returns the loans that reached zero, for telling after the commit.
   */
  private async recordLoanRepayments(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runId: string,
    month: number,
    year: number,
    results: PayslipData[],
  ): Promise<ClosedLoan[]> {
    const withLoans = results.filter(
      (result) => (result.loanRepayments?.length ?? 0) > 0,
    );
    if (withLoans.length === 0) return [];

    const slips = await tx.payslip.findMany({
      where: { payrollRunId: runId, tenantId },
      select: { id: true, employeeId: true },
    });
    const payslipIdFor = new Map(
      slips.map((slip) => [slip.employeeId, slip.id]),
    );

    const closed: ClosedLoan[] = [];
    for (const result of withLoans) {
      const payslipId = payslipIdFor.get(result.employeeId);
      // No payslip written means nothing was charged, so nothing is owed.
      if (!payslipId) continue;
      const lines: PayrollRepaymentLine[] = result.loanRepayments;
      const closedHere = await this.loansService.recordPayrollRepayments(
        tenantId,
        result.employeeId,
        month,
        year,
        payslipId,
        lines,
        tx,
      );
      closed.push(...(closedHere ?? []));
    }
    return closed;
  }

  /**
   * Checker step of maker-checker, through the approval engine: the engine
   * authorizes the actor (HR by default) and refuses whoever computed the run
   * (403) unless the tenant's PAYROLL_RUN workflow allows self-approval. On
   * an intermediate step of a multi-level chain the run stays COMPUTED.
   */
  async approveRun(
    tenantId: string,
    id: string,
    actor: AuthenticatedUser,
    note?: string | null,
  ) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.COMPUTED) {
      throw new BadRequestException(
        `Cannot approve run in ${run.status} status. Only COMPUTED runs can be approved.`,
      );
    }

    // Assigned inside onFinal; the cast stops TS narrowing it to null here.
    let approved = null as PayrollRun | null;
    const result = await this.workflow.act({
      tenantId,
      entityType: 'PAYROLL_RUN',
      entityId: id,
      actor,
      decision: 'APPROVE',
      note,
      onFinal: async (tx) => {
        // Conditional on the status just checked: two concurrent approvals
        // both pass the check above, but only one can move COMPUTED ->
        // APPROVED. The other matches no row (P2025) and gets a 409, which
        // rolls its recorded action back — and, crucially, never reaches the
        // side effects below, so payslips are emailed and the webhook fires
        // once. A recompute that claimed the run (PROCESSING) meanwhile is
        // refused the same way.
        try {
          approved = await tx.payrollRun.update({
            where: { id, tenantId, status: PayrollRunStatus.COMPUTED },
            data: {
              status: PayrollRunStatus.APPROVED,
              approvedAt: new Date(),
            },
          });
        } catch (err) {
          if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
            throw new ConflictException('Payroll run is already being approved');
          }
          throw err;
        }
      },
    });

    if (result.outcome === 'ADVANCED' || !approved) {
      return run;
    }

    // This call won the approval and it has committed. Everything below is
    // best-effort and not awaited: a mail server or customer webhook must
    // neither fail nor slow the approval.
    this.afterApproval(tenantId, approved);

    return approved;
  }

  /** Engine routing context of a COMPUTED run; null otherwise. */
  async getWorkflowContext(
    tenantId: string,
    id: string,
  ): Promise<WorkflowEntityContext | null> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId, status: PayrollRunStatus.COMPUTED },
      select: { processedById: true, totalNet: true },
    });
    if (!run) return null;
    return {
      requesterEmployeeId: null,
      // Null for runs computed before maker-checker: not restricted.
      requesterUserId: run.processedById ?? null,
      amount: Number(run.totalNet),
    };
  }

  /** (Re)start the PAYROLL_RUN approval inside the compute's write transaction. */
  private startApproval(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    userId: string,
    totalNet: Decimal,
  ) {
    return this.workflow.start({
      tenantId,
      entityType: 'PAYROLL_RUN',
      entityId: id,
      context: {
        requesterEmployeeId: null,
        requesterUserId: userId,
        amount: totalNet.toNumber(),
      },
      tx,
    });
  }

  /** Fire-and-forget side effects of an approval. Never throws. */
  private afterApproval(
    tenantId: string,
    run: {
      id: string;
      month: number;
      year: number;
      totalGross: Decimal | number;
      totalDeductions: Decimal | number;
      totalNet: Decimal | number;
      processedCount: number;
      approvedAt: Date | null;
    },
  ): void {
    const fireAndForget = (label: string, start: () => Promise<unknown>) => {
      try {
        Promise.resolve(start()).catch((error: unknown) =>
          this.logger.error(`${label} for payroll run ${run.id} failed: ${
            error instanceof Error ? error.message : error
          }`),
        );
      } catch (error) {
        this.logger.error(`${label} for payroll run ${run.id} failed: ${
          error instanceof Error ? error.message : error
        }`);
      }
    };

    fireAndForget('Payslip emails', () =>
      this.payslipEmailService.notifyRunApproved(tenantId, run.id),
    );

    // Run-level totals only — no per-employee salary data leaves the tenant.
    fireAndForget('payroll.approved webhook', () =>
      this.webhookDispatcher.dispatch(tenantId, 'payroll.approved', {
        runId: run.id,
        month: run.month,
        year: run.year,
        totalGross: Number(run.totalGross),
        totalDeductions: Number(run.totalDeductions),
        totalNet: Number(run.totalNet),
        processedCount: run.processedCount,
        approvedAt: run.approvedAt ? run.approvedAt.toISOString() : null,
      }),
    );
  }

  async markAsPaid(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot mark as paid. Only APPROVED runs can be marked as paid.`,
      );
    }

    return this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollRunStatus.PAID },
    });
  }

  async deleteRun(tenantId: string, id: string, userRole?: UserRole) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    // An approved or paid run is a financial record. Deleting it takes its
    // payslips with it and leaves no trace that people were paid, which no
    // role should be able to do. Corrections belong in a supplementary run.
    if (
      run.status === PayrollRunStatus.PAID ||
      run.status === PayrollRunStatus.APPROVED
    ) {
      throw new BadRequestException(
        `A ${run.status} payroll run cannot be deleted; it is the record of what was paid.`,
      );
    }
    if (userRole !== UserRole.SUPER_ADMIN && run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT runs can be deleted');
    }

    // Deleting the payslips deletes the evidence that anyone was charged an
    // instalment, so the instalments have to go back to the loans first.
    // `LoanRepayment.payslipId` carries no FK, so nothing cascades: without
    // this the borrower's balance stays reduced for money never deducted.
    // A no-op when the run never reached COMPUTED. Reversed in the same
    // transaction as the delete, so neither can happen without the other.
    // All writes together: a half-deleted run would leave orphaned payslips.
    await this.prisma.$transaction(async (tx) => {
      // Approval instance first: approve locks it before the run.
      await this.workflow.cancel(tenantId, 'PAYROLL_RUN', id, tx);
      await this.loansService.clearPayrollRepayments(
        tenantId,
        run.month,
        run.year,
        tx,
      );
      await tx.payslip.deleteMany({ where: { payrollRunId: id } });
      await tx.payrollRun.delete({ where: { id } });
    });
  }

  // ============================================
  // Payslips
  // ============================================

  async getPayslipsForRun(
    tenantId: string,
    runId: string,
    query: PayslipQueryDto,
  ) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '50');

    const [data, total] = await Promise.all([
      this.prisma.payslip.findMany({
        where: { tenantId, payrollRunId: runId },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              designation: true,
              department: { select: { name: true } },
            },
          },
        },
        orderBy: { employee: { firstName: 'asc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payslip.count({
        where: { tenantId, payrollRunId: runId },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getMyPayslips(tenantId: string, employeeId: string) {
    if (!employeeId) {
      throw new BadRequestException(
        'No employee profile linked to this user',
      );
    }

    return this.prisma.payslip.findMany({
      where: {
        tenantId,
        employeeId,
        payrollRun: {
          status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
        },
      },
      include: {
        payrollRun: {
          select: { month: true, year: true, status: true },
        },
      },
      orderBy: [
        { payrollRun: { year: 'desc' } },
        { payrollRun: { month: 'desc' } },
      ],
    });
  }

  async getPayslip(tenantId: string, id: string) {
    const payslip = await this.prisma.payslip.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            designation: true,
            department: { select: { name: true } },
            joinDate: true,
          },
        },
        payrollRun: {
          select: { month: true, year: true, status: true },
        },
      },
    });
    if (!payslip) throw new NotFoundException('Payslip not found');
    return payslip;
  }

  async getEmployeePayslips(tenantId: string, employeeId: string) {
    return this.prisma.payslip.findMany({
      where: {
        tenantId,
        employeeId,
        payrollRun: {
          status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
        },
      },
      include: {
        payrollRun: {
          select: { month: true, year: true, status: true },
        },
      },
      orderBy: [
        { payrollRun: { year: 'desc' } },
        { payrollRun: { month: 'desc' } },
      ],
    });
  }
}
