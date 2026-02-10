import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';

interface SalaryComponent {
  name: string;
  type: 'earning' | 'deduction';
  calcType: 'fixed' | 'percentage';
  value: number;
}

interface PayslipData {
  employeeId: string;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  lopDays: number;
  otHours: number;
  basePay: number;
  earnings: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  otPay: number;
}

@Injectable()
export class PayrollCalculationService {
  constructor(private prisma: PrismaService) {}

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
          },
        },
      },
    });

    if (!salary) return null;

    const basePay = Number(salary.basePay);
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

    // Pro-rate factor: what fraction of the month the employee was effectively present
    const proRateFactor =
      workingDays > 0 ? effectivePresentDays / workingDays : 0;

    // 5. Calculate pro-rated base pay
    const proratedBasePay = Math.round(basePay * proRateFactor * 100) / 100;

    // 6. Calculate component earnings and deductions
    const earnings: { name: string; amount: number }[] = [];
    const deductions: { name: string; amount: number }[] = [];

    for (const comp of components) {
      let amount: number;
      if (comp.calcType === 'percentage') {
        amount = Math.round(proratedBasePay * (comp.value / 100) * 100) / 100;
      } else {
        // Fixed amounts also pro-rated
        amount = Math.round(comp.value * proRateFactor * 100) / 100;
      }

      if (comp.type === 'earning') {
        earnings.push({ name: comp.name, amount });
      } else {
        deductions.push({ name: comp.name, amount });
      }
    }

    // 7. Calculate OT pay
    const otHours = Math.round((otMinutes / 60) * 100) / 100;
    let otPay = 0;
    if (otHours > 0 && basePay > 0) {
      // Hourly equivalent = basePay / (workingDays * 8)
      const hourlyRate =
        salary.employee.payType === 'HOURLY' && salary.employee.hourlyRate
          ? Number(salary.employee.hourlyRate)
          : workingDays > 0
            ? basePay / (workingDays * 8)
            : 0;
      const otMultiplier = Number(salary.employee.otMultiplier);
      otPay = Math.round(otHours * hourlyRate * otMultiplier * 100) / 100;
    }

    // 8. Calculate totals
    const totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);
    const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
    const grossPay =
      Math.round((proratedBasePay + totalEarnings + otPay) * 100) / 100;
    const netPay = Math.round((grossPay - totalDeductions) * 100) / 100;

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
      totalDeductions,
      netPay,
      otPay,
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
