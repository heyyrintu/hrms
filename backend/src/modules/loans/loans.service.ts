import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LoanStatus,
  LoanType,
  NotificationType,
  RepaymentSource,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildSchedule,
  computeEmi,
  computeTotalPayable,
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

@Injectable()
export class LoansService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
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

    return {
      ...this.serialize(loan),
      schedule: this.buildSchedule(loan),
    };
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

  /** A repayment made outside payroll. */
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

    const existing = await this.prisma.loanRepayment.findFirst({
      where: {
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

    const repayment = await this.prisma.loanRepayment.create({
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

    await this.applyRepayment(
      this.prisma,
      tenantId,
      loan,
      round2(outstanding - dto.amount),
    );

    return { ...repayment, amount: Number(repayment.amount) };
  }

  // ============================================
  // Payroll contract
  // ============================================

  /**
   * What payroll should deduct for this employee this month.
   *
   * Only ACTIVE loans count, only months the schedule actually covers, and
   * only where payroll has not already taken an instalment for that month —
   * so a re-run of the same payroll month deducts nothing a second time.
   */
  async getPayrollDeductions(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
  ): Promise<PayrollDeductions> {
    const loans = await this.prisma.employeeLoan.findMany({
      where: { tenantId, employeeId, status: LoanStatus.ACTIVE },
      include: {
        repayments: {
          where: { month, year, source: RepaymentSource.PAYROLL },
          select: { id: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const lines: PayrollDeductionLine[] = [];

    for (const loan of loans) {
      if (loan.repayments && loan.repayments.length > 0) continue;

      const row = this.buildSchedule(loan).find(
        (r) => r.month === month && r.year === year,
      );
      if (!row) continue;

      // The final instalment can exceed what is left when earlier repayments
      // were made by hand, so never deduct more than is owed.
      const amount = round2(
        Math.min(row.emi, Number(loan.outstandingAmount)),
      );
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
   * Called from the payroll run after a payslip is finalised, so the rows are
   * written in one transaction with the balance updates: a half-written set
   * would leave a loan looking either unpaid or overpaid.
   */
  async recordPayrollRepayments(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
    payslipId: string,
    lines: PayrollRepaymentLine[],
  ): Promise<void> {
    if (!lines || lines.length === 0) return;

    const loanIds = lines.map((l) => l.loanId);
    const loans = await this.prisma.employeeLoan.findMany({
      where: {
        id: { in: loanIds },
        tenantId,
        employeeId,
        status: LoanStatus.ACTIVE,
      },
    });

    const byId = new Map(loans.map((l: any) => [l.id, l]));
    const closed: any[] = [];

    await this.prisma.$transaction(async (tx: any) => {
      for (const line of lines) {
        const loan = byId.get(line.loanId);
        // A loan that is not this employee's, not in this tenant or no longer
        // active is skipped rather than throwing: payroll has already paid the
        // payslip and must not be rolled back by a stale deduction line.
        if (!loan) continue;
        if (line.amount <= 0) continue;

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

        const remaining = round2(Number(loan.outstandingAmount) - amount);
        await this.applyRepayment(tx, tenantId, loan, remaining);
        if (remaining <= 0) closed.push(loan);
      }
    });

    for (const loan of closed) {
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

  // ============================================
  // Internals
  // ============================================

  /**
   * Write the new balance, closing the loan when nothing is left. Shared by
   * the manual and payroll paths so "fully repaid" means the same thing in
   * both, and takes the client explicitly so it can run inside a transaction.
   */
  private async applyRepayment(
    client: any,
    tenantId: string,
    loan: any,
    remaining: number,
  ) {
    const settled = remaining <= 0;

    await client.employeeLoan.update({
      where: { id: loan.id },
      data: {
        outstandingAmount: settled ? 0 : remaining,
        ...(settled
          ? { status: LoanStatus.CLOSED, closedAt: new Date() }
          : {}),
      },
    });

    return settled;
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
