import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LoanStatus,
  LoanType,
  NotificationType,
  Prisma,
  RepaymentSource,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import {
  buildSchedule,
  computeArrears,
  computeEmi,
  computeTotalPayable,
  LoanArrears,
  round2,
  ScheduleRow,
} from './loan-schedule';
import {
  CreateLoanDto,
  LOAN_MAX_TENURE_MONTHS,
  SALARY_ADVANCE_MAX_TENURE_MONTHS,
} from './dto/create-loan.dto';
import { RejectLoanDto } from './dto/reject-loan.dto';
import { RecordRepaymentDto } from './dto/record-repayment.dto';
import { ListLoansDto } from './dto/list-loans.dto';

/** Enough of an employee to name them in a queue without exposing the record. */
const borrowerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
};

/**
 * Only these transitions are legal. Anything not listed is rejected, which is
 * what stops a second approval from re-stamping `approvedAt`, or a disbursed
 * loan from being cancelled out from under payroll.
 */
const ALLOWED_TRANSITIONS: Record<LoanStatus, LoanStatus[]> = {
  [LoanStatus.REQUESTED]: [
    LoanStatus.APPROVED,
    LoanStatus.REJECTED,
    LoanStatus.CANCELLED,
  ],
  [LoanStatus.APPROVED]: [LoanStatus.ACTIVE],
  [LoanStatus.ACTIVE]: [LoanStatus.CLOSED],
  [LoanStatus.REJECTED]: [],
  [LoanStatus.CLOSED]: [],
  [LoanStatus.CANCELLED]: [],
};

export interface PayrollDeductionLine {
  loanId: string;
  type: LoanType;
  amount: number;
}

export interface PayrollDeductions {
  total: number;
  lines: PayrollDeductionLine[];
}

export interface PayrollRepaymentLine {
  loanId: string;
  amount: number;
}

/** A leaver's loan still owed, as the final settlement reads it. */
export interface SettlementOutstandingLoan {
  loanId: string;
  type: LoanType;
  outstanding: number;
}

/** What a committed settlement recovered, loan by loan. */
export interface SettlementRecoveryInput {
  tenantId: string;
  employeeId: string;
  settlementId: string;
  /** The settlement's month (the last working day's), for the repayment row. */
  month: number;
  year: number;
  lines: {
    loanId: string;
    /** What the settlement deducts for it; zero when nothing could be. */
    amount: number;
    /** The balance the settlement was computed against. */
    outstandingAtCompute: number;
  }[];
}

/** A loan a repayment write brought to zero, for telling its borrower. */
export interface ClosedLoan {
  id: string;
  employeeId: string;
  type: LoanType;
}

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private webhookDispatcher: WebhookDispatcherService,
  ) {}

  private isAdmin(role: UserRole) {
    return role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
  }

  /**
   * Prisma hands Decimal columns back as `Decimal` objects, which serialise to
   * strings over JSON and break arithmetic in the browser. Everything the API
   * returns is converted here, once, so no caller has to remember.
   */
  private serialize(loan: any) {
    if (!loan) return loan;
    return {
      ...loan,
      principal: Number(loan.principal),
      interestRate: Number(loan.interestRate),
      emiAmount: Number(loan.emiAmount),
      totalPayable: Number(loan.totalPayable),
      outstandingAmount: Number(loan.outstandingAmount),
      ...(loan.repayments
        ? {
            repayments: loan.repayments.map((r: any) => ({
              ...r,
              amount: Number(r.amount),
            })),
          }
        : {}),
    };
  }

  /**
   * Is `(month, year)` at or after the loan's first instalment?
   *
   * Used to tell "the loan has not started yet" (nothing due) apart from
   * "the tenure is over but a balance survives" (arrears).
   */
  private hasStarted(
    loan: { startMonth: number; startYear: number },
    month: number,
    year: number,
  ): boolean {
    return (
      year > loan.startYear ||
      (year === loan.startYear && month >= loan.startMonth)
    );
  }

  /** The schedule for a stored loan, from its own terms. */
  buildSchedule(loan: {
    principal: unknown;
    interestRate: unknown;
    tenureMonths: number;
    startMonth: number;
    startYear: number;
  }): ScheduleRow[] {
    return buildSchedule({
      principal: Number(loan.principal),
      interestRate: Number(loan.interestRate),
      tenureMonths: loan.tenureMonths,
      startMonth: loan.startMonth,
      startYear: loan.startYear,
    });
  }

  // ============================================
  // Employee-facing
  // ============================================

  async create(tenantId: string, employeeId: string, dto: CreateLoanDto) {
    const interestRate =
      dto.type === LoanType.SALARY_ADVANCE ? 0 : (dto.interestRate ?? 0);

    if (
      dto.type === LoanType.SALARY_ADVANCE &&
      dto.interestRate !== undefined &&
      dto.interestRate !== 0
    ) {
      throw new BadRequestException('A salary advance is interest free');
    }

    const maxTenure =
      dto.type === LoanType.SALARY_ADVANCE
        ? SALARY_ADVANCE_MAX_TENURE_MONTHS
        : LOAN_MAX_TENURE_MONTHS;

    if (dto.tenureMonths < 1 || dto.tenureMonths > maxTenure) {
      throw new BadRequestException(
        `Tenure must be between 1 and ${maxTenure} months for a ${dto.type === LoanType.SALARY_ADVANCE ? 'salary advance' : 'loan'}`,
      );
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { id: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const totalPayable = computeTotalPayable(
      dto.principal,
      interestRate,
      dto.tenureMonths,
    );
    const emiAmount = computeEmi(totalPayable, dto.tenureMonths);

    const loan = await this.prisma.employeeLoan.create({
      data: {
        tenantId,
        employeeId,
        type: dto.type,
        principal: dto.principal,
        interestRate,
        tenureMonths: dto.tenureMonths,
        emiAmount,
        totalPayable,
        // Nothing is owed until the money is disbursed, but the figure is
        // fixed at request time so the approver sees what they are signing.
        outstandingAmount: totalPayable,
        startMonth: dto.startMonth,
        startYear: dto.startYear,
        purpose: dto.purpose,
        status: LoanStatus.REQUESTED,
      },
      include: { employee: { select: borrowerSelect } },
    });

    await this.notificationsService.notifyByRole(
      tenantId,
      [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN],
      NotificationType.GENERAL,
      'Loan request submitted',
      `${loan.employee.firstName} ${loan.employee.lastName} requested ${
        dto.type === LoanType.SALARY_ADVANCE ? 'a salary advance' : 'a loan'
      }`,
      '/approvals/loans',
    );

    return this.serialize(loan);
  }

  async findMy(tenantId: string, employeeId: string, query: ListLoansDto) {
    const where: any = { tenantId, employeeId };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    return this.paginate(where, query);
  }

  async cancel(tenantId: string, id: string, employeeId: string) {
    const loan = await this.findOwnedOrFail(tenantId, id);

    if (loan.employeeId !== employeeId) {
      throw new ForbiddenException('You can only cancel your own request');
    }
    this.assertTransition(loan.status, LoanStatus.CANCELLED);

    const updated = await this.prisma.employeeLoan.update({
      where: { id },
      data: { status: LoanStatus.CANCELLED },
      include: { employee: { select: borrowerSelect } },
    });

    return this.serialize(updated);
  }

  // ============================================
  // HR / manager-facing
  // ============================================

  /**
   * The admin and manager list. A manager only ever sees the people who report
   * to them; without an employee record of their own there is nobody to scope
   * to, and an undefined `managerId` in the `where` would match the whole
   * tenant, so that case is refused rather than widened.
   */
  async findAll(
    tenantId: string,
    employeeId: string | undefined,
    role: UserRole,
    query: ListLoansDto,
  ) {
    const where: any = { tenantId };

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.employeeId) where.employeeId = query.employeeId;

    if (!this.isAdmin(role)) {
      if (!employeeId) {
        throw new ForbiddenException('User is not linked to an employee');
      }
      where.employee = { managerId: employeeId };
    }

    return this.paginate(where, query);
  }

  async findById(
    tenantId: string,
    id: string,
    employeeId: string | undefined,
    role: UserRole,
  ) {
    const loan = await this.prisma.employeeLoan.findFirst({
      where: { id, tenantId },
      include: {
        employee: { select: { ...borrowerSelect, managerId: true } },
        repayments: { orderBy: [{ year: 'asc' }, { month: 'asc' }] },
      },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    const isBorrower = loan.employeeId === employeeId;
    const isTheirManager =
      !!employeeId && loan.employee.managerId === employeeId;

    if (!isBorrower && !isTheirManager && !this.isAdmin(role)) {
      throw new ForbiddenException('You do not have access to this loan');
    }

    const schedule = this.buildSchedule(loan);
    return {
      ...this.serialize(loan),
      schedule,
      arrears: this.arrearsFor(loan, schedule),
    };
  }

  /**
   * The post-tenure instalment an ACTIVE loan is heading for, so the borrower
   * is told why an extra deduction will appear before it does. Null for a
   * loan payroll is not collecting.
   */
  private arrearsFor(loan: any, schedule: ScheduleRow[]): LoanArrears | null {
    if (loan.status !== LoanStatus.ACTIVE) return null;
    const now = new Date();
    return computeArrears({
      schedule,
      outstanding: Number(loan.outstandingAmount),
      emiAmount: Number(loan.emiAmount),
      payrollMonths: (loan.repayments ?? [])
        .filter((r: any) => r.source === RepaymentSource.PAYROLL)
        .map((r: any) => ({ month: r.month, year: r.year })),
      asOf: { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() },
    });
  }

  async approve(tenantId: string, id: string, approvedById: string) {
    const loan = await this.findOwnedOrFail(tenantId, id);
    this.assertTransition(loan.status, LoanStatus.APPROVED);

    const updated = await this.prisma.employeeLoan.update({
      where: { id },
      data: {
        status: LoanStatus.APPROVED,
        approvedById,
        approvedAt: new Date(),
        rejectionReason: null,
      },
      include: { employee: { select: borrowerSelect } },
    });

    await this.notificationsService.notifyEmployee(
      tenantId,
      loan.employeeId,
      NotificationType.LOAN_APPROVED,
      'Loan approved',
      `Your request for ₹${Number(loan.principal)} was approved`,
      '/loans',
    );

    // The approval has committed, so tell subscribed webhooks. Not awaited on
    // purpose, as leave does it: dispatch never rejects, but it retries a slow
    // endpoint with backoff, and an HR click must not wait on a customer's
    // server. The `.catch` is belt and braces should that contract ever slip.
    // Ids and terms only — no purpose text or borrower name leaves the tenant.
    void this.webhookDispatcher
      .dispatch(tenantId, 'loan.approved', {
        loanId: updated.id,
        employeeId: updated.employeeId,
        type: updated.type,
        amount: Number(updated.principal),
        emi: Number(updated.emiAmount),
        tenureMonths: updated.tenureMonths,
        approvedAt: updated.approvedAt
          ? new Date(updated.approvedAt).toISOString()
          : null,
      })
      .catch(() => undefined);

    return this.serialize(updated);
  }

  async reject(tenantId: string, id: string, dto: RejectLoanDto) {
    const loan = await this.findOwnedOrFail(tenantId, id);
    this.assertTransition(loan.status, LoanStatus.REJECTED);

    const updated = await this.prisma.employeeLoan.update({
      where: { id },
      data: { status: LoanStatus.REJECTED, rejectionReason: dto.reason },
      include: { employee: { select: borrowerSelect } },
    });

    await this.notificationsService.notifyEmployee(
      tenantId,
      loan.employeeId,
      NotificationType.LOAN_REJECTED,
      'Loan rejected',
      dto.reason,
      '/loans',
    );

    return this.serialize(updated);
  }

  /** Money out of the door: the loan becomes ACTIVE and payroll starts deducting. */
  async disburse(tenantId: string, id: string) {
    const loan = await this.findOwnedOrFail(tenantId, id);
    this.assertTransition(loan.status, LoanStatus.ACTIVE);

    const updated = await this.prisma.employeeLoan.update({
      where: { id },
      data: { status: LoanStatus.ACTIVE, disbursedAt: new Date() },
      include: { employee: { select: borrowerSelect } },
    });

    await this.notificationsService.notifyEmployee(
      tenantId,
      loan.employeeId,
      NotificationType.GENERAL,
      'Loan disbursed',
      `₹${Number(loan.principal)} has been disbursed. Repayment starts from ${loan.startMonth}/${loan.startYear}.`,
      '/loans',
    );

    return this.serialize(updated);
  }

  /**
   * A repayment made outside payroll.
   *
   * The duplicate check, the row and the balance decrement all run in one
   * interactive transaction. Split across separate calls, a repayment could be
   * written and then the decrement lost, leaving a loan that has been paid but
   * still shows the full balance.
   */
  async recordRepayment(tenantId: string, id: string, dto: RecordRepaymentDto) {
    const loan = await this.findOwnedOrFail(tenantId, id);

    if (loan.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException(
        'Repayments can only be recorded against an active loan',
      );
    }

    const outstanding = Number(loan.outstandingAmount);
    if (dto.amount > outstanding) {
      throw new BadRequestException(
        `Amount exceeds the outstanding balance of ${outstanding}`,
      );
    }

    const repayment = await this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.loanRepayment.findFirst({
        where: {
          tenantId,
          loanId: id,
          month: dto.month,
          year: dto.year,
          source: RepaymentSource.MANUAL,
        },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(
          'A manual repayment is already recorded for that month',
        );
      }

      const created = await tx.loanRepayment.create({
        data: {
          tenantId,
          loanId: id,
          month: dto.month,
          year: dto.year,
          amount: dto.amount,
          source: RepaymentSource.MANUAL,
          note: dto.note,
        },
      });

      const { applied } = await this.applyRepayment(
        tx,
        tenantId,
        loan,
        dto.amount,
      );
      if (!applied) {
        // Somebody else moved the balance between the read and the write.
        // Rolling back is the only safe answer: the alternative is a
        // repayment row whose decrement silently went missing.
        throw new ConflictException(
          'The loan balance changed while the repayment was being recorded. Try again.',
        );
      }

      return created;
    });

    return { ...repayment, amount: Number(repayment.amount) };
  }

  // ============================================
  // Payroll contract
  // ============================================

  /**
   * What payroll should deduct for this employee this month.
   *
   * Only loans payroll is collecting count, and only months the schedule
   * covers (or arrears past it). A re-run of the same month proposes the same
   * instalment again rather than nothing: it reads the balance as if that
   * month's own payroll rows were reversed, because the caller reverses and
   * re-records them in one transaction — `recordPayrollRepayments`'s own
   * existing-row check is what stops a double write.
   */
  async getPayrollDeductions(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
  ): Promise<PayrollDeductions> {
    // Read as if this month's payroll repayments had already been reversed.
    //
    // Every caller (process, recompute) reverses them and re-records inside
    // one write transaction, *after* this calculation has run outside it —
    // the calculation stays outside so that transaction does not hold row
    // locks for the length of every employee's computation. So the figure
    // wanted here is the balance that will stand once the reversal has been
    // applied: the stored balance plus this month's own payroll row, and a
    // loan that row closed counts as open again. There is at most one payroll
    // run per tenant and month, so those rows can only belong to the run
    // being (re)computed.
    const thisMonthsPayroll = { month, year, source: RepaymentSource.PAYROLL };
    const loans = await this.prisma.employeeLoan.findMany({
      where: {
        tenantId,
        employeeId,
        OR: [
          { status: LoanStatus.ACTIVE },
          {
            status: LoanStatus.CLOSED,
            repayments: { some: thisMonthsPayroll },
          },
        ],
      },
      include: {
        repayments: {
          where: thisMonthsPayroll,
          select: { id: true, amount: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const lines: PayrollDeductionLine[] = [];

    for (const loan of loans) {
      const reversed = (loan.repayments ?? []).reduce(
        (sum: number, r: { amount?: unknown }) => sum + Number(r.amount ?? 0),
        0,
      );
      const outstanding = round2(Number(loan.outstandingAmount) + reversed);
      if (!(outstanding > 0)) continue;

      const row = this.buildSchedule(loan).find(
        (r) => r.month === month && r.year === year,
      );

      // A month with no schedule row is either before the loan starts —
      // nothing is due yet — or past the tenure with a balance still
      // standing, which means an earlier instalment was short (the net-pay
      // clamp in payroll reduces an EMI rather than deferring it). Carry the
      // residual forward as arrears instead of abandoning it: without this a
      // loan clamped in month 3 of 6 finishes ACTIVE with a balance nothing
      // will ever collect.
      if (!row && !this.hasStarted(loan, month, year)) continue;

      // Never deduct more than is owed: the final instalment can exceed the
      // balance when earlier repayments were made by hand, and an arrears
      // catch-up is bounded by the balance by definition.
      const due = row ? row.emi : Number(loan.emiAmount);
      const amount = round2(Math.min(due, outstanding));
      if (amount <= 0) continue;

      lines.push({ loanId: loan.id, type: loan.type, amount });
    }

    return {
      total: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
      lines,
    };
  }

  /**
   * Write the instalments payroll actually deducted, decrement each loan and
   * close the ones that reach zero.
   *
   * The rows are written in one transaction with the balance updates: a
   * half-written set would leave a loan looking either unpaid or overpaid.
   *
   * Pass `tx` to run inside the caller's transaction — payroll does, so the
   * reversal of a previous attempt, the replacement payslips and these rows
   * commit or roll back together. With a `tx` the loans are read through it
   * (so they reflect that transaction's own reversal) and nobody is notified,
   * because nothing has committed yet: the loans it closed are returned and
   * the caller hands them to `notifyLoansClosed` after its commit. Without a
   * `tx` this opens its own transaction and notifies itself, as before.
   */
  async recordPayrollRepayments(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
    payslipId: string,
    lines: PayrollRepaymentLine[],
    tx?: Prisma.TransactionClient,
  ): Promise<ClosedLoan[]> {
    if (!lines || lines.length === 0) return [];

    const reader: any = tx ?? this.prisma;
    const loanIds = lines.map((l) => l.loanId);
    const loans = await reader.employeeLoan.findMany({
      where: {
        id: { in: loanIds },
        tenantId,
        employeeId,
        status: LoanStatus.ACTIVE,
      },
    });

    const byId = new Map<string, any>(loans.map((l: any) => [l.id, l]));
    const closed: ClosedLoan[] = [];

    const write = async (tx: any) => {
      for (const line of lines) {
        const loan = byId.get(line.loanId);
        // A loan that is not this employee's, not in this tenant or no longer
        // active is skipped rather than throwing: payroll has already paid the
        // payslip and must not be rolled back by a stale deduction line.
        if (!loan) continue;
        if (line.amount <= 0) continue;

        // Payroll retries. Without this read the second run collides with the
        // unique (loanId, month, year, source) index, and because everything
        // here is one transaction that collision would abort the *whole* set
        // of repayments, not just the duplicate line. A line already written
        // is skipped entirely: no row, no second decrement.
        const existing = await tx.loanRepayment.findFirst({
          where: {
            tenantId,
            loanId: loan.id,
            month,
            year,
            source: RepaymentSource.PAYROLL,
          },
          select: { id: true },
        });
        if (existing) continue;

        const amount = round2(
          Math.min(line.amount, Number(loan.outstandingAmount)),
        );
        if (amount <= 0) continue;

        await tx.loanRepayment.create({
          data: {
            tenantId,
            loanId: loan.id,
            month,
            year,
            amount,
            source: RepaymentSource.PAYROLL,
            payslipId,
          },
        });

        const { applied, settled } = await this.applyRepayment(
          tx,
          tenantId,
          loan,
          amount,
        );
        if (!applied) {
          throw new ConflictException(
            `The balance of loan ${loan.id} changed while payroll repayments were being recorded. Try again.`,
          );
        }
        if (settled) {
          closed.push({ id: loan.id, employeeId: loan.employeeId, type: loan.type });
        }
      }
    };

    if (tx) {
      await write(tx);
      return closed;
    }

    await this.prisma.$transaction(write);
    await this.notifyLoansClosed(tenantId, closed);
    return closed;
  }

  // ============================================
  // Final settlement contract
  // ============================================

  /**
   * What a leaver still owes, loan by loan, oldest first — the order the
   * settlement recovers them in, as payroll services them.
   */
  async getOutstandingForSettlement(
    tenantId: string,
    employeeId: string,
  ): Promise<SettlementOutstandingLoan[]> {
    const loans = await this.prisma.employeeLoan.findMany({
      where: { tenantId, employeeId, status: LoanStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
    });

    return loans
      .map((loan: any) => ({
        loanId: loan.id,
        type: loan.type,
        outstanding: round2(Number(loan.outstandingAmount)),
      }))
      .filter((loan) => loan.outstanding > 0);
  }

  /**
   * Write the repayments a final settlement recovered, inside the caller's
   * transaction — the one that moves the settlement to the state where its
   * figures are committed — so the settlement cannot be committed without
   * its recoveries, nor the recoveries without the settlement.
   *
   * The settlement was computed against the balances as they then stood. It
   * is committed only if they still stand: a payroll EMI taken since, a
   * manual repayment, or a loan disbursed after the compute would each make
   * the settlement's deduction wrong, and a settlement that deducts one
   * figure while the loan is credited with another is the failure this
   * exists to prevent. Any mismatch is a 409 asking for a recompute.
   *
   * Idempotent per loan: a loan that already has a SETTLEMENT row for the
   * settlement's month is skipped entirely (no row, no second decrement) and
   * left out of the balance check, so re-running cannot double-record.
   *
   * Nobody is notified from here — the caller's transaction has not
   * committed. The loans closed are returned for `notifyLoansClosed`.
   */
  async recordSettlementRepayments(
    tx: Prisma.TransactionClient,
    input: SettlementRecoveryInput,
  ): Promise<{ recorded: PayrollRepaymentLine[]; closed: ClosedLoan[] }> {
    const client: any = tx;
    const { tenantId, employeeId, settlementId, month, year } = input;
    const lines = input.lines ?? [];

    const alreadyRecorded = new Set<string>();
    for (const line of lines) {
      const existing = await client.loanRepayment.findFirst({
        where: {
          tenantId,
          loanId: line.loanId,
          month,
          year,
          source: RepaymentSource.SETTLEMENT,
        },
        select: { id: true },
      });
      if (existing) alreadyRecorded.add(line.loanId);
    }
    const pending = lines.filter((l) => !alreadyRecorded.has(l.loanId));

    const active: any[] = await client.employeeLoan.findMany({
      where: { tenantId, employeeId, status: LoanStatus.ACTIVE },
    });
    const owed = new Map<string, any>(
      active
        .filter(
          (loan) =>
            Number(loan.outstandingAmount) > 0 && !alreadyRecorded.has(loan.id),
        )
        .map((loan) => [loan.id, loan]),
    );

    const stale = () =>
      new ConflictException(
        "The leaver's loan balances have changed since this settlement was computed. Recompute it before approving.",
      );

    for (const line of pending) {
      const loan = owed.get(line.loanId);
      if (!loan) throw stale();
      if (round2(Number(loan.outstandingAmount)) !== round2(line.outstandingAtCompute)) {
        throw stale();
      }
    }
    const covered = new Set(pending.map((l) => l.loanId));
    for (const loanId of owed.keys()) {
      if (!covered.has(loanId)) throw stale();
    }

    const recorded: PayrollRepaymentLine[] = [];
    const closed: ClosedLoan[] = [];

    for (const line of pending) {
      const loan = owed.get(line.loanId);
      const amount = round2(
        Math.min(line.amount, Number(loan.outstandingAmount)),
      );
      if (!(amount > 0)) continue;

      await client.loanRepayment.create({
        data: {
          tenantId,
          loanId: loan.id,
          month,
          year,
          amount,
          source: RepaymentSource.SETTLEMENT,
          note: `Recovered from final settlement ${settlementId}`,
        },
      });

      const { applied, settled } = await this.applyRepayment(
        client,
        tenantId,
        loan,
        amount,
      );
      if (!applied) throw stale();

      recorded.push({ loanId: loan.id, amount });
      if (settled) {
        closed.push({ id: loan.id, employeeId: loan.employeeId, type: loan.type });
      }
    }

    return { recorded, closed };
  }

  /**
   * Tell each borrower their loan has been fully repaid.
   *
   * Separate from the write so a caller that recorded the repayments inside
   * its own transaction can announce them only once that transaction has
   * committed — never for a closure that might still roll back.
   */
  async notifyLoansClosed(
    tenantId: string,
    loans: ClosedLoan[] | null | undefined,
  ): Promise<void> {
    for (const loan of loans ?? []) {
      await this.notificationsService.notifyEmployee(
        tenantId,
        loan.employeeId,
        NotificationType.GENERAL,
        'Loan closed',
        `Your ${loan.type === LoanType.SALARY_ADVANCE ? 'salary advance' : 'loan'} has been fully repaid`,
        '/loans',
      );
    }
  }

  /**
   * Undo the payroll-sourced repayments recorded for a month, putting each
   * loan back where it stood before them.
   *
   * A payroll run can be reset or recomputed, which throws its payslips away
   * and regenerates them. The repayment rows the previous attempt wrote would
   * otherwise outlive the payslip that caused them, and two things go wrong:
   * `recordPayrollRepayments` skips a loan that already has a row for the
   * month, so the regenerated payslip's instalment would never be recorded;
   * and where the recompute clamps differently, the surviving row credits a
   * figure the new payslip never deducted.
   *
   * Reversing is safe to call when there is nothing to reverse, and there is
   * at most one payroll run per tenant and month, so the month alone
   * identifies the rows this run owns.
   *
   * Pass `tx` to reverse inside the caller's transaction. Payroll does, so the
   * reversal commits only together with the replacement payslips and the
   * re-recorded repayments: a failure in between rolls the reversal back too,
   * instead of leaving every balance high until the next good run.
   */
  async clearPayrollRepayments(
    tenantId: string,
    month: number,
    year: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const reader: any = tx ?? this.prisma;
    const rows = await reader.loanRepayment.findMany({
      where: { tenantId, month, year, source: RepaymentSource.PAYROLL },
      include: {
        loan: { select: { id: true, outstandingAmount: true, status: true } },
      },
    });
    if (!rows || rows.length === 0) return;

    const reverse = async (tx: any) => {
      for (const row of rows as any[]) {
        await tx.loanRepayment.delete({ where: { id: row.id } });

        const current = Number(row.loan.outstandingAmount);
        const restored = round2(current + Number(row.amount));

        // Guarded on the balance that was read, exactly as applyRepayment is:
        // a manual repayment landing at the same moment must not be erased by
        // this reversal writing a figure computed before it.
        const result = await tx.employeeLoan.updateMany({
          where: { id: row.loanId, tenantId, outstandingAmount: current },
          data: {
            outstandingAmount: restored,
            // A loan this repayment closed is owed money again, so it goes
            // back to ACTIVE or payroll would never look at it a second time.
            ...(row.loan.status === LoanStatus.CLOSED
              ? { status: LoanStatus.ACTIVE, closedAt: null }
              : {}),
          },
        });
        if ((result?.count ?? 0) === 0) {
          throw new ConflictException(
            `The balance of loan ${row.loanId} changed while its payroll repayment was being reversed. Try again.`,
          );
        }
      }
    };

    if (tx) {
      await reverse(tx);
      return;
    }
    await this.prisma.$transaction(reverse);
  }

  // ============================================
  // Internals
  // ============================================

  /**
   * Write the new balance, closing the loan when nothing is left. Shared by
   * the manual and payroll paths so "fully repaid" means the same thing in
   * both, and takes the client explicitly so it can run inside a transaction.
   *
   * The write is a conditional `updateMany` matched on the balance that was
   * read, not a plain `update`. Two repayments landing at once would otherwise
   * both compute `outstanding - amount` from the same starting figure and the
   * second would overwrite the first, wiping out a real repayment. When the
   * balance has moved, `count` comes back 0 and the caller decides — both
   * callers roll the transaction back.
   */
  private async applyRepayment(
    client: any,
    tenantId: string,
    loan: any,
    amount: number,
  ): Promise<{ applied: boolean; settled: boolean }> {
    const current = Number(loan.outstandingAmount);
    const remaining = round2(current - amount);
    const settled = remaining <= 0;

    const result = await client.employeeLoan.updateMany({
      where: { id: loan.id, tenantId, outstandingAmount: current },
      data: {
        outstandingAmount: settled ? 0 : remaining,
        ...(settled
          ? { status: LoanStatus.CLOSED, closedAt: new Date() }
          : {}),
      },
    });

    return { applied: (result?.count ?? 0) > 0, settled };
  }

  private async findOwnedOrFail(tenantId: string, id: string) {
    const loan = await this.prisma.employeeLoan.findFirst({
      where: { id, tenantId },
    });
    if (!loan) {
      throw new NotFoundException('Loan not found');
    }
    return loan;
  }

  private assertTransition(from: LoanStatus, to: LoanStatus) {
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(
        `A loan in status ${from} cannot move to ${to}`,
      );
    }
  }

  private async paginate(where: any, query: ListLoansDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.employeeLoan.findMany({
        where,
        include: { employee: { select: borrowerSelect } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.employeeLoan.count({ where }),
    ]);

    return {
      data: data.map((loan: any) => this.serialize(loan)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
