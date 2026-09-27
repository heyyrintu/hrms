import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollRunStatus,
  PayrollRunType,
  Prisma,
  SalaryArrearStatus,
  SalaryHoldStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ArrearDetectionResult,
  ArrearLineView,
  SalaryArrearView,
} from '../payroll-depth.types';
import { PayrollCalculationService } from '../payroll-calculation.service';
import { classifyPayslipLine } from '../payroll-lines.types';
import { financialYearOf } from '../statutory/statutory.service';
import { isPrismaError } from '../../../common/utils/prisma-errors';
import {
  EMPLOYEE_REF_SELECT,
  RUN_REF_SELECT,
  compareMonth,
  iso,
  num,
  toEmployeeRef,
  toRunRef,
} from './views';

export interface SalaryArrearQuery {
  status?: SalaryArrearStatus;
  employeeId?: string;
}

/** The arrear line for base pay (the BASIC GL key's payslip counterpart). */
export const ARREAR_BASIC_LINE = 'Basic';

const ZERO = new Decimal(0);

function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function dec(value: unknown): Decimal {
  if (value === null || value === undefined) return ZERO;
  return new Decimal(value as Decimal.Value);
}

const VIEW_INCLUDE = {
  employee: { select: EMPLOYEE_REF_SELECT },
  payrollRun: { select: RUN_REF_SELECT },
} as const;

type ArrearRow = Prisma.SalaryArrearGetPayload<{ include: typeof VIEW_INCLUDE }>;

function readLines(value: unknown): ArrearLineView[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((l) => l && typeof l.name === 'string')
    .map((l) => ({
      name: l.name,
      original: Number(l.original ?? 0),
      revised: Number(l.revised ?? 0),
      delta: Number(l.delta ?? 0),
    }));
}

function toView(row: ArrearRow): SalaryArrearView {
  return {
    id: row.id,
    employee: toEmployeeRef(row.employee),
    employeeSalaryId: row.employeeSalaryId,
    forMonth: row.forMonth,
    forYear: row.forYear,
    financialYear: row.financialYear,
    originalAmount: num(row.originalAmount),
    revisedAmount: num(row.revisedAmount),
    amount: num(row.amount),
    pfWagesDelta: num(row.pfWagesDelta),
    lines: readLines(row.lines),
    status: row.status,
    payrollRun: row.payrollRun ? toRunRef(row.payrollRun) : null,
    createdAt: iso(row.createdAt) as string,
  };
}

/** Whether a salary row applies to a month (the payroll lookup's day-28 rule). */
function appliesTo(
  salary: { effectiveFrom: Date; effectiveTo: Date | null },
  month: number,
  year: number,
): boolean {
  const from = new Date(salary.effectiveFrom).getTime();
  if (from > Date.UTC(year, month - 1, 28, 23, 59, 59)) return false;
  if (salary.effectiveTo && new Date(salary.effectiveTo).getTime() < Date.UTC(year, month - 1, 1)) {
    return false;
  }
  return true;
}

/**
 * WS-C1 (Keka wave C, spec C1): arrears from backdated salary revisions.
 *
 * A revision is an active EmployeeSalary row that applies to a month already
 * paid by an APPROVED or PAID run (regular, or off-cycle with salary; not a voided
 * hold) **and was entered (or changed) after
 * that month's payslip was computed** — a payslip computed after the row
 * existed already used it. For each such month the month's regular earnings
 * are revalued with the row (`calculateRegularEarnings`, prorated with that
 * month's attendance) and compared with what was paid (basic + COMPONENT
 * earning lines, OT excluded) plus every non-cancelled arrear already recorded
 * for the month; a non-zero difference is one SalaryArrear.
 *
 * Idempotent through the (employeeSalaryId, forMonth, forYear) key: any
 * existing row for the key — including a CANCELLED one, which HR cancelled on
 * purpose — is left alone.
 */
@Injectable()
export class SalaryArrearsService {
  private readonly logger = new Logger(SalaryArrearsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: PayrollCalculationService,
  ) {}

  async list(tenantId: string, query: SalaryArrearQuery): Promise<SalaryArrearView[]> {
    const rows = await this.prisma.salaryArrear.findMany({
      where: {
        tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      },
      include: VIEW_INCLUDE,
      orderBy: [{ forYear: 'desc' }, { forMonth: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    return (rows ?? []).map(toView);
  }

  /** Idempotent: writes one SalaryArrear per month a revision changes. */
  async detectForEmployee(tenantId: string, employeeId: string): Promise<ArrearDetectionResult> {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const paidSlips =
      (await this.prisma.payslip.findMany({
        where: {
          tenantId,
          employeeId,
          // Every month whose salary was paid: by the regular run, or by an
          // off-cycle run with salary (a joiner the regular run missed). A
          // salary held and then voided was never paid, so nothing is owed
          // on it; one still HELD or RELEASED is paid (later) and counts.
          payrollRun: {
            status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
            OR: [
              { runType: PayrollRunType.REGULAR },
              { runType: PayrollRunType.OFF_CYCLE, includeSalary: true },
            ],
            holds: { none: { employeeId, status: SalaryHoldStatus.VOIDED } },
          },
        },
        select: {
          id: true,
          basePay: true,
          earnings: true,
          createdAt: true,
          payrollRun: { select: { month: true, year: true } },
        },
      })) ?? [];
    if (paidSlips.length === 0) return { created: 0, arrears: [] };

    const latest = paidSlips.reduce((a, b) => (compareMonth(a.payrollRun, b.payrollRun) >= 0 ? a : b))
      .payrollRun;

    const revisions =
      (await this.prisma.employeeSalary.findMany({
        where: {
          tenantId,
          employeeId,
          isActive: true,
          effectiveFrom: { lte: new Date(Date.UTC(latest.year, latest.month - 1, 28, 23, 59, 59)) },
        },
        select: { id: true, effectiveFrom: true, effectiveTo: true, createdAt: true, updatedAt: true },
      })) ?? [];
    if (revisions.length === 0) return { created: 0, arrears: [] };

    const existing =
      (await this.prisma.salaryArrear.findMany({
        where: { tenantId, employeeId },
        select: {
          id: true,
          employeeSalaryId: true,
          forMonth: true,
          forYear: true,
          amount: true,
          status: true,
          lines: true,
        },
      })) ?? [];

    const created: SalaryArrearView[] = [];
    const ordered = [...paidSlips].sort((a, b) => compareMonth(a.payrollRun, b.payrollRun));

    for (const revision of revisions) {
      const enteredAt = new Date(revision.updatedAt ?? revision.createdAt).getTime();

      for (const slip of ordered) {
        const { month, year } = slip.payrollRun;
        if (!appliesTo(revision, month, year)) continue;
        // Computed after the revision existed: it already used it.
        if (new Date(slip.createdAt).getTime() >= enteredAt) continue;

        const sameKey = existing.find(
          (a) => a.employeeSalaryId === revision.id && a.forMonth === month && a.forYear === year,
        );
        if (sameKey) continue;

        const revised = await this.calculation.calculateRegularEarnings(
          tenantId,
          employeeId,
          month,
          year,
          revision.id,
        );
        if (!revised) continue;

        // What was paid for the month: the payslip's regular earnings plus
        // arrears other revisions already recorded for it.
        const original = new Map<string, Decimal>();
        const add = (name: string, amount: Decimal) =>
          original.set(name, (original.get(name) ?? ZERO).add(amount));
        add(ARREAR_BASIC_LINE, dec(slip.basePay));
        for (const line of Array.isArray(slip.earnings) ? (slip.earnings as unknown[]) : []) {
          const l = line as { name?: unknown; amount?: unknown; kind?: string };
          if (typeof l?.name !== 'string') continue;
          if (classifyPayslipLine({ name: l.name, kind: l.kind as never }, 'earning') !== 'COMPONENT') {
            continue;
          }
          add(l.name, dec(l.amount));
        }
        for (const prior of existing) {
          if (prior.forMonth !== month || prior.forYear !== year) continue;
          if (prior.status === SalaryArrearStatus.CANCELLED) continue;
          const lines = readLines(prior.lines);
          if (lines.length > 0) {
            for (const l of lines) add(l.name, new Decimal(l.delta));
          } else {
            add(ARREAR_BASIC_LINE, dec(prior.amount));
          }
        }

        const revisedByName = new Map<string, Decimal>([[ARREAR_BASIC_LINE, revised.basePay]]);
        for (const e of revised.earnings) {
          revisedByName.set(e.name, (revisedByName.get(e.name) ?? ZERO).add(e.amount));
        }

        const names = [...new Set([...original.keys(), ...revisedByName.keys()])];
        const lines: ArrearLineView[] = [];
        let originalTotal = ZERO;
        let revisedTotal = ZERO;
        let pfWagesDelta = ZERO;
        for (const name of names) {
          const o = money(original.get(name) ?? ZERO);
          const r = money(revisedByName.get(name) ?? ZERO);
          const delta = money(r.sub(o));
          originalTotal = originalTotal.add(o);
          revisedTotal = revisedTotal.add(r);
          if (name === ARREAR_BASIC_LINE || revised.pfApplicableNames.includes(name)) {
            pfWagesDelta = pfWagesDelta.add(delta);
          }
          if (!o.isZero() || !r.isZero()) {
            lines.push({ name, original: o.toNumber(), revised: r.toNumber(), delta: delta.toNumber() });
          }
        }
        const amount = money(revisedTotal.sub(originalTotal));
        if (amount.isZero()) continue;

        try {
          const row = await this.prisma.salaryArrear.create({
            data: {
              tenantId,
              employeeId,
              employeeSalaryId: revision.id,
              forMonth: month,
              forYear: year,
              financialYear: financialYearOf(month, year),
              originalPayslipId: slip.id,
              originalAmount: money(originalTotal),
              revisedAmount: money(revisedTotal),
              amount,
              pfWagesDelta: money(pfWagesDelta),
              lines: lines as unknown as Prisma.InputJsonValue,
            },
            include: VIEW_INCLUDE,
          });
          created.push(toView(row));
          existing.push({
            id: row.id,
            employeeSalaryId: revision.id,
            forMonth: month,
            forYear: year,
            amount,
            status: SalaryArrearStatus.PENDING,
            lines: lines as unknown as Prisma.JsonValue,
          });
        } catch (err) {
          // A concurrent detection wrote the same key first: already done.
          if (isPrismaError(err, 'P2002')) continue;
          throw err;
        }
      }
    }

    if (created.length > 0) {
      this.logger.log(`Detected ${created.length} arrear(s) for employee ${employeeId}`);
    }
    return { created: created.length, arrears: created };
  }

  /** PENDING only. */
  async cancel(tenantId: string, id: string): Promise<SalaryArrearView> {
    const arrear = await this.prisma.salaryArrear.findFirst({
      where: { id, tenantId },
      include: VIEW_INCLUDE,
    });
    if (!arrear) throw new NotFoundException('Arrear not found');
    if (arrear.status !== SalaryArrearStatus.PENDING) {
      throw new BadRequestException(
        `Only a PENDING arrear can be cancelled; this one is ${arrear.status}`,
      );
    }
    const res = await this.prisma.salaryArrear.updateMany({
      where: { id, tenantId, status: SalaryArrearStatus.PENDING },
      data: { status: SalaryArrearStatus.CANCELLED },
    });
    if (!res || res.count !== 1) {
      throw new ConflictException('The arrear was included in a payroll run meanwhile');
    }
    const updated = await this.prisma.salaryArrear.findFirst({
      where: { id, tenantId },
      include: VIEW_INCLUDE,
    });
    return toView(updated ?? { ...arrear, status: SalaryArrearStatus.CANCELLED });
  }

  // --------------------------------------------------------------------------
  // Run helpers (called by PayrollService)
  // --------------------------------------------------------------------------

  /**
   * Arrears a run includes for its employees: months before the run's month,
   * PENDING (unattached) or already INCLUDED in this very run (a recompute).
   */
  async pendingForRun(
    tenantId: string,
    run: { id: string; month: number; year: number },
    employeeIds: string[],
  ) {
    if (employeeIds.length === 0) return [];
    return (
      (await this.prisma.salaryArrear.findMany({
        where: {
          tenantId,
          employeeId: { in: employeeIds },
          OR: [
            { status: SalaryArrearStatus.PENDING, payrollRunId: null },
            { status: SalaryArrearStatus.INCLUDED, payrollRunId: run.id },
          ],
          AND: [
            {
              OR: [
                { forYear: { lt: run.year } },
                { forYear: run.year, forMonth: { lt: run.month } },
              ],
            },
          ],
        },
        select: {
          id: true,
          employeeId: true,
          amount: true,
          pfWagesDelta: true,
          financialYear: true,
        },
        orderBy: [{ forYear: 'asc' }, { forMonth: 'asc' }],
      })) ?? []
    );
  }

  /** Back to PENDING: the run no longer pays them (recompute, reset, delete). */
  detachFromRun(tx: Prisma.TransactionClient, tenantId: string, runId: string) {
    return tx.salaryArrear.updateMany({
      where: { tenantId, payrollRunId: runId, status: SalaryArrearStatus.INCLUDED },
      data: { status: SalaryArrearStatus.PENDING, payrollRunId: null },
    });
  }

  /**
   * Guarded: every arrear the calculation included must still be unattached,
   * or another run (processed concurrently) took it and this run's write
   * transaction rolls back with a 409.
   */
  async attachToRun(
    tx: Prisma.TransactionClient,
    tenantId: string,
    runId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const res = await tx.salaryArrear.updateMany({
      where: { id: { in: ids }, tenantId, status: SalaryArrearStatus.PENDING, payrollRunId: null },
      data: { status: SalaryArrearStatus.INCLUDED, payrollRunId: runId },
    });
    if (!res || res.count !== ids.length) {
      throw new ConflictException(
        'An arrear this run includes was taken by another payroll run meanwhile; process the run again',
      );
    }
  }

  /** The run was paid: its arrears are settled. */
  markPaidForRun(tx: Prisma.TransactionClient, tenantId: string, runId: string) {
    return tx.salaryArrear.updateMany({
      where: { tenantId, payrollRunId: runId, status: SalaryArrearStatus.INCLUDED },
      data: { status: SalaryArrearStatus.PAID },
    });
  }
}
