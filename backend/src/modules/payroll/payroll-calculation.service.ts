import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LoanType, OneTimePaymentKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import {
  LoansService,
  PayrollRepaymentLine,
} from '../loans/loans.service';
import {
  Section10AllowancesInput,
  StatutoryService,
  StatutoryResult,
} from './statutory/statutory.service';
import {
  Section10AllowancesPaid,
  Section10ComponentHead,
} from './statutory/completion.types';
import { SECTION_10_HEAD_TO_ALLOWANCE_KEY } from './statutory/statutory.calculators';
import {
  financialYearOf,
  monthsRemainingInFy,
} from './statutory/statutory.service';
import {
  ARREARS_LINE_NAME,
  ARREARS_RECOVERY_LINE_NAME,
  HOLD_RELEASE_LINE_PREFIX,
  PayslipLineKind,
  REIMBURSEMENT_LINE_NAME,
} from './payroll-lines.types';

interface SalaryComponent {
  name: string;
  type: 'earning' | 'deduction';
  calcType: 'fixed' | 'percentage';
  value: number;
  /**
   * Whether this earning counts toward provident fund wages. PF is computed on
   * basic plus dearness allowance, not on gross, so allowances such as HRA and
   * conveyance are excluded unless flagged. Basic pay is always included.
   */
  pfApplicable?: boolean;
  /**
   * Which section 10 allowance this earning is paid under, where it is one.
   *
   * Section 10 exempts an allowance *received*: where the employer pays no
   * leave travel, children's education or hostel allowance at all, there is
   * nothing to exempt however much the employee declares. Marking the
   * component is how the structure says what it pays, and it follows
   * `pfApplicable` above rather than inventing a second convention.
   *
   * An unmarked structure passes nothing to the statutory engine, and every
   * exemption is then computed from exactly the figures it was before.
   */
  section10Head?: Section10ComponentHead;
}

/** The three heads, in the order the working reports them. */
const SECTION_10_HEADS: readonly Section10ComponentHead[] = [
  'LTA',
  'CHILDREN_EDUCATION',
  'HOSTEL_ALLOWANCE',
];

/**
 * One payslip line as the calculation produces it. Written to the payslip's
 * JSON per the line contract in `payroll-lines.types.ts` (amount as a number
 * rounded to paise).
 */
export interface PayslipLineData {
  name: string;
  amount: Decimal;
  kind?: PayslipLineKind;
  /** Earnings only. */
  taxable?: boolean;
  refId?: string | null;
}

/** An arrear (spec C1) included in the run for this employee. */
export interface ArrearExtra {
  id: string;
  /** Signed: negative is a recovery. */
  amount: Decimal;
  pfWagesDelta: Decimal;
  /** Financial year of the month the arrear is for (section 89). */
  financialYear: number;
}

/** A PayrollOneTimePayment (spec C2) of the run for this employee. */
export interface OneTimePaymentExtra {
  id: string;
  kind: OneTimePaymentKind;
  name: string;
  amount: Decimal;
  taxable: boolean;
}

/** A settlement (spec C5) carried verbatim by an off-cycle run. */
export interface SettlementExtra {
  id: string;
  proRataSalary: Decimal;
  leaveEncashment: Decimal;
  leaveEncashmentExempt: Decimal;
  gratuity: Decimal;
  gratuityExempt: Decimal;
  otherEarnings: Decimal;
  noticeRecovery: Decimal;
  otherRecoveries: Decimal;
  /** Notice + other + loan recovery. */
  totalRecoveries: Decimal;
  tds: Decimal;
  netPayable: Decimal;
}

/** Inputs attached to the run for one employee (Keka wave C). */
export interface PayslipExtras {
  arrears?: ArrearExtra[];
  oneTimePayments?: OneTimePaymentExtra[];
  /** Approved expense claims paid through payroll (spec C4). */
  reimbursements?: { id: string; amount: Decimal }[];
  /** Salary held in an earlier run, released here (spec C3). */
  holdReleases?: { id: string; amount: Decimal; heldMonth: number; heldYear: number }[];
  settlement?: SettlementExtra | null;
}

/**
 * How to compute one payslip. The defaults are the regular run exactly as it
 * was before wave C.
 */
export interface CalculationOptions {
  /** False: no base pay, components or attendance (off-cycle without salary). */
  includeSalary?: boolean;
  /** False: no loan / salary-advance instalments (off-cycle runs). */
  deductLoans?: boolean;
  /** False: no professional tax or LWF (off-cycle runs). */
  chargeMonthlyStatutory?: boolean;
  /** The run being computed, left out of the year to date. */
  payrollRunId?: string;
  /** An off-cycle run: TDS projects the regular salary when none is paid here. */
  offCycle?: boolean;
  extras?: PayslipExtras;
}

/** A month's regular earnings with one salary row (arrears detection). */
export interface RegularEarnings {
  employeeSalaryId: string;
  basePay: Decimal;
  earnings: { name: string; amount: Decimal }[];
  /** basePay + earnings. */
  total: Decimal;
  /** basePay + pfApplicable earnings. */
  pfWages: Decimal;
  /** The structure's earning components that form part of PF wages. */
  pfApplicableNames: string[];
}

const ONE_TIME_EARNING_KINDS: readonly OneTimePaymentKind[] = [
  OneTimePaymentKind.BONUS,
  OneTimePaymentKind.INCENTIVE,
  OneTimePaymentKind.COMMISSION,
  OneTimePaymentKind.OTHER_EARNING,
];

/** Whether a one-time payment kind is an earning (else a post-tax deduction). */
export function isOneTimeEarning(kind: OneTimePaymentKind): boolean {
  return ONE_TIME_EARNING_KINDS.includes(kind);
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Held salary release (Mar 2026)". */
export function holdReleaseLineName(month: number, year: number): string {
  return `${HOLD_RELEASE_LINE_PREFIX} (${MONTH_ABBR[month - 1]} ${year})`;
}

function hasExtras(extras: PayslipExtras): boolean {
  return (
    (extras.arrears?.length ?? 0) > 0 ||
    (extras.oneTimePayments?.length ?? 0) > 0 ||
    (extras.reimbursements?.length ?? 0) > 0 ||
    (extras.holdReleases?.length ?? 0) > 0 ||
    !!extras.settlement
  );
}

/**
 * Money is carried as Decimal end to end. Payslip and PayrollRun columns are
 * `Decimal`, and binary floating point silently loses cents at the two-decimal
 * boundary: 1% of 14.50 is exactly 0.145, but `Math.round(0.145 * 100) / 100`
 * evaluates to 0.14 because 0.145 is not representable.
 */
export interface PayslipData {
  employeeId: string;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  lopDays: number;
  otHours: Decimal;
  basePay: Decimal;
  earnings: PayslipLineData[];
  deductions: PayslipLineData[];
  grossPay: Decimal;
  totalDeductions: Decimal;
  netPay: Decimal;
  otPay: Decimal;
  /** Part of grossPay that does not recur (positive arrears, taxable one-time). */
  nonRecurringTaxable: Decimal;
  /** Paid on top of grossPay, untaxed. netPay = gross + this - deductions. */
  nonTaxableEarnings: Decimal;
  /** Net positive arrears included in grossPay. */
  arrearsAmount: Decimal;
  /** Reimbursements included in nonTaxableEarnings. */
  reimbursementAmount: Decimal;
  /** Indian statutory deductions and employer contributions for the month. */
  statutory: StatutoryResult;
  /**
   * The loan and salary-advance instalments this payslip actually deducted,
   * after the clamp below — not what the schedule asked for. The payroll run
   * hands exactly these to `LoansService.recordPayrollRepayments` once the
   * payslip row exists, so what a loan is credited with is always what the
   * employee was actually charged.
   */
  loanRepayments: PayrollRepaymentLine[];
}

/** Round to paise, half-up, which is the commercial convention. */
function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * The first and last calendar day of a month, as UTC midnights.
 *
 * Every date column these windows filter — `AttendanceRecord.date`,
 * `Holiday.date`, `LeaveRequest.startDate`/`endDate` — is `@db.Date`, which
 * Prisma reads back as UTC midnight. Building the window with
 * `new Date(year, month - 1, 1)` used the server's own zone, so on an IST box
 * the range ran 28 Feb 18:30Z – 30 Mar 18:30Z and the 31st of the month fell
 * outside `lte` entirely: its attendance was dropped, its ABSENT row never
 * charged as LOP, and its date never added to the double-charge guard.
 */
function monthWindowUtc(month: number, year: number): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(Date.UTC(year, month - 1, 1)),
    // Day 0 of the next month is the last day of this one.
    endDate: new Date(Date.UTC(year, month, 0)),
  };
}

@Injectable()
export class PayrollCalculationService {
  private readonly logger = new Logger(PayrollCalculationService.name);

  constructor(
    private prisma: PrismaService,
    private statutoryService: StatutoryService,
    private loansService: LoansService,
  ) {}

  /**
   * One employee's payslip for a month.
   *
   * With no options this is the regular run exactly as it was before wave C.
   * `options` carries what an off-cycle run changes (no salary, no loans, no
   * monthly statutory charges) and the inputs attached to the run for this
   * employee (arrears, one-time payments, reimbursements, released holds, a
   * settlement). Returns null when there is nothing to pay: no salary
   * assignment (or salary not included) and no extras.
   */
  async calculateForEmployee(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
    options: CalculationOptions = {},
  ): Promise<PayslipData | null> {
    const includeSalary = options.includeSalary ?? true;
    const deductLoans = options.deductLoans ?? true;
    const extras: PayslipExtras = options.extras ?? {};

    // A settlement is paid exactly as approved: no salary, no recalculation.
    if (extras.settlement) {
      return this.settlementPayslip(employeeId, extras.settlement);
    }

    // 1. Get active salary assignment
    const salary = includeSalary
      ? await this.prisma.employeeSalary.findFirst({
          where: {
            tenantId,
            employeeId,
            isActive: true,
            effectiveFrom: { lte: new Date(year, month - 1, 28) },
            OR: [
              { effectiveTo: null },
              { effectiveTo: { gte: new Date(year, month - 1, 1) } },
            ],
          },
          include: {
            salaryStructure: true,
            employee: {
              select: {
                otMultiplier: true,
                payType: true,
                hourlyRate: true,
                gender: true,
                // The old regime's basic exemption depends on age, read as at
                // 31 March. Without this every senior employee gets the general
                // slabs and nothing says so.
                dateOfBirth: true,
                pfOptOut: true,
                taxRegime: true,
              },
            },
          },
        })
      : null;

    if (!salary && !hasExtras(extras)) return null;

    // Without a salary the employee's statutory attributes still decide PF,
    // ESI and the tax regime on the extras.
    const person = salary
      ? salary.employee
      : await this.prisma.employee.findFirst({
          where: { id: employeeId, tenantId },
          select: {
            gender: true,
            dateOfBirth: true,
            pfOptOut: true,
            taxRegime: true,
          },
        });

    // 2-6. Base pay, attendance, leave and components (regular earnings).
    const regular = salary
      ? await this.regularPart(tenantId, employeeId, month, year, salary)
      : null;

    const components = regular?.components ?? [];
    const proratedBasePay = regular?.proratedBasePay ?? new Decimal(0);
    const workingDays = regular?.workingDays ?? 0;
    const earnings: PayslipLineData[] = (regular?.earnings ?? []).map((e) => ({
      ...e,
      kind: 'COMPONENT' as const,
    }));
    const deductions: PayslipLineData[] = (regular?.deductions ?? []).map((d) => ({
      ...d,
      kind: 'COMPONENT' as const,
    }));

    // 7. Calculate OT pay
    const otHours = new Decimal(regular?.otMinutes ?? 0)
      .div(60)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    let otPay = new Decimal(0);
    if (salary && otHours.gt(0)) {
      const basePay = new Decimal(salary.basePay);
      if (basePay.gt(0)) {
        // Hourly equivalent = basePay / (workingDays * 8)
        const hourlyRate =
          salary.employee.payType === 'HOURLY' && salary.employee.hourlyRate
            ? new Decimal(salary.employee.hourlyRate)
            : workingDays > 0
              ? basePay.div(new Decimal(workingDays).mul(8))
              : new Decimal(0);
        const otMultiplier = new Decimal(salary.employee.otMultiplier);
        otPay = money(otHours.mul(hourlyRate).mul(otMultiplier));
      }
    }

    // 8. Calculate totals. Summing already-rounded amounts exactly, so the
    // totals cannot drift from the line items shown on the payslip.
    const totalEarnings = earnings.reduce(
      (sum, e) => sum.add(e.amount),
      new Decimal(0),
    );
    const totalDeductions = deductions.reduce(
      (sum, d) => sum.add(d.amount),
      new Decimal(0),
    );

    // 8b. Wave C extras: arrears, one-time payments, reimbursements and
    // released holds. With none, every figure below is nought.
    const extra = this.extrasLines(extras, month, year);
    earnings.push(...extra.earnings);

    const grossPay = money(
      proratedBasePay.add(totalEarnings).add(otPay).add(extra.taxableEarnings),
    );

    // 9. Statutory deductions, which need the gross to be known first.
    // Provident fund is computed on basic plus any component the structure
    // marks as forming part of PF wages, not on gross.
    const regularPfWages = components
      .filter((c) => c.type === 'earning' && c.pfApplicable)
      .reduce((sum, comp) => {
        const line = earnings.find((e) => e.name === comp.name && e.kind === 'COMPONENT');
        return line ? sum.add(line.amount) : sum;
      }, proratedBasePay);
    // Arrears carry their own PF wages (basic + PF components revised).
    const pfWages = extra.pfWagesDelta.gt(0)
      ? regularPfWages.add(extra.pfWagesDelta)
      : regularPfWages;

    // What this month actually pays under each section 10 allowance head, and
    // through which earning lines, so the year to date can be summed from the
    // payslips already run. Matched by name against the month's earnings the
    // same way provident fund wages are, so the figure passed is the figure on
    // the payslip, pro-rating and all.
    //
    // Only an *earning* can carry a head: section 10 exempts an allowance
    // received, and a deduction is not one. Undefined when the structure marks
    // nothing, which leaves every exemption exactly where it was.
    const section10Allowances = this.section10AllowancesPaid(
      components,
      earnings.filter((e) => e.kind === 'COMPONENT'),
    );

    // An off-cycle run paying no salary projects the regular salary for the
    // tax on what it does pay (spec C.T).
    const offCycleProjection =
      options.offCycle && !salary && extra.nonRecurringTaxable.gt(0)
        ? await this.offCycleProjection(tenantId, employeeId, month, year)
        : undefined;

    const statutory = await this.statutoryService.compute({
      tenantId,
      employeeId,
      month,
      year,
      pfWages,
      grossPay,
      ...(section10Allowances ? { section10Allowances } : {}),
      pfOptOut: person?.pfOptOut ?? false,
      gender: person?.gender ?? null,
      dateOfBirth: person?.dateOfBirth ?? null,
      employeeRegime: person?.taxRegime ?? null,
      ...(extra.nonRecurringTaxable.gt(0)
        ? { nonRecurringTaxable: extra.nonRecurringTaxable }
        : {}),
      ...(extra.priorYearArrears ? { priorYearArrears: extra.priorYearArrears } : {}),
      ...(options.chargeMonthlyStatutory === false ? { chargeMonthlyStatutory: false } : {}),
      ...(options.payrollRunId ? { excludePayrollRunId: options.payrollRunId } : {}),
      ...(offCycleProjection ? { offCycleProjection } : {}),
    });

    for (const [name, amount] of [
      ['Provident Fund', statutory.pfEmployee],
      ['ESI', statutory.esiEmployee],
      ['Professional Tax', statutory.professionalTax],
      ['Labour Welfare Fund', statutory.lwfEmployee],
      ['TDS', statutory.tds],
    ] as const) {
      if (amount.gt(0)) deductions.push({ name, amount, kind: 'STATUTORY' });
    }

    // Post-tax deductions of the extras (one-time recoveries, net negative
    // arrears): after the statutory lines, before the loans.
    deductions.push(...extra.deductions);

    // 10. Loan and salary-advance instalments, taken after the statutory
    // deductions so the clamp below only ever eats into take-home pay.
    const statutoryAndComponents = money(
      totalDeductions.add(statutory.totalEmployeeDeductions),
    );
    const beforeLoans = money(statutoryAndComponents.add(extra.postTaxDeductions));
    const loanRepayments = deductLoans
      ? this.applyLoanDeductions(
          employeeId,
          deductions,
          money(grossPay.add(extra.nonTaxableEarnings).sub(beforeLoans)),
          await this.loansService.getPayrollDeductions(
            tenantId,
            employeeId,
            month,
            year,
          ),
        )
      : [];
    const loanTotal = loanRepayments.reduce(
      (sum, line) => sum.add(new Decimal(line.amount)),
      new Decimal(0),
    );

    const allDeductions = money(beforeLoans.add(loanTotal));
    const netPay = money(grossPay.add(extra.nonTaxableEarnings).sub(allDeductions));

    return {
      employeeId,
      workingDays,
      presentDays: regular?.presentDays ?? 0,
      leaveDays: regular?.totalLeaveDays ?? 0,
      lopDays: regular?.lopDays ?? 0,
      otHours,
      basePay: proratedBasePay,
      earnings,
      deductions,
      grossPay,
      totalDeductions: allDeductions,
      netPay,
      otPay,
      nonRecurringTaxable: extra.nonRecurringTaxable,
      nonTaxableEarnings: extra.nonTaxableEarnings,
      arrearsAmount: extra.arrearsAmount,
      reimbursementAmount: extra.reimbursementAmount,
      statutory,
      loanRepayments,
    };
  }

  /**
   * A month's regular earnings (basic + component earnings, prorated with the
   * month's attendance and loss of pay, no OT, no statutory) with one given
   * salary row. Used to value a backdated revision against what was paid
   * (spec C1). Null when the row is not this employee's in this tenant.
   */
  async calculateRegularEarnings(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
    employeeSalaryId: string,
  ): Promise<RegularEarnings | null> {
    const salary = await this.prisma.employeeSalary.findFirst({
      where: { id: employeeSalaryId, tenantId, employeeId },
      include: { salaryStructure: true },
    });
    if (!salary) return null;

    const regular = await this.regularPart(tenantId, employeeId, month, year, salary);
    const total = regular.earnings.reduce(
      (sum, e) => sum.add(e.amount),
      regular.proratedBasePay,
    );
    const pfApplicableNames = regular.components
      .filter((c) => c.type === 'earning' && c.pfApplicable)
      .map((c) => c.name);
    const pfWages = regular.earnings
      .filter((e) => pfApplicableNames.includes(e.name))
      .reduce((sum, e) => sum.add(e.amount), regular.proratedBasePay);

    return {
      employeeSalaryId: salary.id,
      basePay: regular.proratedBasePay,
      earnings: regular.earnings,
      total: money(total),
      pfWages: money(pfWages),
      pfApplicableNames,
    };
  }

  /**
   * Steps 2-6 of the payslip: working days, leave, attendance, the pro-rate
   * factor, prorated base pay and the structure's component lines. Shared by
   * the payslip and by arrears detection so both value a month the same way.
   */
  private async regularPart(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
    salary: { basePay: Decimal.Value | { toString(): string }; salaryStructure: { components: unknown } },
  ) {
    const basePay = new Decimal(salary.basePay as Decimal.Value);
    const components = (salary.salaryStructure.components as unknown as SalaryComponent[]) || [];

    // 2. Calculate working days (total calendar days minus weekends and holidays)
    const { workingDays, holidayDates } = await this.getWorkingDays(
      tenantId,
      month,
      year,
    );

    // 3. Get leave data (approved paid and unpaid, excluding holidays). This
    // runs before attendance because the days it already charged as unpaid
    // leave must not be charged a second time as absences.
    const {
      paidLeaveDays,
      lopDays: leaveLopDays,
      lopDates,
    } = await this.getLeaveData(tenantId, employeeId, month, year, holidayDates);

    // 4. Get attendance data for the month
    const { presentDays, otMinutes, absentLopDays } = await this.getAttendanceData(
      tenantId,
      employeeId,
      month,
      year,
      lopDates,
    );

    // Days marked ABSENT are loss of pay in their own right when the tenant's
    // attendance policy says so, on top of any unpaid leave.
    const lopDays = leaveLopDays + absentLopDays;

    // Total leave days (paid + unpaid)
    const totalLeaveDays = paidLeaveDays + lopDays;

    // Effective present = actual attendance + paid leaves (capped at working days)
    const effectivePresentDays = Math.min(
      presentDays + paidLeaveDays,
      workingDays,
    );

    // Pro-rate factor: what fraction of the month the employee was effectively
    // present. Kept unrounded so the division error does not enter every
    // downstream figure; only final money amounts are rounded.
    const proRateFactor =
      workingDays > 0
        ? new Decimal(effectivePresentDays).div(workingDays)
        : new Decimal(0);

    // 5. Calculate pro-rated base pay
    const proratedBasePay = money(basePay.mul(proRateFactor));

    // 6. Calculate component earnings and deductions
    const earnings: { name: string; amount: Decimal }[] = [];
    const deductions: { name: string; amount: Decimal }[] = [];

    for (const comp of components) {
      const amount =
        comp.calcType === 'percentage'
          ? money(proratedBasePay.mul(new Decimal(comp.value).div(100)))
          : // Fixed amounts are pro-rated too
            money(new Decimal(comp.value).mul(proRateFactor));

      if (comp.type === 'earning') {
        earnings.push({ name: comp.name, amount });
      } else {
        deductions.push({ name: comp.name, amount });
      }
    }

    return {
      components,
      workingDays,
      presentDays,
      totalLeaveDays,
      lopDays,
      otMinutes,
      proratedBasePay,
      earnings,
      deductions,
    };
  }

  /**
   * The payslip lines and totals of the wave C extras (spec C.0-C4).
   *
   * Arrears are netted per employee: positive is one taxable, non-recurring
   * earning line; negative is one post-tax deduction line (a documented
   * simplification — it does not reduce the taxable gross). One-time
   * earnings are taxable (gross, non-recurring) or not (on top of gross);
   * one-time deductions are post-tax. Reimbursements and released holds are
   * untaxed, on top of gross.
   */
  private extrasLines(extras: PayslipExtras, month: number, year: number) {
    const zero = new Decimal(0);
    const earnings: PayslipLineData[] = [];
    const deductions: PayslipLineData[] = [];
    let taxableEarnings = zero;
    let nonTaxableEarnings = zero;
    let nonRecurringTaxable = zero;
    let postTaxDeductions = zero;
    let arrearsAmount = zero;
    let reimbursementAmount = zero;
    let pfWagesDelta = zero;
    let priorYearArrears: { amount: Decimal; financialYears: number[] } | undefined;

    const arrears = extras.arrears ?? [];
    if (arrears.length > 0) {
      const net = money(arrears.reduce((sum, a) => sum.add(a.amount), zero));
      if (net.gt(0)) {
        earnings.push({ name: ARREARS_LINE_NAME, amount: net, kind: 'ARREAR', taxable: true });
        taxableEarnings = taxableEarnings.add(net);
        nonRecurringTaxable = nonRecurringTaxable.add(net);
        arrearsAmount = net;

        const pf = arrears.reduce((sum, a) => sum.add(a.pfWagesDelta), zero);
        pfWagesDelta = pf.gt(0) ? money(pf) : zero;

        // Arrears of earlier financial years may be relieved under section
        // 89; never more than the net arrears actually paid.
        const runFy = financialYearOf(month, year);
        const prior = arrears.filter((a) => a.financialYear < runFy);
        const priorAmount = money(prior.reduce((sum, a) => sum.add(a.amount), zero));
        if (priorAmount.gt(0)) {
          priorYearArrears = {
            amount: Decimal.min(priorAmount, net),
            financialYears: [...new Set(prior.map((a) => a.financialYear))].sort((a, b) => a - b),
          };
        }
      } else if (net.lt(0)) {
        const recovery = net.neg();
        deductions.push({ name: ARREARS_RECOVERY_LINE_NAME, amount: recovery, kind: 'ARREAR' });
        postTaxDeductions = postTaxDeductions.add(recovery);
      }
    }

    for (const payment of extras.oneTimePayments ?? []) {
      const amount = money(new Decimal(payment.amount));
      if (isOneTimeEarning(payment.kind)) {
        earnings.push({
          name: payment.name,
          amount,
          kind: 'ONE_TIME',
          taxable: payment.taxable,
          refId: payment.id,
        });
        if (payment.taxable) {
          taxableEarnings = taxableEarnings.add(amount);
          nonRecurringTaxable = nonRecurringTaxable.add(amount);
        } else {
          nonTaxableEarnings = nonTaxableEarnings.add(amount);
        }
      } else {
        deductions.push({ name: payment.name, amount, kind: 'ONE_TIME', refId: payment.id });
        postTaxDeductions = postTaxDeductions.add(amount);
      }
    }

    const claims = extras.reimbursements ?? [];
    if (claims.length > 0) {
      reimbursementAmount = money(claims.reduce((sum, c) => sum.add(c.amount), zero));
      if (reimbursementAmount.gt(0)) {
        earnings.push({
          name: REIMBURSEMENT_LINE_NAME,
          amount: reimbursementAmount,
          kind: 'REIMBURSEMENT',
          taxable: false,
        });
        nonTaxableEarnings = nonTaxableEarnings.add(reimbursementAmount);
      }
    }

    for (const release of extras.holdReleases ?? []) {
      const amount = money(new Decimal(release.amount));
      if (amount.lte(0)) continue;
      earnings.push({
        name: holdReleaseLineName(release.heldMonth, release.heldYear),
        amount,
        kind: 'HOLD_RELEASE',
        taxable: false,
        refId: release.id,
      });
      nonTaxableEarnings = nonTaxableEarnings.add(amount);
    }

    return {
      earnings,
      deductions,
      taxableEarnings: money(taxableEarnings),
      nonTaxableEarnings: money(nonTaxableEarnings),
      nonRecurringTaxable: money(nonRecurringTaxable),
      postTaxDeductions: money(postTaxDeductions),
      arrearsAmount,
      reimbursementAmount,
      pfWagesDelta,
      priorYearArrears,
    };
  }

  /**
   * The regular salary an off-cycle run projects the rest of the year on, and
   * how many months of it are still to be paid: the months left in the
   * financial year, less this one when the month's regular run has already
   * paid the employee.
   */
  private async offCycleProjection(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
  ): Promise<{ regularMonthlyGross: Decimal; monthsAhead: number }> {
    const salary = await this.prisma.employeeSalary.findFirst({
      where: {
        tenantId,
        employeeId,
        isActive: true,
        effectiveFrom: { lte: new Date(year, month - 1, 28) },
        OR: [
          { effectiveTo: null },
          { effectiveTo: { gte: new Date(year, month - 1, 1) } },
        ],
      },
      include: { salaryStructure: true },
    });
    const regular = salary
      ? await this.regularPart(tenantId, employeeId, month, year, salary)
      : null;
    const regularMonthlyGross = regular
      ? money(regular.earnings.reduce((sum, e) => sum.add(e.amount), regular.proratedBasePay))
      : new Decimal(0);

    const paidThisMonth = await this.prisma.payslip.findFirst({
      where: {
        tenantId,
        employeeId,
        payrollRun: { month, year, runType: 'REGULAR' },
      },
      select: { id: true },
    });
    const remaining = monthsRemainingInFy(month);
    return {
      regularMonthlyGross,
      monthsAhead: paidThisMonth ? remaining - 1 : remaining,
    };
  }

  /**
   * An off-cycle payslip carrying a settlement copies it verbatim (spec C5):
   * no recalculation, the settlement's TDS as the payslip's, and its loan
   * recovery already recorded against the loans when it was approved. The
   * payslip must pay exactly the settlement's net, or the run is refused.
   */
  private settlementPayslip(employeeId: string, s: SettlementExtra): PayslipData {
    const zero = new Decimal(0);
    const d = (v: Decimal.Value) => money(new Decimal(v));
    const earnings: PayslipLineData[] = [];
    const deductions: PayslipLineData[] = [];
    let gross = zero;
    let exempt = zero;

    const earn = (name: string, amount: Decimal, taxable: boolean) => {
      if (amount.lte(0)) return;
      earnings.push({ name, amount, kind: 'SETTLEMENT', taxable, refId: s.id });
      if (taxable) gross = gross.add(amount);
      else exempt = exempt.add(amount);
    };
    const encashExempt = d(s.leaveEncashmentExempt);
    const gratuityExempt = d(s.gratuityExempt);
    earn('Pro-rata salary', d(s.proRataSalary), true);
    earn('Leave encashment', money(d(s.leaveEncashment).sub(encashExempt)), true);
    earn('Leave encashment (exempt)', encashExempt, false);
    earn('Gratuity', money(d(s.gratuity).sub(gratuityExempt)), true);
    earn('Gratuity (exempt)', gratuityExempt, false);
    earn('Other earnings', d(s.otherEarnings), true);

    const deduct = (name: string, amount: Decimal, kind: PayslipLineKind) => {
      if (amount.gt(0)) deductions.push({ name, amount, kind, refId: s.id });
    };
    const notice = d(s.noticeRecovery);
    const other = d(s.otherRecoveries);
    const loan = money(d(s.totalRecoveries).sub(notice).sub(other));
    const tds = d(s.tds);
    deduct('Notice pay recovery', notice, 'SETTLEMENT');
    deduct('Other recoveries', other, 'SETTLEMENT');
    deduct('Loan recovery', loan, 'LOAN');
    if (tds.gt(0)) deductions.push({ name: 'TDS', amount: tds, kind: 'STATUTORY' });

    const grossPay = money(gross);
    const nonTaxableEarnings = money(exempt);
    const totalDeductions = money(deductions.reduce((sum, x) => sum.add(x.amount), zero));
    const netPay = money(grossPay.add(nonTaxableEarnings).sub(totalDeductions));

    if (!netPay.eq(d(s.netPayable))) {
      throw new BadRequestException(
        `The payslip for settlement ${s.id} does not match the settlement: it would pay ${netPay.toFixed(2)} against a net payable of ${d(s.netPayable).toFixed(2)}. Recompute and re-approve the settlement.`,
      );
    }

    return {
      employeeId,
      workingDays: 0,
      presentDays: 0,
      leaveDays: 0,
      lopDays: 0,
      otHours: zero,
      basePay: zero,
      earnings,
      deductions,
      grossPay,
      totalDeductions,
      netPay,
      otPay: zero,
      nonRecurringTaxable: grossPay,
      nonTaxableEarnings,
      arrearsAmount: zero,
      reimbursementAmount: zero,
      statutory: {
        pfWages: zero,
        pfEmployee: zero,
        pfEmployer: zero,
        epsEmployer: zero,
        edliEmployer: zero,
        pfAdminEmployer: zero,
        esiWages: zero,
        esiEmployee: zero,
        esiEmployer: zero,
        professionalTax: zero,
        lwfEmployee: zero,
        lwfEmployer: zero,
        tds,
        taxComputation: {
          source: 'SETTLEMENT',
          settlementId: s.id,
          note: 'Copied from the approved full and final settlement; its tax working is on the settlement.',
        },
        totalEmployeeDeductions: tds,
      },
      loanRepayments: [],
    };
  }

  /**
   * Push one deduction line per outstanding instalment and report what was
   * actually taken.
   *
   * Payroll may not pay an employee a negative salary to service a loan. Where
   * the instalments together exceed what is left after every other deduction,
   * they are reduced — the last scheduled line first, so the oldest loan is
   * serviced in preference to the newest — until net pay lands exactly on
   * zero. The shortfall is logged rather than swallowed, because a loan that
   * silently misses an instalment falls behind its schedule and nothing else
   * in the system would say so.
   *
   * The amounts returned are the reduced ones. They are what gets written back
   * against each loan, so a clamped month reduces the balance by what the
   * payslip shows and no more.
   */
  private applyLoanDeductions(
    employeeId: string,
    deductions: PayslipLineData[],
    netBeforeLoans: Decimal,
    scheduled: { lines: { loanId: string; type: LoanType; amount: number }[] },
  ): PayrollRepaymentLine[] {
    if (scheduled.lines.length === 0) return [];

    // A payslip already at or below zero can service nothing at all.
    const available = Decimal.max(netBeforeLoans, new Decimal(0));
    const applied = scheduled.lines.map((line) => ({
      ...line,
      amount: new Decimal(line.amount),
    }));

    const requested = applied.reduce(
      (sum, line) => sum.add(line.amount),
      new Decimal(0),
    );
    let shortfall = requested.sub(available);
    if (shortfall.gt(0)) {
      this.logger.warn(
        `Loan instalments for employee ${employeeId} exceed net pay by ${shortfall.toFixed(2)}; deductions reduced so net pay is not negative`,
      );
      for (let i = applied.length - 1; i >= 0 && shortfall.gt(0); i--) {
        const cut = Decimal.min(applied[i].amount, shortfall);
        applied[i].amount = applied[i].amount.sub(cut);
        shortfall = shortfall.sub(cut);
      }
    }

    const recorded: PayrollRepaymentLine[] = [];
    for (const line of applied) {
      const amount = money(line.amount);
      if (amount.lte(0)) continue;
      deductions.push({
        name:
          line.type === LoanType.SALARY_ADVANCE
            ? 'Salary advance recovery'
            : 'Loan EMI',
        amount,
        kind: 'LOAN',
      });
      recorded.push({ loanId: line.loanId, amount: amount.toNumber() });
    }
    return recorded;
  }

  /**
   * What the month pays under each section 10 allowance head.
   *
   * Returns undefined where no earning carries a head, so an employer who has
   * marked nothing is computed exactly as before — the statutory engine is not
   * told about allowances at all, rather than told there are none.
   *
   * Where anything is marked, all three heads are reported, including the ones
   * nothing is marked under: a head at nought exempts nothing, which is the
   * rule. Marking one component therefore opts the whole of section 10(5) and
   * 10(14) into being capped at what was received.
   */
  private section10AllowancesPaid(
    components: SalaryComponent[],
    earnings: { name: string; amount: Decimal }[],
  ): Section10AllowancesInput | undefined {
    const marked = components.filter((c) => c.type === 'earning' && c.section10Head);
    if (marked.length === 0) return undefined;

    const paidThisMonth: Section10AllowancesPaid = {};
    const componentNames = {} as Record<Section10ComponentHead, string[]>;

    for (const head of SECTION_10_HEADS) {
      const names = marked.filter((c) => c.section10Head === head).map((c) => c.name);
      componentNames[head] = names;
      paidThisMonth[SECTION_10_HEAD_TO_ALLOWANCE_KEY[head]] = names.reduce(
        (sum, name) => {
          const line = earnings.find((e) => e.name === name);
          return line ? sum.add(line.amount) : sum;
        },
        new Decimal(0),
      );
    }

    return { paidThisMonth, componentNames };
  }

  private async getWorkingDays(
    tenantId: string,
    month: number,
    year: number,
  ): Promise<{ workingDays: number; holidayDates: Set<string> }> {
    const { startDate, endDate } = monthWindowUtc(month, year);
    const totalDaysInMonth = endDate.getUTCDate();

    // Count weekends (Saturday + Sunday)
    let weekendDays = 0;
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const day = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
      if (day === 0 || day === 6) weekendDays++;
    }

    // Count holidays that fall on weekdays and collect their dates
    const holidayRecords = await this.prisma.holiday.findMany({
      where: {
        tenantId,
        isActive: true,
        date: { gte: startDate, lte: endDate },
      },
    });

    const holidayDates = new Set<string>();
    for (const h of holidayRecords) {
      const hDate = new Date(h.date);
      const day = hDate.getUTCDay();
      if (day !== 0 && day !== 6) {
        holidayDates.add(hDate.toISOString().split('T')[0]);
      }
    }

    const workingDays = totalDaysInMonth - weekendDays - holidayDates.size;
    return { workingDays, holidayDates };
  }

  private async getAttendanceData(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
    /** Days already charged as unpaid leave; an ABSENT row on one of these
     * days is the same lost day, not a second one. */
    lopDates: Set<string> = new Set(),
  ): Promise<{ presentDays: number; otMinutes: number; absentLopDays: number }> {
    const { startDate, endDate } = monthWindowUtc(month, year);

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        employeeId,
        date: { gte: startDate, lte: endDate },
        status: { in: ['PRESENT', 'WFH', 'ON_DUTY', 'HALF_DAY', 'ABSENT'] },
      },
    });

    let presentDays = 0;
    let otMinutes = 0;
    let absentDays = 0;

    for (const r of records) {
      if (r.status === 'ABSENT') {
        // An absence earns nothing and contributes no OT. A day that approved
        // unpaid leave already charged is skipped outright: one missing day
        // may only cost one day's pay, however it came to be recorded twice.
        if (!lopDates.has(new Date(r.date).toISOString().split('T')[0])) {
          absentDays += 1;
        }
        continue;
      }
      if (r.status === 'HALF_DAY') {
        // Half days stay half present; they do not also book half a LOP day.
        presentDays += 0.5;
      } else {
        presentDays += 1;
      }
      // Use approved OT if available, otherwise calculated
      otMinutes += r.otMinutesApproved ?? r.otMinutesCalculated;
    }

    // Only ask for the policy when there is something for it to decide.
    let absentLopDays = 0;
    if (absentDays > 0) {
      const policy = await this.prisma.attendancePolicy.findUnique({
        where: { tenantId },
        select: { absentIsLop: true },
      });
      // No policy row yet means the schema default, which is "absent costs pay".
      if (policy?.absentIsLop ?? true) absentLopDays = absentDays;
    }

    return { presentDays, otMinutes, absentLopDays };
  }

  private async getLeaveData(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
    holidayDates: Set<string>,
  ): Promise<{ paidLeaveDays: number; lopDays: number; lopDates: Set<string> }> {
    const { startDate, endDate } = monthWindowUtc(month, year);

    const leaveRequests = await this.prisma.leaveRequest.findMany({
      where: {
        tenantId,
        employeeId,
        status: 'APPROVED',
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      include: {
        leaveType: { select: { isPaid: true } },
      },
    });

    let paidLeaveDays = 0;
    let lopDays = 0;
    // The exact days charged as unpaid leave, so attendance can avoid
    // double-charging them.
    const lopDates = new Set<string>();

    for (const lr of leaveRequests) {
      // Calculate overlap with this month
      const overlapStart = new Date(
        Math.max(startDate.getTime(), new Date(lr.startDate).getTime()),
      );
      const overlapEnd = new Date(
        Math.min(endDate.getTime(), new Date(lr.endDate).getTime()),
      );

      // Count weekdays in overlap range, excluding holidays
      const isPaid = lr.leaveType.isPaid;
      let days = 0;
      const current = new Date(overlapStart);
      while (current <= overlapEnd) {
        // UTC throughout, to match the UTC-midnight window and the
        // `toISOString()` key the attendance side guards on.
        const day = current.getUTCDay();
        const dateStr = current.toISOString().split('T')[0];
        if (day !== 0 && day !== 6 && !holidayDates.has(dateStr)) {
          days++;
          if (!isPaid) lopDates.add(dateStr);
        }
        current.setUTCDate(current.getUTCDate() + 1);
      }

      if (isPaid) {
        paidLeaveDays += days;
      } else {
        lopDays += days;
      }
    }

    return { paidLeaveDays, lopDays, lopDates };
  }
}
