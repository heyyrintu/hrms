import { Injectable, Logger } from '@nestjs/common';
import { LoanType } from '@prisma/client';
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
  earnings: { name: string; amount: Decimal }[];
  deductions: { name: string; amount: Decimal }[];
  grossPay: Decimal;
  totalDeductions: Decimal;
  netPay: Decimal;
  otPay: Decimal;
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

@Injectable()
export class PayrollCalculationService {
  private readonly logger = new Logger(PayrollCalculationService.name);

  constructor(
    private prisma: PrismaService,
    private statutoryService: StatutoryService,
    private loansService: LoansService,
  ) {}

  async calculateForEmployee(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
  ): Promise<PayslipData | null> {
    // 1. Get active salary assignment
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
    });

    if (!salary) return null;

    const basePay = new Decimal(salary.basePay);
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

    // 7. Calculate OT pay
    const otHours = new Decimal(otMinutes)
      .div(60)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    let otPay = new Decimal(0);
    if (otHours.gt(0) && basePay.gt(0)) {
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
    const grossPay = money(proratedBasePay.add(totalEarnings).add(otPay));

    // 9. Statutory deductions, which need the gross to be known first.
    // Provident fund is computed on basic plus any component the structure
    // marks as forming part of PF wages, not on gross.
    const pfWages = components
      .filter((c) => c.type === 'earning' && c.pfApplicable)
      .reduce((sum, comp) => {
        const line = earnings.find((e) => e.name === comp.name);
        return line ? sum.add(line.amount) : sum;
      }, proratedBasePay);

    // What this month actually pays under each section 10 allowance head, and
    // through which earning lines, so the year to date can be summed from the
    // payslips already run. Matched by name against the month's earnings the
    // same way provident fund wages are, so the figure passed is the figure on
    // the payslip, pro-rating and all.
    //
    // Only an *earning* can carry a head: section 10 exempts an allowance
    // received, and a deduction is not one. Undefined when the structure marks
    // nothing, which leaves every exemption exactly where it was.
    const section10Allowances = this.section10AllowancesPaid(components, earnings);

    const statutory = await this.statutoryService.compute({
      tenantId,
      employeeId,
      month,
      year,
      pfWages,
      grossPay,
      ...(section10Allowances ? { section10Allowances } : {}),
      pfOptOut: salary.employee.pfOptOut,
      gender: salary.employee.gender,
      dateOfBirth: salary.employee.dateOfBirth,
      employeeRegime: salary.employee.taxRegime,
    });

    for (const [name, amount] of [
      ['Provident Fund', statutory.pfEmployee],
      ['ESI', statutory.esiEmployee],
      ['Professional Tax', statutory.professionalTax],
      ['Labour Welfare Fund', statutory.lwfEmployee],
      ['TDS', statutory.tds],
    ] as const) {
      if (amount.gt(0)) deductions.push({ name, amount });
    }

    // 10. Loan and salary-advance instalments, taken after the statutory
    // deductions so the clamp below only ever eats into take-home pay.
    const statutoryAndComponents = money(
      totalDeductions.add(statutory.totalEmployeeDeductions),
    );
    const loanRepayments = this.applyLoanDeductions(
      employeeId,
      deductions,
      money(grossPay.sub(statutoryAndComponents)),
      await this.loansService.getPayrollDeductions(
        tenantId,
        employeeId,
        month,
        year,
      ),
    );
    const loanTotal = loanRepayments.reduce(
      (sum, line) => sum.add(new Decimal(line.amount)),
      new Decimal(0),
    );

    const allDeductions = money(statutoryAndComponents.add(loanTotal));
    const netPay = money(grossPay.sub(allDeductions));

    return {
      employeeId,
      workingDays,
      presentDays,
      leaveDays: totalLeaveDays,
      lopDays,
      otHours,
      basePay: proratedBasePay,
      earnings,
      deductions,
      grossPay,
      totalDeductions: allDeductions,
      netPay,
      otPay,
      statutory,
      loanRepayments,
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
    deductions: { name: string; amount: Decimal }[],
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
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    const totalDaysInMonth = endDate.getDate();

    // Count weekends (Saturday + Sunday)
    let weekendDays = 0;
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const day = new Date(year, month - 1, d).getDay();
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
      const day = hDate.getDay();
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
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        employeeId,
        date: { gte: startDate, lte: endDate },
        status: { in: ['PRESENT', 'WFH', 'HALF_DAY', 'ABSENT'] },
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
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

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
        const day = current.getDay();
        const dateStr = current.toISOString().split('T')[0];
        if (day !== 0 && day !== 6 && !holidayDates.has(dateStr)) {
          days++;
          if (!isPaid) lopDates.add(dateStr);
        }
        current.setDate(current.getDate() + 1);
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
