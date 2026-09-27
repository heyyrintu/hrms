import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OneTimePaymentKind,
  PayrollRunStatus,
  PayrollRunType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { OneTimePaymentView } from '../payroll-depth.types';
import { isOneTimeEarning } from '../payroll-calculation.service';
import { EMPLOYEE_REF_SELECT, iso, num, toEmployeeRef } from './views';

export interface CreateOneTimePaymentInput {
  employeeId: string;
  kind: OneTimePaymentKind;
  name: string;
  amount: number;
  /** Earnings only; ignored (stored false) for RECOVERY / OTHER_DEDUCTION. */
  taxable?: boolean;
  note?: string | null;
}

/** At most this many payments per employee per run (spec C2). */
export const MAX_PAYMENTS_PER_EMPLOYEE = 50;

const EDITABLE: PayrollRunStatus[] = [PayrollRunStatus.DRAFT, PayrollRunStatus.COMPUTED];

type PaymentRow = Prisma.PayrollOneTimePaymentGetPayload<{
  include: { employee: { select: typeof EMPLOYEE_REF_SELECT } };
}>;

function toView(row: PaymentRow): OneTimePaymentView {
  return {
    id: row.id,
    payrollRunId: row.payrollRunId,
    employee: toEmployeeRef(row.employee),
    kind: row.kind,
    isEarning: isOneTimeEarning(row.kind),
    name: row.name,
    amount: num(row.amount),
    taxable: row.taxable,
    note: row.note,
    createdAt: iso(row.createdAt) as string,
  };
}

/**
 * WS-C1 (Keka wave C, spec C2): bonus / incentive / deduction lines attached
 * to a DRAFT or COMPUTED run. Adding or deleting on a COMPUTED run flags it
 * `needsRecompute`, in the same transaction and guarded on the status read,
 * so a recompute that claimed the run meanwhile makes this a 409 instead of a
 * payment the run silently never paid.
 */
@Injectable()
export class OneTimePaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForRun(tenantId: string, runId: string): Promise<OneTimePaymentView[]> {
    await this.findRun(tenantId, runId);
    const rows = await this.prisma.payrollOneTimePayment.findMany({
      where: { tenantId, payrollRunId: runId },
      include: { employee: { select: EMPLOYEE_REF_SELECT } },
      orderBy: [{ createdAt: 'asc' }],
    });
    return (rows ?? []).map(toView);
  }

  async create(
    actor: AuthenticatedUser,
    runId: string,
    input: CreateOneTimePaymentInput,
  ): Promise<OneTimePaymentView> {
    const tenantId = actor.tenantId;
    const name = (input.name ?? '').trim();
    if (name.length < 1 || name.length > 100) {
      throw new BadRequestException('Name must be 1 to 100 characters');
    }
    const amount = new Prisma.Decimal(input.amount ?? 0);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }
    if (amount.decimalPlaces() > 2) {
      throw new BadRequestException('Amount can have at most two decimals');
    }

    const run = await this.findRun(tenantId, runId);
    this.assertEditable(run.status);

    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, tenantId },
      select: { id: true, status: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    if (run.runType === PayrollRunType.OFF_CYCLE) {
      if (!run.scopeEmployeeIds.includes(employee.id)) {
        throw new BadRequestException('The employee is not in the scope of this off-cycle run');
      }
    } else {
      if (employee.status !== 'ACTIVE') {
        throw new BadRequestException('Only an active employee can be paid in a regular run');
      }
      // A regular run writes no payslip for an employee without a salary
      // assignment, so the payment would never be paid.
      const salary = await this.prisma.employeeSalary.findFirst({
        where: {
          tenantId,
          employeeId: employee.id,
          isActive: true,
          effectiveFrom: { lte: new Date(run.year, run.month - 1, 28) },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: new Date(run.year, run.month - 1, 1) } },
          ],
        },
        select: { id: true },
      });
      if (!salary) {
        throw new BadRequestException(
          'The employee has no salary assignment for this month, so a regular run would not pay them; use an off-cycle run',
        );
      }
    }

    const existing = await this.prisma.payrollOneTimePayment.count({
      where: { tenantId, payrollRunId: runId, employeeId: employee.id },
    });
    if (existing >= MAX_PAYMENTS_PER_EMPLOYEE) {
      throw new BadRequestException(
        `At most ${MAX_PAYMENTS_PER_EMPLOYEE} one-time payments per employee per run`,
      );
    }

    const earning = isOneTimeEarning(input.kind);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payrollOneTimePayment.create({
        data: {
          tenantId,
          payrollRunId: runId,
          employeeId: employee.id,
          kind: input.kind,
          name,
          amount,
          // Deductions are post-tax: stored false whatever was sent.
          taxable: earning ? input.taxable ?? true : false,
          note: input.note?.trim() || null,
          createdById: actor.userId,
        },
        include: { employee: { select: EMPLOYEE_REF_SELECT } },
      });
      await this.touchRun(tx, tenantId, run.id, run.status);
      return created;
    });
    return toView(row);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const payment = await this.prisma.payrollOneTimePayment.findFirst({
      where: { id, tenantId },
      include: { payrollRun: { select: { id: true, status: true } } },
    });
    if (!payment) throw new NotFoundException('One-time payment not found');
    this.assertEditable(payment.payrollRun.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollOneTimePayment.deleteMany({ where: { id, tenantId } });
      await this.touchRun(tx, tenantId, payment.payrollRun.id, payment.payrollRun.status);
    });
  }

  /** The run's payments, for the payroll computation. */
  forRun(tenantId: string, runId: string) {
    return this.prisma.payrollOneTimePayment.findMany({
      where: { tenantId, payrollRunId: runId },
      select: { id: true, employeeId: true, kind: true, name: true, amount: true, taxable: true },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  private async findRun(tenantId: string, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, tenantId },
      select: {
        id: true,
        month: true,
        year: true,
        status: true,
        runType: true,
        sequence: true,
        scopeEmployeeIds: true,
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  private assertEditable(status: PayrollRunStatus) {
    if (status === PayrollRunStatus.PROCESSING) {
      throw new BadRequestException('The run is being processed; try again when it is computed');
    }
    if (!EDITABLE.includes(status)) {
      throw new BadRequestException(
        `One-time payments can only change on a DRAFT or COMPUTED run; this run is ${status}`,
      );
    }
  }

  /**
   * Guarded on the status read: COMPUTED is flagged for recompute; DRAFT is
   * only checked (it computes the payment when processed).
   */
  private async touchRun(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runId: string,
    status: PayrollRunStatus,
  ) {
    const res = await tx.payrollRun.updateMany({
      where: { id: runId, tenantId, status },
      data: { needsRecompute: status === PayrollRunStatus.COMPUTED },
    });
    if (!res || res.count !== 1) {
      throw new ConflictException('The payroll run changed meanwhile; reload it and try again');
    }
  }
}
