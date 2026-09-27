import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CalculationOptions,
  PayrollCalculationService,
  PayslipData,
  PayslipExtras,
} from './payroll-calculation.service';
import {
  CreateOffCycleRunDto,
  CreatePayrollRunDto,
  PayrollRunQueryDto,
  PayslipQueryDto,
} from './dto/payroll.dto';
import {
  EmployeeStatus,
  PayrollRun,
  PayrollRunStatus,
  PayrollRunType,
  Prisma,
  SettlementStatus,
  UserRole,
} from '@prisma/client';
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
import { SalaryArrearsService } from './adjustments/salary-arrears.service';
import { OneTimePaymentsService } from './adjustments/one-time-payments.service';
import { SalaryHoldsService } from './adjustments/salary-holds.service';
import {
  PayrollReimbursementsService,
  SettledClaim,
} from './adjustments/payroll-reimbursements.service';
import { PayrollSettingsService } from './adjustments/payroll-settings.service';
import { EMPLOYEE_REF_SELECT, iso, num, toEmployeeRef } from './adjustments/views';
import { EmployeeRef } from './payroll-depth.types';

/** A settlement row as a run's settlements tab shows it. */
export interface RunSettlementRow {
  id: string;
  employee: EmployeeRef;
  status: SettlementStatus;
  netPayable: number;
  lastWorkingDate: string;
  payrollRunId: string | null;
}

/** The run fields the compute path needs. */
type ComputableRun = Pick<
  PayrollRun,
  'id' | 'tenantId' | 'month' | 'year' | 'status'
> & {
  runType?: PayrollRunType | null;
  includeSalary?: boolean | null;
  scopeEmployeeIds?: string[] | null;
};

/** What the write transaction attaches to the run besides its payslips. */
interface RunAttachments {
  arrearIds: string[];
  claimIds: string[];
}

const SETTLEMENT_SELECT = {
  id: true,
  employeeId: true,
  status: true,
  netPayable: true,
  lastWorkingDate: true,
  payrollRunId: true,
  proRataSalary: true,
  leaveEncashment: true,
  leaveEncashmentExempt: true,
  gratuity: true,
  gratuityExempt: true,
  otherEarnings: true,
  noticeRecovery: true,
  otherRecoveries: true,
  totalRecoveries: true,
  tds: true,
  employee: { select: EMPLOYEE_REF_SELECT },
} as const;

function isOffCycle(run: { runType?: PayrollRunType | null }): boolean {
  return run.runType === PayrollRunType.OFF_CYCLE;
}

/** An off-cycle run that pays the month's salary, not only extras. */
function paysOffCycleSalary(run: {
  runType?: PayrollRunType | null;
  includeSalary?: boolean | null;
}): boolean {
  return isOffCycle(run) && run.includeSalary === true;
}

/** Either client: `this.prisma` or a transaction's. */
type PayrollDb = Pick<Prisma.TransactionClient, 'payslip' | 'payrollRun'>;

export const REGULAR_RUN_FIRST =
  'Process and approve the regular run for this month first; off-cycle salary is for employees it did not pay';

/**
 * Review C1: an off-cycle run paying salary is only for people the month's
 * regular run did not pay, so that run must exist and be signed off first
 * (APPROVED or PAID — neither can be recomputed, reset or deleted). While it
 * is still DRAFT or COMPUTED it could yet pay the same people a second time.
 */
async function assertRegularRunSettled(
  db: PayrollDb,
  tenantId: string,
  month: number,
  year: number,
): Promise<void> {
  const regular = await db.payrollRun.findUnique({
    where: {
      tenantId_month_year_runType_sequence: {
        tenantId,
        month,
        year,
        runType: PayrollRunType.REGULAR,
        sequence: 0,
      },
    },
    select: { id: true, status: true },
  });
  if (
    !regular ||
    (regular.status !== PayrollRunStatus.APPROVED && regular.status !== PayrollRunStatus.PAID)
  ) {
    throw new BadRequestException(REGULAR_RUN_FIRST);
  }
}

/**
 * Review C1: which of these employees already have a payslip paying the
 * month's salary in another run of this tenant — the regular run, or an
 * off-cycle run with `includeSalary` — in whatever status (a COMPUTED run's
 * payslips are about to be paid).
 *
 * Held salaries still count, whatever the hold's status: HELD is paid later
 * by a release, RELEASED has been paid by one, and VOIDED is a decision not to
 * pay that month's salary whose payslip still carries the month's tax, PF and
 * ESI. Paying salary for the month again would pay twice or duplicate those
 * statutory figures, so none of them frees the month up.
 */
export async function findEmployeesWithSalaryElsewhere(
  db: PayrollDb,
  tenantId: string,
  month: number,
  year: number,
  employeeIds: string[],
  excludeRunId?: string,
): Promise<{ employeeId: string; employeeCode: string }[]> {
  if (employeeIds.length === 0) return [];
  const slips =
    (await db.payslip.findMany({
      where: {
        tenantId,
        employeeId: { in: employeeIds },
        ...(excludeRunId ? { payrollRunId: { not: excludeRunId } } : {}),
        payrollRun: {
          tenantId,
          month,
          year,
          OR: [
            { runType: PayrollRunType.REGULAR },
            { runType: PayrollRunType.OFF_CYCLE, includeSalary: true },
          ],
        },
      },
      select: { employeeId: true, employee: { select: { employeeCode: true } } },
    })) ?? [];
  const seen = new Map<string, string>();
  for (const s of slips) seen.set(s.employeeId, s.employee.employeeCode);
  return [...seen].map(([employeeId, employeeCode]) => ({ employeeId, employeeCode }));
}

/** Refuses (400, naming them) when anyone here was paid salary elsewhere. */
async function assertNoSalaryElsewhere(
  db: PayrollDb,
  tenantId: string,
  month: number,
  year: number,
  employeeIds: string[],
  excludeRunId?: string,
): Promise<void> {
  const paid = await findEmployeesWithSalaryElsewhere(
    db,
    tenantId,
    month,
    year,
    employeeIds,
    excludeRunId,
  );
  if (paid.length > 0) {
    throw new BadRequestException(
      `Another payroll run already pays ${month}/${year} salary to ${paid
        .map((p) => p.employeeCode)
        .slice(0, 10)
        .join(', ')}; an off-cycle run cannot pay their salary again`,
    );
  }
}

function dec(value: unknown): Decimal {
  return new Decimal((value ?? 0) as Decimal.Value);
}

/** A payslip line as stored in the JSON column (payroll-lines.types.ts). */
function toJsonLine(line: {
  name: string;
  amount: Decimal | number;
  kind?: string;
  taxable?: boolean;
  refId?: string | null;
}) {
  return {
    name: line.name,
    amount: new Decimal(line.amount as Decimal.Value).toNumber(),
    ...(line.kind ? { kind: line.kind } : {}),
    ...(line.taxable !== undefined ? { taxable: line.taxable } : {}),
    ...(line.refId ? { refId: line.refId } : {}),
  };
}

function toSettlementRow(s: {
  id: string;
  status: SettlementStatus;
  netPayable: unknown;
  lastWorkingDate: Date;
  payrollRunId: string | null;
  employee: { id: string; employeeCode: string; firstName: string; lastName: string };
}): RunSettlementRow {
  return {
    id: s.id,
    employee: toEmployeeRef(s.employee),
    status: s.status,
    netPayable: num(s.netPayable),
    lastWorkingDate: iso(s.lastWorkingDate) as string,
    payrollRunId: s.payrollRunId,
  };
}

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
    private arrears: SalaryArrearsService,
    private oneTimePayments: OneTimePaymentsService,
    private holds: SalaryHoldsService,
    private reimbursements: PayrollReimbursementsService,
    private settings: PayrollSettingsService,
  ) {}

  // ============================================
  // Payroll Runs
  // ============================================

  async getRuns(tenantId: string, query: PayrollRunQueryDto) {
    const where: any = { tenantId };
    if (query.year) where.year = parseInt(query.year);
    if (query.status) where.status = query.status;

    // runType, sequence, needsRecompute etc. are scalar columns and come back
    // with every run; the month's regular run (sequence 0) sorts first.
    return this.prisma.payrollRun.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { sequence: 'asc' }],
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
        // The month's REGULAR run is always sequence 0; off-cycle runs
        // (Keka wave C) share the month with higher sequences.
        tenantId_month_year_runType_sequence: {
          tenantId,
          month: dto.month,
          year: dto.year,
          runType: 'REGULAR',
          sequence: 0,
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
   * An off-cycle run (spec C5): a DRAFT run for a limited set of employees,
   * numbered after the month's other off-cycle runs. A concurrent create that
   * takes the same sequence makes the unique key refuse one of them; that one
   * retries once with the next number, then answers 409.
   */
  async createOffCycleRun(tenantId: string, dto: CreateOffCycleRunDto) {
    const employeeIds = [...new Set(dto.employeeIds ?? [])];
    if (employeeIds.length < 1 || employeeIds.length > 500) {
      throw new BadRequestException('An off-cycle run covers 1 to 500 employees');
    }
    const reason = (dto.reason ?? '').trim();
    if (reason.length < 1 || reason.length > 500) {
      throw new BadRequestException('A reason of 1 to 500 characters is required');
    }

    const found = await this.prisma.employee.findMany({
      where: {
        tenantId,
        id: { in: employeeIds },
        status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.INACTIVE] },
      },
      select: { id: true },
    });
    const known = new Set((found ?? []).map((e) => e.id));
    const unknown = employeeIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown employee id(s) for this tenant: ${unknown.slice(0, 10).join(', ')}`,
      );
    }

    // Review C1: refused early here, and checked again at process, recompute,
    // the payslip write and approval.
    if (dto.includeSalary === true) {
      await assertRegularRunSettled(this.prisma, tenantId, dto.month, dto.year);
      await assertNoSalaryElsewhere(this.prisma, tenantId, dto.month, dto.year, employeeIds);
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const last = await this.prisma.payrollRun.findFirst({
        where: { tenantId, month: dto.month, year: dto.year, runType: PayrollRunType.OFF_CYCLE },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      try {
        return await this.prisma.payrollRun.create({
          data: {
            tenantId,
            month: dto.month,
            year: dto.year,
            runType: PayrollRunType.OFF_CYCLE,
            sequence: (last?.sequence ?? 0) + 1,
            offCycleReason: reason,
            includeSalary: dto.includeSalary === true,
            scopeEmployeeIds: employeeIds,
          },
        });
      } catch (err) {
        if (isPrismaError(err, 'P2002') && attempt === 0) continue;
        if (isPrismaError(err, 'P2002')) {
          throw new ConflictException(
            'Another off-cycle run for this month was created at the same time; try again',
          );
        }
        throw err;
      }
    }
    // Unreachable: the loop returns or throws.
    throw new ConflictException('Could not allocate an off-cycle run number; try again');
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

      // A regular run pays every active employee with a salary assignment;
      // an off-cycle run exactly its scope.
      const employeeIds = isOffCycle(run)
        ? [...(run.scopeEmployeeIds ?? [])]
        : ((await this.prisma.employee.findMany({
            where: { tenantId, status: 'ACTIVE' },
            select: { id: true },
          })) ?? []).map((e) => e.id);

      // Compute every payslip first (reads only), so the write transaction
      // below stays short and cannot time out mid-run on a large tenant.
      const { results, attachments } = await this.computePayslips(run, employeeIds, 'process');

      // Totals are summed as exact decimals, so they always match the sum of
      // the payslip line items rather than drifting by fractions of a paisa.
      const { totalGross, totalDeductions, totalNet } = this.totals(results);

      // Reverse any earlier attempt's loan instalments, replace the payslips,
      // re-record the instalments against them and publish the totals — all
      // atomically: a failure part way through must not leave a
      // half-generated run, or loan balances reversed but not re-recorded.
      let closedLoans: ClosedLoan[] = [];
      const publishedRun = await this.prisma.$transaction(async (tx) => {
        closedLoans = await this.writePayslips(tx, run, results, attachments);

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
            // Everything attached so far is in these figures.
            needsRecompute: false,
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
      // The employees this run already covers, not whoever is active today. A
      // run computed in April and recomputed in June must still cover somebody
      // who left in May: taking the current active list would delete their
      // payslip and quietly shrink a run that may already have been reported
      // on. Anyone hired since belongs in their own run, not retrofitted here.
      // (An off-cycle run always covers its scope.)
      const employeeIds = isOffCycle(run)
        ? [...(run.scopeEmployeeIds ?? [])]
        : ((await this.prisma.payslip.findMany({
            where: { payrollRunId: id, tenantId },
            select: { employeeId: true },
          })) ?? []).map((slip) => slip.employeeId);

      // The instalments the previous compute recorded belong to payslips that
      // are about to be deleted, so they are reversed — but inside the write
      // transaction below, together with the re-recording, not here on their
      // own. The calculation reads loan balances as if that reversal had
      // already happened (`getPayrollDeductions`), so it proposes the same
      // EMI it would after a separate reversal, without a failure in between
      // being able to leave every balance reversed and nothing re-recorded.

      // Compute every payslip first (reads only), so the write transaction
      // below stays short and cannot time out mid-run on a large tenant.
      const { results, attachments } = await this.computePayslips(run, employeeIds, 'recompute');

      const { totalGross, totalDeductions, totalNet } = this.totals(results);

      // Reverse the previous instalments, replace the payslips, re-record the
      // instalments and publish the totals atomically: a failure part way
      // through must not leave the run with some old payslips and some new,
      // nor loan balances reversed with nothing re-recorded.
      let closedLoans: ClosedLoan[] = [];
      const updatedRun = await this.prisma.$transaction(async (tx) => {
        closedLoans = await this.writePayslips(tx, run, results, attachments);

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
            needsRecompute: false,
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
   * Keka wave C: gather what is attached to the run (arrears, one-time
   * payments, released holds, reimbursements, settlements), then compute
   * every payslip (reads only). Returns the results and the ids the write
   * transaction must attach, so that only what a payslip actually pays is
   * marked as paid by this run.
   */
  private async computePayslips(
    run: ComputableRun,
    baseEmployeeIds: string[],
    mode: 'process' | 'recompute',
  ): Promise<{ results: PayslipData[]; attachments: RunAttachments }> {
    const tenantId = run.tenantId;
    const offCycle = isOffCycle(run);

    // An off-cycle run paying salary must not pay a month another run pays
    // (review C1). Checked before anything is computed; writePayslips and
    // approveRun check again inside their transactions.
    if (paysOffCycleSalary(run)) {
      await assertRegularRunSettled(this.prisma, tenantId, run.month, run.year);
      await assertNoSalaryElsewhere(
        this.prisma,
        tenantId,
        run.month,
        run.year,
        baseEmployeeIds,
        run.id,
      );
    }

    const settings = await this.settings.get(tenantId);

    // Explicit inputs: one-time payments and released holds.
    const payments = (await this.oneTimePayments.forRun(tenantId, run.id)) ?? [];
    const releases = (await this.holds.releasesForRun(tenantId, run.id)) ?? [];

    let employeeIds = [...baseEmployeeIds];
    if (!offCycle) {
      const explicit = [
        ...new Set([...payments.map((p) => p.employeeId), ...releases.map((r) => r.employeeId)]),
      ].filter((id) => !employeeIds.includes(id));
      if (explicit.length > 0 && mode === 'process') {
        // Validated ACTIVE when added; somebody who has left since is not in
        // a regular run and must not be paid a month's salary to carry them.
        throw new BadRequestException(
          `One-time payments or held-salary releases in this run belong to employees who are no longer active (${explicit
            .slice(0, 10)
            .join(', ')}); remove them or pay them through an off-cycle run`,
        );
      }
      // A recompute also covers whoever an input was added for since.
      employeeIds = [...employeeIds, ...explicit];
    }

    // Settlements travel only in off-cycle runs, verbatim and alone.
    const settlements = offCycle
      ? ((await this.prisma.settlement.findMany({
          where: { tenantId, payrollRunId: run.id },
          select: SETTLEMENT_SELECT,
        })) ?? [])
      : [];
    const settled = new Set(settlements.map((s) => s.employeeId));
    for (const s of settlements) {
      if (s.status !== SettlementStatus.APPROVED) {
        throw new BadRequestException(
          `Settlement ${s.id} is ${s.status}; only an APPROVED settlement can be paid by a run`,
        );
      }
      if (run.includeSalary) {
        throw new BadRequestException(
          'A settlement already pays the pro-rata salary; carry it in an off-cycle run that does not include salary',
        );
      }
      if (
        payments.some((p) => p.employeeId === s.employeeId) ||
        releases.some((r) => r.employeeId === s.employeeId)
      ) {
        throw new BadRequestException(
          `A settlement is paid on its own payslip; remove the other payments for ${s.employee.employeeCode} from this run`,
        );
      }
    }

    // Arrears for backdated revisions are detected for a regular run's
    // employees before it computes (spec C1), when the tenant has it on.
    if (!offCycle && settings.autoArrears) {
      for (const employeeId of employeeIds) {
        await this.arrears.detectForEmployee(tenantId, employeeId);
      }
    }

    // Automatic inputs: never for a settlement's employee (paid alone).
    const auto = employeeIds.filter((id) => !settled.has(id));
    const arrears = (await this.arrears.pendingForRun(tenantId, run, auto)) ?? [];
    const claims = settings.reimburseExpensesViaPayroll
      ? ((await this.reimbursements.claimsForRun(tenantId, run.id, auto)) ?? [])
      : [];

    const extras = new Map<string, PayslipExtras>();
    const extrasOf = (employeeId: string): PayslipExtras => {
      let e = extras.get(employeeId);
      if (!e) {
        e = {};
        extras.set(employeeId, e);
      }
      return e;
    };
    for (const a of arrears) {
      (extrasOf(a.employeeId).arrears ??= []).push({
        id: a.id,
        amount: dec(a.amount),
        pfWagesDelta: dec(a.pfWagesDelta),
        financialYear: a.financialYear,
      });
    }
    for (const p of payments) {
      (extrasOf(p.employeeId).oneTimePayments ??= []).push({
        id: p.id,
        kind: p.kind,
        name: p.name,
        amount: dec(p.amount),
        taxable: p.taxable,
      });
    }
    for (const c of claims) {
      (extrasOf(c.employeeId).reimbursements ??= []).push({ id: c.id, amount: dec(c.amount) });
    }
    for (const r of releases) {
      (extrasOf(r.employeeId).holdReleases ??= []).push({
        id: r.id,
        amount: dec(r.heldAmount),
        heldMonth: r.payrollRun.month,
        heldYear: r.payrollRun.year,
      });
    }
    for (const s of settlements) {
      extrasOf(s.employeeId).settlement = {
        id: s.id,
        proRataSalary: dec(s.proRataSalary),
        leaveEncashment: dec(s.leaveEncashment),
        leaveEncashmentExempt: dec(s.leaveEncashmentExempt),
        gratuity: dec(s.gratuity),
        gratuityExempt: dec(s.gratuityExempt),
        otherEarnings: dec(s.otherEarnings),
        noticeRecovery: dec(s.noticeRecovery),
        otherRecoveries: dec(s.otherRecoveries),
        totalRecoveries: dec(s.totalRecoveries),
        tds: dec(s.tds),
        netPayable: dec(s.netPayable),
      };
    }

    const results: PayslipData[] = [];
    for (const employeeId of employeeIds) {
      const employeeExtras = extras.get(employeeId);
      const options: CalculationOptions = offCycle
        ? {
            payrollRunId: run.id,
            offCycle: true,
            includeSalary: run.includeSalary === true,
            // Off-cycle runs never deduct loan instalments: clearing them is
            // keyed by month and would reverse the regular run's.
            deductLoans: false,
            chargeMonthlyStatutory: false,
            ...(employeeExtras ? { extras: employeeExtras } : {}),
          }
        : {
            payrollRunId: run.id,
            ...(employeeExtras ? { extras: employeeExtras } : {}),
          };
      const result = await this.calculationService.calculateForEmployee(
        tenantId,
        employeeId,
        run.month,
        run.year,
        options,
      );
      if (result) results.push(result); // Nothing to pay, skip
    }

    // Attach only what a written payslip pays.
    const paid = new Set(results.map((r) => r.employeeId));
    return {
      results,
      attachments: {
        arrearIds: arrears.filter((a) => paid.has(a.employeeId)).map((a) => a.id),
        claimIds: claims.filter((c) => paid.has(c.employeeId)).map((c) => c.id),
      },
    };
  }

  private totals(results: PayslipData[]) {
    return {
      totalGross: results.reduce((sum, r) => sum.add(r.grossPay), new Decimal(0)),
      totalDeductions: results.reduce((sum, r) => sum.add(r.totalDeductions), new Decimal(0)),
      totalNet: results.reduce((sum, r) => sum.add(r.netPay), new Decimal(0)),
    };
  }

  /**
   * The payslip half of the run's write transaction: reverse the month's
   * loan instalments (regular runs only), detach what an earlier compute
   * attached, replace the payslips, attach what these payslips pay (guarded:
   * a 409 rolls everything back) and re-record the loan instalments.
   */
  private async writePayslips(
    tx: Prisma.TransactionClient,
    run: ComputableRun,
    results: PayslipData[],
    attachments: RunAttachments,
  ): Promise<ClosedLoan[]> {
    const tenantId = run.tenantId;
    const offCycle = isOffCycle(run);

    // Review C1: again inside the transaction, for a run computed meanwhile.
    if (paysOffCycleSalary(run)) {
      await assertNoSalaryElsewhere(
        tx,
        tenantId,
        run.month,
        run.year,
        results.map((r) => r.employeeId),
        run.id,
      );
    }

    // Keyed by month: an off-cycle run would reverse the regular run's.
    if (!offCycle) {
      await this.loansService.clearPayrollRepayments(tenantId, run.month, run.year, tx);
    }

    await this.arrears.detachFromRun(tx, tenantId, run.id);
    await this.reimbursements.detachFromRun(tx, tenantId, run.id);

    await tx.payslip.deleteMany({ where: { payrollRunId: run.id } });

    if (results.length > 0) {
      await tx.payslip.createMany({
        data: results.map((result) => ({
          tenantId,
          payrollRunId: run.id,
          employeeId: result.employeeId,
          workingDays: result.workingDays,
          presentDays: result.presentDays,
          leaveDays: result.leaveDays,
          lopDays: result.lopDays,
          otHours: result.otHours,
          basePay: result.basePay,
          // JSON columns cannot hold Decimal; these are already rounded to
          // paise, so a number round-trips exactly at this magnitude. Lines
          // follow the contract in payroll-lines.types.ts.
          earnings: result.earnings.map(toJsonLine) as any,
          deductions: result.deductions.map(toJsonLine) as any,
          grossPay: result.grossPay,
          totalDeductions: result.totalDeductions,
          netPay: result.netPay,
          otPay: result.otPay,
          nonRecurringTaxable: result.nonRecurringTaxable ?? 0,
          nonTaxableEarnings: result.nonTaxableEarnings ?? 0,
          arrearsAmount: result.arrearsAmount ?? 0,
          reimbursementAmount: result.reimbursementAmount ?? 0,
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

    await this.arrears.attachToRun(tx, tenantId, run.id, attachments.arrearIds);
    await this.reimbursements.attachToRun(tx, tenantId, run.id, attachments.claimIds);

    if (offCycle) return [];
    return this.recordLoanRepayments(tx, tenantId, run.id, run.month, run.year, results);
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
   *
   * Keka wave C: arrears, expense claims, released holds and settlements
   * the run carried are detached; one-time payments are kept.
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
      // nobody was ever charged for. (Off-cycle runs record none.)
      if (!isOffCycle(run)) {
        await this.loansService.clearPayrollRepayments(
          tenantId,
          run.month,
          run.year,
          tx,
        );
      }

      await this.detachCarried(tx, tenantId, id);

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

  /** Arrears, claims, released holds and settlements the run carries. */
  private async detachCarried(tx: Prisma.TransactionClient, tenantId: string, runId: string) {
    await this.arrears.detachFromRun(tx, tenantId, runId);
    await this.reimbursements.detachFromRun(tx, tenantId, runId);
    await this.holds.detachReleases(tx, tenantId, runId);
    await tx.settlement.updateMany({
      where: { tenantId, payrollRunId: runId, status: SettlementStatus.APPROVED },
      data: { payrollRunId: null },
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
    // A one-time payment, released hold or settlement changed after the
    // figures were computed: they no longer say what the run would pay.
    if (run.needsRecompute) {
      throw new BadRequestException(
        'Inputs changed since this run was computed; recompute it before approval',
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
        // Review C1: two off-cycle salary runs can both sit COMPUTED, each
        // written before the other committed. Neither is approved while the
        // other still has payslips for the same people (deliberately strict:
        // counting only approved runs would let two concurrent approvals
        // each miss the other); deleting one of them unblocks the other.
        if (paysOffCycleSalary(run)) {
          const mine =
            (await tx.payslip.findMany({
              where: { tenantId, payrollRunId: id },
              select: { employeeId: true },
            })) ?? [];
          await assertNoSalaryElsewhere(
            tx,
            tenantId,
            run.month,
            run.year,
            mine.map((s) => s.employeeId),
            id,
          );
        }
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

  /**
   * APPROVED -> PAID, stamping `paidAt`. What the run carried is settled in
   * the same transaction (spec C6): its arrears become PAID, its expense
   * claims REIMBURSED and its settlements PAID, as of this payment — that is
   * when the money moves. Claimants are told after the commit.
   */
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

    const paidAt = new Date();
    let settledClaims: SettledClaim[] = [];
    const paid = await this.prisma.$transaction(async (tx) => {
      let updated: PayrollRun;
      try {
        updated = await tx.payrollRun.update({
          where: { id, status: PayrollRunStatus.APPROVED },
          data: { status: PayrollRunStatus.PAID, paidAt },
        });
      } catch (err) {
        if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
          throw new ConflictException('Payroll run is already being marked as paid');
        }
        throw err;
      }
      await this.arrears.markPaidForRun(tx, tenantId, id);
      settledClaims = (await this.reimbursements.settleForRun(tx, tenantId, id, paidAt)) ?? [];
      await tx.settlement.updateMany({
        where: { tenantId, payrollRunId: id, status: SettlementStatus.APPROVED },
        data: { status: SettlementStatus.PAID, paidAt },
      });
      return updated;
    });

    this.reimbursements.notifyReimbursed(tenantId, settledClaims);
    return paid;
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
      // Keyed by month: an off-cycle run recorded none, and clearing would
      // reverse the regular run's instalments.
      if (!isOffCycle(run)) {
        await this.loansService.clearPayrollRepayments(
          tenantId,
          run.month,
          run.year,
          tx,
        );
      }
      // Arrears, claims, released holds and settlements go back to where
      // they were; one-time payments and holds in this run go with it.
      await this.detachCarried(tx, tenantId, id);
      await tx.payslip.deleteMany({ where: { payrollRunId: id } });
      await tx.payrollRun.delete({ where: { id } });
    });
  }

  // ============================================
  // Settlements carried by an off-cycle run (spec C5)
  // ============================================

  /** Carried by the run, and (while it is open) the ones it could carry. */
  async listRunSettlements(
    tenantId: string,
    runId: string,
  ): Promise<{ attached: RunSettlementRow[]; eligible: RunSettlementRow[] }> {
    const run = await this.findRunOrThrow(tenantId, runId);
    const attached =
      (await this.prisma.settlement.findMany({
        where: { tenantId, payrollRunId: runId },
        select: SETTLEMENT_SELECT,
      })) ?? [];
    const open =
      isOffCycle(run) &&
      (run.status === PayrollRunStatus.DRAFT || run.status === PayrollRunStatus.COMPUTED);
    const eligible = open
      ? ((await this.prisma.settlement.findMany({
          where: {
            tenantId,
            status: SettlementStatus.APPROVED,
            payrollRunId: null,
            employeeId: { in: run.scopeEmployeeIds ?? [] },
          },
          select: SETTLEMENT_SELECT,
        })) ?? [])
      : [];
    return { attached: attached.map(toSettlementRow), eligible: eligible.map(toSettlementRow) };
  }

  async attachSettlement(tenantId: string, runId: string, settlementId: string) {
    const run = await this.findRunOrThrow(tenantId, runId);
    this.assertCarriesSettlements(run);
    if (run.includeSalary) {
      throw new BadRequestException(
        'A settlement already pays the pro-rata salary; carry it in an off-cycle run that does not include salary',
      );
    }

    const settlement = await this.prisma.settlement.findFirst({
      where: { id: settlementId, tenantId },
      select: { id: true, status: true, employeeId: true, payrollRunId: true },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.payrollRunId) {
      throw new ConflictException('The settlement is already carried by a payroll run');
    }
    if (settlement.status !== SettlementStatus.APPROVED) {
      throw new BadRequestException(
        `Only an APPROVED settlement can be paid through payroll; this one is ${settlement.status}`,
      );
    }
    if (!(run.scopeEmployeeIds ?? []).includes(settlement.employeeId)) {
      throw new BadRequestException("The settlement's employee is not in the scope of this run");
    }

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.settlement.updateMany({
        where: { id: settlementId, tenantId, status: SettlementStatus.APPROVED, payrollRunId: null },
        data: { payrollRunId: runId },
      });
      if (!res || res.count !== 1) {
        throw new ConflictException('The settlement changed meanwhile; reload and try again');
      }
      await this.touchRun(tx, tenantId, run);
    });
    return this.listRunSettlements(tenantId, runId);
  }

  async detachSettlement(tenantId: string, runId: string, settlementId: string) {
    const run = await this.findRunOrThrow(tenantId, runId);
    this.assertCarriesSettlements(run);
    const settlement = await this.prisma.settlement.findFirst({
      where: { id: settlementId, tenantId, payrollRunId: runId },
      select: { id: true },
    });
    if (!settlement) throw new NotFoundException('The run does not carry this settlement');

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.settlement.updateMany({
        where: { id: settlementId, tenantId, payrollRunId: runId, status: SettlementStatus.APPROVED },
        data: { payrollRunId: null },
      });
      if (!res || res.count !== 1) {
        throw new ConflictException('The settlement changed meanwhile; reload and try again');
      }
      await this.touchRun(tx, tenantId, run);
    });
    return this.listRunSettlements(tenantId, runId);
  }

  private async findRunOrThrow(tenantId: string, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  private assertCarriesSettlements(run: ComputableRun) {
    if (!isOffCycle(run)) {
      throw new BadRequestException('Settlements are paid through an off-cycle run');
    }
    if (run.status !== PayrollRunStatus.DRAFT && run.status !== PayrollRunStatus.COMPUTED) {
      throw new BadRequestException(
        `Settlements can change on a DRAFT or COMPUTED run; this run is ${run.status}`,
      );
    }
  }

  /** Guarded on the status read; a COMPUTED run must be recomputed. */
  private async touchRun(tx: Prisma.TransactionClient, tenantId: string, run: ComputableRun) {
    const res = await tx.payrollRun.updateMany({
      where: { id: run.id, tenantId, status: run.status },
      data: { needsRecompute: run.status === PayrollRunStatus.COMPUTED },
    });
    if (!res || res.count !== 1) {
      throw new ConflictException('The payroll run changed meanwhile; reload it and try again');
    }
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
