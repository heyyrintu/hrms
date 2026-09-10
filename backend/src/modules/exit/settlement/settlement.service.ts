import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, SettlementStatus, TaxRegime } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  isPrismaError,
  PRISMA_RECORD_NOT_FOUND,
} from '../../../common/utils/prisma-errors';
import { calculateGratuity } from '../gratuity/gratuity.calculator';
import { GratuityConfig, GratuityResult } from '../gratuity/gratuity.types';
import { calculateEncashmentExemption } from './encashment-exemption';
import type {
  EncashmentExemptionConfig,
  EncashmentExemptionResult,
} from '../../payroll/statutory/tax-correctness.types';
import { ageBandOn31March } from '../../payroll/statutory/tax-correctness.types';
import {
  financialYearOf,
  resolveIncomeTaxConfig,
} from '../../payroll/statutory/statutory.service';
import {
  computeSettlementTax,
  toIncomeTaxConfigInput,
  toTaxDeclarationInput,
  TDS_DISABLED,
  SettlementTaxableParts,
  SettlementTaxWorking,
} from './settlement-tax';
import { ComputeSettlementDto, UpdateSettlementDto } from './dto/settlement.dto';

/**
 * Full and final settlement for a leaver.
 *
 * Assembles the four figures an Indian exit settlement turns on — pro-rata
 * salary for the part-month worked, encashment of unused paid leave, gratuity,
 * and recovery for notice not served — into one record, together with a
 * breakdown that shows the leaver how each number was reached.
 *
 * Money is `Decimal` throughout. Amounts are rounded to paise, half-up, only
 * where they become a stored figure, so a division does not leak its error into
 * everything downstream.
 *
 * TDS is computed, not guessed: the leaver's position for the financial year is
 * assembled from their payslips and their declaration, the settlement's own
 * taxable parts are added, and the balance of the year's tax is what comes off.
 * See `settlement-tax.ts` for the working and for what it does not model. The
 * figure is a default: whoever processes the exit can override it, and the
 * override is recorded as one and survives a recompute.
 *
 * What this deliberately does NOT do:
 *
 * - **Notice recovery uses a simple daily rate**, monthly gross divided by the
 *   calendar days in the month of the last working day. Many contracts recover
 *   on basic alone, on working days rather than calendar days, or at a rate
 *   fixed in the appointment letter. None of those variants are supported.
 * - **The exemption is measured against last drawn basic plus DA**, not against
 *   the average of the last ten months' salary the section asks for, because
 *   the settlement holds only the current salary assignment. Anyone whose pay
 *   moved during those ten months gets a slightly wrong second and third limb.
 * - **No exemption used at an earlier employer is carried in.** The ceiling is
 *   a lifetime one, but nothing in the schema records what a previous employer
 *   already exempted, so zero is assumed and a leaver who has used part of the
 *   ceiling elsewhere will be over-exempted here.
 * - **Notice served is counted in calendar days** between the separation's
 *   initiated date and the last working day, inclusive. Leave taken during
 *   notice, and any contractual rule about extending notice to make up for it,
 *   is ignored.
 * - No bonus, LTA, variable pay or reimbursement is derived. Anything of that
 *   kind has to be entered as `otherEarnings`.
 *
 * This is not a substitute for review by a qualified payroll professional.
 */

/** One earning or deduction line of a salary structure's `components` JSON. */
interface SalaryComponent {
  name: string;
  type: 'earning' | 'deduction';
  calcType: 'fixed' | 'percentage';
  value: number;
  /**
   * Whether this earning forms part of provident fund wages, which is this
   * codebase's marker for "basic plus dearness allowance". Gratuity and leave
   * encashment are both valued on those wages, not on gross.
   */
  pfApplicable?: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Round to paise, half-up, which is the commercial convention. */
function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Round a day count to two places; leave is credited in halves. */
function days(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Calendar days in the month the given date falls in. */
function daysInMonthOf(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/** Whole days from `from` to `to`, counting both ends. */
function inclusiveDaysBetween(from: Date, to: Date): number {
  const span = Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
  return span < 0 ? 0 : span + 1;
}

/**
 * Completed years from joining to the last working day, both days served.
 *
 * Section 10(10AA) counts *completed* years, so a part-year is simply dropped:
 * six years and eleven months is six. That is deliberately not the gratuity
 * Act's count, which rounds a part-year over six months up — borrowing the
 * rounded figure here would grant thirty days of exemption for a year that was
 * never completed.
 *
 * Dates are read in UTC, as they are in the gratuity calculator. Prisma hands
 * back date-only columns as UTC midnight, and reading them in the server's
 * local zone would move a leaver who left on the first of a month back into
 * the previous one.
 */
function completedYearsOfService(joinDate: Date, lastWorkingDate: Date): number {
  const startM = joinDate.getUTCMonth();
  const startD = joinDate.getUTCDate();

  // The exclusive end of the period: the day after the last day served.
  const end = new Date(
    Date.UTC(
      lastWorkingDate.getUTCFullYear(),
      lastWorkingDate.getUTCMonth(),
      lastWorkingDate.getUTCDate() + 1,
    ),
  );

  let totalMonths =
    (end.getUTCFullYear() - joinDate.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - startM);
  // The day of the month has not come round yet, so the last month is not
  // complete.
  if (end.getUTCDate() < startD) totalMonths -= 1;

  return totalMonths <= 0 ? 0 : Math.floor(totalMonths / 12);
}

/**
 * A tax figure a person entered in place of the computed one.
 *
 * Held inside the breakdown rather than in a column of its own, because the
 * schema has one `tds` column and adding another is not this change's to make.
 * The stored `tds` is always either the computed figure or `amount` below;
 * which of the two it is, is exactly what `applied` records.
 */
interface TdsOverride {
  applied: true;
  amount: string;
  reason: string | null;
  at: string;
}

/** The taxComputation block as it is stored: the working plus any override. */
type StoredTaxComputation = SettlementTaxWorking & { override: TdsOverride | null };

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Loaded alongside every settlement so a caller has enough to render it
   * without a second round trip, mirroring `ExitService`'s include.
   */
  private readonly include = {
    employee: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        email: true,
        designation: true,
        department: { select: { name: true } },
        joinDate: true,
      },
    },
    separation: {
      select: {
        id: true,
        type: true,
        status: true,
        initiatedDate: true,
        lastWorkingDate: true,
        noticePeriodDays: true,
        isNoticePeriodWaived: true,
      },
    },
  };

  // -------------------------------------------------------------------------
  // Compute
  // -------------------------------------------------------------------------

  /**
   * Compute a draft settlement for a separation, replacing any existing draft.
   *
   * A settlement that has already been approved or paid is never recomputed:
   * the figures were agreed with the leaver at that point, and silently moving
   * them because a leave balance changed afterwards would be indefensible.
   */
  async compute(tenantId: string, separationId: string, dto: ComputeSettlementDto) {
    const separation = await this.prisma.separation.findFirst({
      where: { id: separationId, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            email: true,
            designation: true,
            department: { select: { name: true } },
            joinDate: true,
            // Read for the age-banded basic exemption under the old regime.
            // Absent reads as GENERAL, which is the safe direction.
            dateOfBirth: true,
          },
        },
      },
    });
    if (!separation) throw new NotFoundException('Separation not found');

    const lastWorkingDate = separation.lastWorkingDate;
    if (!lastWorkingDate) {
      throw new BadRequestException(
        'Set a last working date on the separation before computing a settlement',
      );
    }

    const salary = await this.prisma.employeeSalary.findFirst({
      where: {
        tenantId,
        employeeId: separation.employeeId,
        isActive: true,
      },
      include: { salaryStructure: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!salary) {
      throw new BadRequestException(
        'Employee has no active salary assignment to settle against',
      );
    }

    const config = await this.prisma.statutoryConfig.findUnique({
      where: { tenantId },
    });
    if (!config) {
      throw new BadRequestException(
        'Statutory configuration is not set up for this tenant',
      );
    }

    // Refuse before doing any work if the settlement is already locked.
    const existing = await this.prisma.settlement.findFirst({
      where: { separationId, tenantId },
      // The breakdown is read as well as the status because it carries any TDS
      // override, which a recompute must not throw away.
      select: { id: true, status: true, breakdown: true },
    });
    if (existing && existing.status !== SettlementStatus.DRAFT) {
      throw new ConflictException(
        `Settlement is already ${existing.status} and can no longer be recomputed`,
      );
    }

    const { monthlyGross, lastDrawnWages } = this.deriveWages(salary);

    const proRata = this.computeProRata(
      monthlyGross,
      separation.employee.joinDate,
      lastWorkingDate,
    );

    const encashment = config.leaveEncashmentEnabled
      ? await this.computeLeaveEncashment(
          tenantId,
          separation.employeeId,
          lastDrawnWages,
          new Decimal(config.encashmentMonthDays),
          lastWorkingDate,
        )
      : {
          totalDays: new Decimal(0),
          amount: new Decimal(0),
          perDayRate: new Decimal(0),
          leaveTypes: [] as {
            code: string;
            name: string;
            days: string;
            amount: string;
          }[],
          enabled: false,
        };

    // How much of that encashment escapes tax. This changes nothing about what
    // is paid: `encashment.amount` still goes into gross pay in full, and the
    // exemption is recorded beside it so the leaver can be shown the working.
    const encashmentCompletedYears = completedYearsOfService(
      separation.employee.joinDate,
      lastWorkingDate,
    );
    const exemptionConfig: EncashmentExemptionConfig = {
      exemptionCap: new Decimal(config.encashmentExemptionCap),
      exemptDaysPerYear: new Decimal(config.encashmentExemptDaysPerYear),
      exemptMonths: new Decimal(config.encashmentExemptMonths),
      governmentEmployer: config.encashmentGovernmentEmployer,
    };
    const encashmentExemption: EncashmentExemptionResult =
      calculateEncashmentExemption(
        {
          amountPaid: encashment.amount,
          // The settlement values encashment on last drawn basic plus DA, and
          // the section's "average salary" is the same heads of pay, so the
          // same figure is used. See the note at the head of this file for what
          // that approximation costs.
          averageMonthlySalary: lastDrawnWages,
          completedYears: new Decimal(encashmentCompletedYears),
          daysEncashed: encashment.totalDays,
          // Nothing records what a previous employer already exempted, so the
          // whole lifetime ceiling is treated as available.
          exemptionAlreadyUsed: new Decimal(0),
        },
        exemptionConfig,
      );

    const gratuityConfig: GratuityConfig = {
      gratuityEnabled: config.gratuityEnabled,
      gratuityDaysPerYear: new Decimal(config.gratuityDaysPerYear),
      gratuityMonthDays: new Decimal(config.gratuityMonthDays),
      gratuityMinYears: new Decimal(config.gratuityMinYears),
      gratuityExemptionCap: new Decimal(config.gratuityExemptionCap),
    };
    const gratuity: GratuityResult = calculateGratuity(
      {
        lastDrawnWages,
        joinDate: separation.employee.joinDate,
        lastWorkingDate,
        waiveMinimumService: dto.waiveGratuityMinimumService ?? false,
      },
      gratuityConfig,
    );

    const notice = this.computeNoticeRecovery(
      monthlyGross,
      separation.initiatedDate,
      lastWorkingDate,
      separation.noticePeriodDays,
      separation.isNoticePeriodWaived,
    );

    // A recompute discards any manual figures the processor had entered,
    // because they were entered against a different set of numbers.
    const zero = new Decimal(0);

    // Tax is the exception to that. It is computed rather than entered, so a
    // recompute recomputes it — but a figure a person deliberately put in place
    // of the computed one is a decision about facts this cannot see, and
    // discarding it because a leave balance moved would be indefensible.
    const override = this.readTdsOverride(existing?.breakdown);
    const tax = await this.computeTax({
      tenantId,
      employee: separation.employee,
      statutory: config,
      lastWorkingDate,
      parts: {
        proRataSalary: proRata.amount,
        gratuityTaxable: money(gratuity.amount.sub(gratuity.exemptAmount)),
        leaveEncashmentTaxable: money(
          encashment.amount.sub(encashmentExemption.exempt),
        ),
        // Reset to zero along with the column it mirrors, so the tax is
        // computed on exactly what this settlement now pays.
        otherEarnings: zero,
      },
      override,
    });

    const totals = this.computeTotals({
      proRataSalary: proRata.amount,
      leaveEncashment: encashment.amount,
      gratuity: gratuity.amount,
      otherEarnings: zero,
      noticeRecovery: notice.amount,
      otherRecoveries: zero,
      tds: tax.tds,
    });

    const breakdown = {
      computedAt: new Date().toISOString(),
      lastDrawnWages: lastDrawnWages.toFixed(2),
      monthlyGross: monthlyGross.toFixed(2),
      proRata: {
        monthlyGross: monthlyGross.toFixed(2),
        daysWorked: proRata.daysWorked,
        daysInMonth: proRata.daysInMonth,
        amount: proRata.amount.toFixed(2),
        note: 'Monthly gross x days worked in the final month / days in that month',
      },
      leaveEncashment: {
        enabled: encashment.enabled,
        basis: 'Last drawn basic + DA',
        perDayRate: encashment.perDayRate.toFixed(2),
        totalDays: encashment.totalDays.toFixed(2),
        amount: encashment.amount.toFixed(2),
        leaveTypes: encashment.leaveTypes,
        exemption: {
          exempt: encashmentExemption.exempt.toFixed(2),
          taxable: encashmentExemption.taxable.toFixed(2),
          limitedBy: encashmentExemption.limitedBy,
          averageMonthlySalary: lastDrawnWages.toFixed(2),
          completedYears: String(encashmentCompletedYears),
          daysEncashed: encashment.totalDays.toFixed(2),
          exemptionAlreadyUsed: '0.00',
          governmentEmployer: config.encashmentGovernmentEmployer,
          limbs: {
            amountPaid: encashmentExemption.limbs.amountPaid.toFixed(2),
            statutoryCapRemaining:
              encashmentExemption.limbs.statutoryCapRemaining.toFixed(2),
            averageSalaryMonths:
              encashmentExemption.limbs.averageSalaryMonths.toFixed(2),
            leaveDaysPerYear: encashmentExemption.limbs.leaveDaysPerYear.toFixed(2),
          },
          note:
            'Section 10(10AA): the least of the amount paid, the balance of the ' +
            `lifetime ceiling, ${config.encashmentExemptMonths.toString()} months of average salary, and the ` +
            `cash equivalent of ${config.encashmentExemptDaysPerYear.toString()} days of leave for each completed year`,
        },
        note: 'The whole amount is payable; the exemption below is the part of it that escapes tax',
      },
      gratuity: {
        eligible: gratuity.eligible,
        ineligibleReason: gratuity.ineligibleReason,
        serviceYears: gratuity.serviceYears.toFixed(2),
        countedYears: gratuity.countedYears.toFixed(2),
        amount: gratuity.amount.toFixed(2),
        exemptAmount: gratuity.exemptAmount.toFixed(2),
        taxableAmount: gratuity.taxableAmount.toFixed(2),
      },
      noticeRecovery: {
        waived: separation.isNoticePeriodWaived,
        required: separation.noticePeriodDays,
        served: notice.servedDays,
        shortfallDays: notice.shortfallDays,
        dailyRate: notice.dailyRate.toFixed(2),
        amount: notice.amount.toFixed(2),
        note: 'Simple daily rate: monthly gross / calendar days in the final month',
      },
      // Named as the payslip names its own, and holding the same kind of thing:
      // everything needed to answer "why was this much deducted".
      taxComputation: tax.working,
      totals: this.breakdownTotals(totals),
    };

    const data = {
      tenantId,
      separationId,
      employeeId: separation.employeeId,
      lastWorkingDate,
      proRataSalary: proRata.amount,
      leaveEncashmentDays: encashment.totalDays,
      leaveEncashment: encashment.amount,
      leaveEncashmentExempt: encashmentExemption.exempt,
      gratuity: gratuity.amount,
      gratuityExempt: gratuity.exemptAmount,
      otherEarnings: zero,
      noticeShortfallDays: notice.shortfallDays,
      noticeRecovery: notice.amount,
      otherRecoveries: zero,
      tds: tax.tds,
      grossPayable: totals.grossPayable,
      totalRecoveries: totals.totalRecoveries,
      netPayable: totals.netPayable,
      breakdown: breakdown as unknown as Prisma.InputJsonValue,
      status: SettlementStatus.DRAFT,
    };

    // The read that decided create-versus-update and the write itself are one
    // unit of work: without it a settlement created between the two would be
    // silently duplicated against a column the schema declares unique.
    return this.prisma.$transaction(async (tx) => {
      if (!existing) {
        return tx.settlement.create({ data, include: this.include });
      }

      try {
        return await tx.settlement.update({
          where: { id: existing.id, status: SettlementStatus.DRAFT },
          data,
          include: this.include,
        });
      } catch (err) {
        if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
          throw new ConflictException(
            'Settlement was approved or paid while it was being recomputed',
          );
        }
        throw err;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findOne(tenantId: string, id: string) {
    const settlement = await this.prisma.settlement.findFirst({
      where: { id, tenantId },
      include: this.include,
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    return settlement;
  }

  async findBySeparation(tenantId: string, separationId: string) {
    const settlement = await this.prisma.settlement.findFirst({
      where: { separationId, tenantId },
      include: this.include,
    });
    if (!settlement) {
      throw new NotFoundException('No settlement has been computed for this separation');
    }
    return settlement;
  }

  // -------------------------------------------------------------------------
  // Manual figures and status transitions
  // -------------------------------------------------------------------------

  /**
   * Set the figures the service cannot derive, override the one it can, and
   * re-derive the totals.
   *
   * Only a draft is editable. The totals are recomputed here rather than
   * trusting the caller, so `netPayable` can never disagree with the parts it
   * is made of.
   *
   * A `tds` sent here is an override of the computed figure, not a replacement
   * for it: the computation stays in the breakdown and the override is recorded
   * beside it with its reason and the moment it was made. `clearTdsOverride`
   * undoes that and puts the computed figure back.
   *
   * The tax is not recomputed here, even when `otherEarnings` moves. Recompute
   * is where tax is worked out, and quietly changing a deduction under an
   * unrelated edit would be worse than leaving it to an explicit action.
   */
  async update(tenantId: string, id: string, dto: UpdateSettlementDto) {
    for (const [field, value] of Object.entries(dto)) {
      if (typeof value === 'number' && value < 0) {
        throw new BadRequestException(`${field} cannot be negative`);
      }
    }

    if (dto.tds !== undefined && dto.clearTdsOverride) {
      throw new BadRequestException(
        'Send either a tds override or clearTdsOverride, not both',
      );
    }

    const settlement = await this.prisma.settlement.findFirst({
      where: { id, tenantId },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== SettlementStatus.DRAFT) {
      throw new ConflictException(
        `Settlement is ${settlement.status} and can no longer be edited`,
      );
    }

    const otherEarnings =
      dto.otherEarnings === undefined
        ? new Decimal(settlement.otherEarnings)
        : money(new Decimal(dto.otherEarnings));
    const otherRecoveries =
      dto.otherRecoveries === undefined
        ? new Decimal(settlement.otherRecoveries)
        : money(new Decimal(dto.otherRecoveries));
    const storedTax = (settlement.breakdown as { taxComputation?: unknown } | null)
      ?.taxComputation as Partial<StoredTaxComputation> | undefined;

    let override = this.readTdsOverride(settlement.breakdown);
    let tds = new Decimal(settlement.tds);

    if (dto.tds !== undefined) {
      tds = money(new Decimal(dto.tds));
      override = {
        applied: true,
        amount: tds.toFixed(2),
        reason: dto.tdsOverrideReason ?? null,
        at: new Date().toISOString(),
      };
    } else if (dto.clearTdsOverride) {
      override = null;
      // Back to whatever the last computation produced. A breakdown with no
      // computed figure in it predates this block, and zero is the figure the
      // settlement was carrying before an override could exist.
      tds = money(new Decimal(storedTax?.computedTds ?? 0));
    }

    const totals = this.computeTotals({
      proRataSalary: new Decimal(settlement.proRataSalary),
      leaveEncashment: new Decimal(settlement.leaveEncashment),
      gratuity: new Decimal(settlement.gratuity),
      otherEarnings,
      noticeRecovery: new Decimal(settlement.noticeRecovery),
      otherRecoveries,
      tds,
    });

    // The breakdown's totals section is refreshed so the working shown to the
    // leaver keeps agreeing with the stored figures, and the tax block records
    // whether the figure now stored is the computed one or a person's.
    // A settlement computed before tax was has no block to update; an override
    // entered on one still has to be recorded, or the next recompute would
    // replace a figure a person chose without ever knowing they had chosen it.
    const nextTax = storedTax || override ? { ...(storedTax ?? {}), override } : null;

    const breakdown = {
      ...((settlement.breakdown as Record<string, unknown>) ?? {}),
      ...(nextTax ? { taxComputation: nextTax } : {}),
      totals: this.breakdownTotals(totals),
    };

    try {
      return await this.prisma.settlement.update({
        where: { id, status: SettlementStatus.DRAFT },
        data: {
          otherEarnings,
          otherRecoveries,
          tds,
          remarks: dto.remarks,
          grossPayable: totals.grossPayable,
          totalRecoveries: totals.totalRecoveries,
          netPayable: totals.netPayable,
          breakdown: breakdown as unknown as Prisma.InputJsonValue,
        },
        include: this.include,
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException('Settlement is no longer a draft');
      }
      throw err;
    }
  }

  /** DRAFT -> APPROVED. */
  async approve(tenantId: string, id: string, approvedBy: string) {
    await this.assertStatus(tenantId, id, SettlementStatus.DRAFT, 'approved');

    return this.transition(
      id,
      SettlementStatus.DRAFT,
      {
        status: SettlementStatus.APPROVED,
        approvedBy,
        approvedAt: new Date(),
      },
      'Settlement is no longer a draft',
    );
  }

  /** APPROVED -> PAID. Paying an unapproved settlement is the failure this guards. */
  async markPaid(tenantId: string, id: string) {
    await this.assertStatus(tenantId, id, SettlementStatus.APPROVED, 'paid');

    return this.transition(
      id,
      SettlementStatus.APPROVED,
      { status: SettlementStatus.PAID, paidAt: new Date() },
      'Settlement is no longer approved',
    );
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Read-then-check, so the caller gets a clear message before the guarded write. */
  private async assertStatus(
    tenantId: string,
    id: string,
    required: SettlementStatus,
    action: string,
  ) {
    const settlement = await this.prisma.settlement.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== required) {
      throw new ConflictException(
        `Only a ${required} settlement can be ${action}; this one is ${settlement.status}`,
      );
    }
    return settlement;
  }

  /**
   * The status is part of the where clause, so a concurrent transition makes
   * Prisma raise P2025 and we answer 409 rather than applying the move twice.
   */
  private async transition(
    id: string,
    from: SettlementStatus,
    data: Prisma.SettlementUpdateInput,
    conflictMessage: string,
  ) {
    try {
      return await this.prisma.settlement.update({
        where: { id, status: from },
        data,
        include: this.include,
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException(conflictMessage);
      }
      throw err;
    }
  }

  /**
   * Monthly gross and "last drawn wages" from the employee's salary structure.
   *
   * Gross is base pay plus every earning component, valued the same way payroll
   * values them: a percentage component is a percentage of base pay, a fixed one
   * is its face value. Last drawn wages is base pay plus only the earnings the
   * structure marks as forming part of PF wages, which is how this codebase
   * expresses basic plus dearness allowance.
   */
  private deriveWages(salary: {
    basePay: Prisma.Decimal | Decimal;
    salaryStructure: { components: Prisma.JsonValue };
  }): { monthlyGross: Decimal; lastDrawnWages: Decimal } {
    const basePay = new Decimal(salary.basePay);
    const components =
      (salary.salaryStructure.components as unknown as SalaryComponent[]) || [];

    let monthlyGross = basePay;
    let lastDrawnWages = basePay;

    for (const comp of components) {
      if (comp.type !== 'earning') continue;
      const amount =
        comp.calcType === 'percentage'
          ? money(basePay.mul(new Decimal(comp.value).div(100)))
          : money(new Decimal(comp.value));

      monthlyGross = monthlyGross.add(amount);
      if (comp.pfApplicable) lastDrawnWages = lastDrawnWages.add(amount);
    }

    return { monthlyGross: money(monthlyGross), lastDrawnWages: money(lastDrawnWages) };
  }

  /**
   * Salary for the part-month up to the last working day.
   *
   * The window normally opens on the first of the month; for someone who joined
   * in their final month it opens on the join date instead, because they were
   * not on the payroll for the earlier days. Attendance and loss of pay in that
   * month are not looked at — the regular payroll run owns that, and this is a
   * settlement of the days the leaver was employed.
   */
  private computeProRata(
    monthlyGross: Decimal,
    joinDate: Date,
    lastWorkingDate: Date,
  ): { amount: Decimal; daysWorked: number; daysInMonth: number } {
    const daysInMonth = daysInMonthOf(lastWorkingDate);

    const joinedThisMonth =
      joinDate.getFullYear() === lastWorkingDate.getFullYear() &&
      joinDate.getMonth() === lastWorkingDate.getMonth();
    const firstDay = joinedThisMonth ? joinDate.getDate() : 1;
    const daysWorked = Math.max(lastWorkingDate.getDate() - firstDay + 1, 0);

    return {
      amount: money(monthlyGross.mul(daysWorked).div(daysInMonth)),
      daysWorked,
      daysInMonth,
    };
  }

  /**
   * Value the leaver's unused paid leave.
   *
   * A balance is what was granted plus what was carried over, less what was
   * taken and what is still awaiting approval; a leave type whose approvals have
   * outrun its grant floors at zero rather than eating into another type's
   * balance. Unpaid types are skipped: there is nothing to encash.
   *
   * Balances are read for the calendar year of the last working day, which is
   * the year the leave was accrued in.
   */
  private async computeLeaveEncashment(
    tenantId: string,
    employeeId: string,
    lastDrawnWages: Decimal,
    encashmentMonthDays: Decimal,
    lastWorkingDate: Date,
  ) {
    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        tenantId,
        employeeId,
        year: lastWorkingDate.getFullYear(),
        leaveType: { isPaid: true },
      },
      include: { leaveType: { select: { id: true, name: true, code: true, isPaid: true } } },
    });

    const perDayRate = encashmentMonthDays.gt(0)
      ? money(lastDrawnWages.div(encashmentMonthDays))
      : new Decimal(0);

    let totalDays = new Decimal(0);
    let amount = new Decimal(0);
    const leaveTypes: { code: string; name: string; days: string; amount: string }[] = [];

    for (const balance of balances) {
      // Re-checked here as well as in the query: an unpaid day has no value to
      // encash, and paying one out would be a straight overpayment.
      if (!balance.leaveType.isPaid) continue;

      const available = new Decimal(balance.totalDays)
        .add(new Decimal(balance.carriedOver))
        .sub(new Decimal(balance.usedDays))
        .sub(new Decimal(balance.pendingDays));
      if (available.lte(0)) continue;

      const encashable = days(available);
      const value = money(encashable.mul(perDayRate));

      totalDays = totalDays.add(encashable);
      amount = amount.add(value);
      leaveTypes.push({
        code: balance.leaveType.code,
        name: balance.leaveType.name,
        days: encashable.toFixed(2),
        amount: value.toFixed(2),
      });
    }

    return { totalDays: days(totalDays), amount: money(amount), perDayRate, leaveTypes, enabled: true };
  }

  // -------------------------------------------------------------------------
  // Tax
  // -------------------------------------------------------------------------

  /**
   * The tax to deduct from the settlement, and the working behind it.
   *
   * Everything the calculation needs is loaded here and the arithmetic itself
   * lives in `settlement-tax.ts`, which is pure and separately tested. The
   * income tax configuration is resolved through the same
   * `resolveIncomeTaxConfig` the monthly payroll and Form 16 use, so a leaver
   * cannot be taxed on a different year's slabs from the ones their payslips
   * were computed against.
   *
   * The financial year is the one the last working day falls in, read in UTC,
   * as the gratuity and encashment calculations read their dates.
   */
  private async computeTax(args: {
    tenantId: string;
    employee: { id: string; dateOfBirth?: Date | null };
    statutory: { tdsEnabled: boolean; defaultTaxRegime: TaxRegime };
    lastWorkingDate: Date;
    parts: SettlementTaxableParts;
    override: TdsOverride | null;
  }): Promise<{ tds: Decimal; working: StoredTaxComputation }> {
    const { tenantId, employee, statutory, lastWorkingDate, parts, override } = args;

    const financialYear = financialYearOf(
      lastWorkingDate.getUTCMonth() + 1,
      lastWorkingDate.getUTCFullYear(),
    );

    const [declarationRow, payslips] = await Promise.all([
      this.prisma.employeeTaxDeclaration.findUnique({
        where: {
          tenantId_employeeId_financialYear: {
            tenantId,
            employeeId: employee.id,
            financialYear,
          },
        },
      }),
      this.prisma.payslip.findMany({
        where: {
          tenantId,
          employeeId: employee.id,
          payrollRun: {
            OR: [
              { year: financialYear, month: { gte: 4 } },
              { year: financialYear + 1, month: { lte: 3 } },
            ],
          },
        },
        select: { grossPay: true, professionalTax: true, tds: true },
      }),
    ]);

    const rows = payslips ?? [];
    const zero = new Decimal(0);
    const yearToDate = rows.reduce(
      (acc, p) => ({
        grossPaid: acc.grossPaid.add(new Decimal(p.grossPay)),
        professionalTaxPaid: acc.professionalTaxPaid.add(new Decimal(p.professionalTax)),
        tdsDeducted: acc.tdsDeducted.add(new Decimal(p.tds)),
        payslips: acc.payslips + 1,
      }),
      {
        grossPaid: zero,
        professionalTaxPaid: zero,
        tdsDeducted: zero,
        payslips: 0,
      },
    );

    const regime: TaxRegime = declarationRow?.regime ?? statutory.defaultTaxRegime;
    // Age as at 31 March of the financial year, not the exit date; a leaver who
    // turns 60 in February is a senior citizen for the whole of that year.
    const ageBandRequested = ageBandOn31March(employee.dateOfBirth, financialYear);

    // A tenant that has switched TDS off is not one whose settlements should
    // quietly acquire a deduction because this feature landed.
    const resolved = statutory.tdsEnabled
      ? await resolveIncomeTaxConfig(
          this.prisma,
          tenantId,
          financialYear,
          regime,
          ageBandRequested,
          (band) =>
            this.logger.warn(
              `No ${band} income tax configuration for tenant ${tenantId}, FY ` +
                `${financialYear}, ${regime} regime; settling on the GENERAL slabs ` +
                'so the leaver is not silently untaxed.',
            ),
        )
      : null;

    if (statutory.tdsEnabled && !resolved) {
      this.logger.warn(
        `No income tax configuration for tenant ${tenantId}, FY ${financialYear}, ` +
          `${regime} regime; settling with no TDS and recording why.`,
      );
    }

    const computation = computeSettlementTax({
      financialYear,
      regime,
      config: resolved
        ? toIncomeTaxConfigInput(resolved.taxConfig, regime, resolved.ageBandUsed)
        : null,
      declaration: toTaxDeclarationInput(declarationRow),
      declarationFound: Boolean(declarationRow),
      ageBandUsed: resolved?.ageBandUsed ?? ageBandRequested,
      ageBandRequested,
      ageBandFallback: resolved?.ageBandFallback ?? false,
      parts,
      yearToDate,
      ...(statutory.tdsEnabled
        ? {}
        : {
            unavailable: {
              reason: TDS_DISABLED,
              note:
                'Tax deducted at source is switched off for this tenant, so no ' +
                'tax has been deducted from this settlement. Nothing was computed ' +
                'and this is not a finding that no tax is due.',
            },
          }),
    });

    return {
      // The override, where there is one, is what is actually deducted; the
      // computed figure stays in the working beside it.
      tds: override ? money(new Decimal(override.amount)) : computation.tds,
      working: { ...computation.working, override },
    };
  }

  /**
   * Any TDS override carried by a stored breakdown.
   *
   * Read defensively: the column is JSON, older rows predate this block
   * entirely, and a shape that is not recognisably an override is treated as
   * none rather than trusted into a money figure.
   */
  private readTdsOverride(breakdown: unknown): TdsOverride | null {
    const stored = (breakdown as { taxComputation?: { override?: unknown } } | null)
      ?.taxComputation?.override as Partial<TdsOverride> | null | undefined;

    if (!stored || stored.applied !== true || typeof stored.amount !== 'string') {
      return null;
    }
    // A stored amount that is not a number is not one to deduct against.
    let amount: Decimal;
    try {
      amount = new Decimal(stored.amount);
    } catch {
      return null;
    }

    return {
      applied: true,
      amount: money(amount).toFixed(2),
      reason: typeof stored.reason === 'string' ? stored.reason : null,
      at: typeof stored.at === 'string' ? stored.at : new Date().toISOString(),
    };
  }

  /**
   * Recover pay for notice the leaver did not serve.
   *
   * Notice served is counted from the day the separation was initiated to the
   * last working day, both included. Nothing is recovered when the employer
   * waived the notice period, nor when the full period was served.
   */
  private computeNoticeRecovery(
    monthlyGross: Decimal,
    initiatedDate: Date,
    lastWorkingDate: Date,
    noticePeriodDays: number,
    isWaived: boolean,
  ) {
    const daysInMonth = daysInMonthOf(lastWorkingDate);
    const dailyRate = money(monthlyGross.div(daysInMonth));
    const servedDays = inclusiveDaysBetween(initiatedDate, lastWorkingDate);

    if (isWaived) {
      return { shortfallDays: 0, servedDays, dailyRate, amount: new Decimal(0) };
    }

    const shortfallDays = Math.max(noticePeriodDays - servedDays, 0);

    return {
      shortfallDays,
      servedDays,
      dailyRate,
      // Computed from the gross rather than the rounded daily rate so the
      // recovery does not drift by up to half a paisa per shortfall day.
      amount: money(monthlyGross.mul(shortfallDays).div(daysInMonth)),
    };
  }

  /**
   * grossPayable = pro-rata + encashment + gratuity + other earnings
   * totalRecoveries = notice recovery + other recoveries
   * netPayable = grossPayable - totalRecoveries - tds
   *
   * The net may be negative: a leaver who served little of a long notice period
   * can owe the employer, and hiding that behind a floor of zero would misstate
   * what is due.
   */
  private computeTotals(parts: {
    proRataSalary: Decimal;
    leaveEncashment: Decimal;
    gratuity: Decimal;
    otherEarnings: Decimal;
    noticeRecovery: Decimal;
    otherRecoveries: Decimal;
    tds: Decimal;
  }) {
    const grossPayable = money(
      parts.proRataSalary
        .add(parts.leaveEncashment)
        .add(parts.gratuity)
        .add(parts.otherEarnings),
    );
    const totalRecoveries = money(parts.noticeRecovery.add(parts.otherRecoveries));
    const netPayable = money(grossPayable.sub(totalRecoveries).sub(parts.tds));

    return { ...parts, grossPayable, totalRecoveries, netPayable };
  }

  /** The totals section of the breakdown, as fixed-point strings. */
  private breakdownTotals(totals: ReturnType<SettlementService['computeTotals']>) {
    return {
      proRataSalary: totals.proRataSalary.toFixed(2),
      leaveEncashment: totals.leaveEncashment.toFixed(2),
      gratuity: totals.gratuity.toFixed(2),
      otherEarnings: totals.otherEarnings.toFixed(2),
      grossPayable: totals.grossPayable.toFixed(2),
      noticeRecovery: totals.noticeRecovery.toFixed(2),
      otherRecoveries: totals.otherRecoveries.toFixed(2),
      totalRecoveries: totals.totalRecoveries.toFixed(2),
      tds: totals.tds.toFixed(2),
      netPayable: totals.netPayable.toFixed(2),
      formula:
        'net = (pro-rata + encashment + gratuity + other earnings) - (notice recovery + other recoveries) - TDS',
    };
  }
}
