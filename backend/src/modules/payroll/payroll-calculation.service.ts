import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { StatutoryService, StatutoryResult } from './statutory/statutory.service';

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
  earnings: { name: string; amount: Decimal }[];
  deductions: { name: string; amount: Decimal }[];
  grossPay: Decimal;
  totalDeductions: Decimal;
  netPay: Decimal;
  otPay: Decimal;
  /** Indian statutory deductions and employer contributions for the month. */
  statutory: StatutoryResult;
}

/** Round to paise, half-up, which is the commercial convention. */
function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

@Injectable()
export class PayrollCalculationService {
  constructor(
    private prisma: PrismaService,
    private statutoryService: StatutoryService,
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

    // 3. Get attendance data for the month
    const { presentDays, otMinutes } = await this.getAttendanceData(
      tenantId,
      employeeId,
      month,
      year,
    );

    // 4. Get leave data (approved paid and unpaid, excluding holidays)
    const { paidLeaveDays, lopDays } = await this.getLeaveData(
      tenantId,
      employeeId,
      month,
      year,
      holidayDates,
    );

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

    const statutory = await this.statutoryService.compute({
      tenantId,
      employeeId,
      month,
      year,
      pfWages,
      grossPay,
      pfOptOut: salary.employee.pfOptOut,
      gender: salary.employee.gender,
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

    const allDeductions = money(totalDeductions.add(statutory.totalEmployeeDeductions));
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
    };
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
  ): Promise<{ presentDays: number; otMinutes: number }> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        employeeId,
        date: { gte: startDate, lte: endDate },
        status: { in: ['PRESENT', 'WFH', 'HALF_DAY'] },
      },
    });

    let presentDays = 0;
    let otMinutes = 0;

    for (const r of records) {
      if (r.status === 'HALF_DAY') {
        presentDays += 0.5;
      } else {
        presentDays += 1;
      }
      // Use approved OT if available, otherwise calculated
      otMinutes += r.otMinutesApproved ?? r.otMinutesCalculated;
    }

    return { presentDays, otMinutes };
  }

  private async getLeaveData(
    tenantId: string,
    employeeId: string,
    month: number,
    year: number,
    holidayDates: Set<string>,
  ): Promise<{ paidLeaveDays: number; lopDays: number }> {
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

    for (const lr of leaveRequests) {
      // Calculate overlap with this month
      const overlapStart = new Date(
        Math.max(startDate.getTime(), new Date(lr.startDate).getTime()),
      );
      const overlapEnd = new Date(
        Math.min(endDate.getTime(), new Date(lr.endDate).getTime()),
      );

      // Count weekdays in overlap range, excluding holidays
      let days = 0;
      const current = new Date(overlapStart);
      while (current <= overlapEnd) {
        const day = current.getDay();
        const dateStr = current.toISOString().split('T')[0];
        if (day !== 0 && day !== 6 && !holidayDates.has(dateStr)) days++;
        current.setDate(current.getDate() + 1);
      }

      if (lr.leaveType.isPaid) {
        paidLeaveDays += days;
      } else {
        lopDays += days;
      }
    }

    return { paidLeaveDays, lopDays };
  }
}
