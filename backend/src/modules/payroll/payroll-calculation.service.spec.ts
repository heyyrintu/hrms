import { Test, TestingModule } from '@nestjs/testing';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { Decimal } from '@prisma/client/runtime/library';
import { StatutoryService } from './statutory/statutory.service';

const zero = () => new Decimal(0);

/** Statutory deductions off by default, so these tests stay about the base pay maths. */
function noStatutory() {
  return {
    pfWages: zero(), pfEmployee: zero(), pfEmployer: zero(), epsEmployer: zero(),
    edliEmployer: zero(), pfAdminEmployer: zero(), esiWages: zero(),
    esiEmployee: zero(), esiEmployer: zero(), professionalTax: zero(),
    lwfEmployee: zero(), lwfEmployer: zero(), tds: zero(),
    taxComputation: null, totalEmployeeDeductions: zero(),
  };
}

// Money is returned as Decimal; compare on plain numbers for readability.
const toPlainAmounts = (rows: { name: string; amount: unknown }[]) =>
  rows.map((r) => ({ name: r.name, amount: Number(r.amount) }));

describe('PayrollCalculationService', () => {
  let service: PayrollCalculationService;
  let prisma: any;
  let statutory: { compute: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';
  const month = 1; // January
  const year = 2026;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollCalculationService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: StatutoryService,
          useValue: { compute: jest.fn().mockResolvedValue(noStatutory()) },
        },
      ],
    }).compile();

    service = module.get<PayrollCalculationService>(PayrollCalculationService);
    prisma = module.get(PrismaService);
    statutory = module.get(StatutoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // calculateForEmployee - null case
  // ============================================

  describe('calculateForEmployee - no salary assigned', () => {
    it('should return null when employee has no active salary', async () => {
      prisma.employeeSalary.findFirst.mockResolvedValue(null);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).toBeNull();
    });
  });

  // ============================================
  // calculateForEmployee - full calculation
  // ============================================

  describe('calculateForEmployee - with salary', () => {
    const mockSalary = {
      id: 'es-1',
      tenantId,
      employeeId,
      basePay: 50000, // BigDecimal stored as number
      isActive: true,
      salaryStructure: {
        id: 'ss-1',
        name: 'Standard',
        components: [
          { name: 'HRA', type: 'earning', calcType: 'percentage', value: 40 },
          { name: 'Conveyance', type: 'earning', calcType: 'fixed', value: 1600 },
          { name: 'PF', type: 'deduction', calcType: 'percentage', value: 12 },
        ],
      },
      employee: {
        otMultiplier: 1.5,
        payType: 'MONTHLY',
        hourlyRate: null,
      },
    };

    beforeEach(() => {
      prisma.employeeSalary.findFirst.mockResolvedValue(mockSalary);
    });

    it('tells the statutory engine the date of birth, or seniors get the wrong slabs', async () => {
      // The old regime's basic exemption is higher at 60 and higher again at
      // 80. The engine reads the band from the date of birth, so withholding
      // it here taxes every senior employee at the general rate and nothing
      // anywhere says so.
      const dateOfBirth = new Date('1960-06-15T00:00:00.000Z');
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.attendanceRecord.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.employeeSalary.findFirst.mockResolvedValue({
        ...mockSalary,
        employee: { ...mockSalary.employee, dateOfBirth },
      });

      await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(statutory.compute).toHaveBeenCalledWith(
        expect.objectContaining({ dateOfBirth }),
      );
    });

    it('asks the database for the date of birth in the first place', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.attendanceRecord.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      await service.calculateForEmployee(tenantId, employeeId, month, year);

      const args = prisma.employeeSalary.findFirst.mock.calls[0][0];
      expect(args.include.employee.select.dateOfBirth).toBe(true);
    });

    it('should compute provident fund on basic plus flagged components, not on gross', async () => {
      prisma.employeeSalary.findFirst.mockResolvedValue({
        ...mockSalary,
        basePay: 20000,
        salaryStructure: {
          ...mockSalary.salaryStructure,
          components: [
            // Dearness allowance forms part of PF wages; HRA does not.
            { name: 'DA', type: 'earning', calcType: 'fixed', value: 5000, pfApplicable: true },
            { name: 'HRA', type: 'earning', calcType: 'fixed', value: 8000 },
          ],
        },
      });
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 22 }, (_, i) => ({
          status: 'PRESENT', date: new Date(2026, 0, i + 1),
          otMinutesApproved: 0, otMinutesCalculated: 0,
        })),
      );
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      await service.calculateForEmployee(tenantId, employeeId, month, year);

      // 20,000 basic + 5,000 DA. The 8,000 HRA is excluded.
      expect(statutory.compute).toHaveBeenCalledWith(
        expect.objectContaining({ pfWages: expect.anything() }),
      );
      expect(statutory.compute.mock.calls[0][0].pfWages.toString()).toBe('25000');
      expect(statutory.compute.mock.calls[0][0].grossPay.toString()).toBe('33000');
    });

    it('should subtract statutory deductions from net pay and list them on the payslip', async () => {
      statutory.compute.mockResolvedValue({
        ...noStatutory(),
        pfEmployee: new Decimal(1800),
        professionalTax: new Decimal(200),
        tds: new Decimal(3000),
        totalEmployeeDeductions: new Decimal(5000),
      });
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 22 }, (_, i) => ({
          status: 'PRESENT', date: new Date(2026, 0, i + 1),
          otMinutesApproved: 0, otMinutesCalculated: 0,
        })),
      );
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      const names = result!.deductions.map((x) => x.name);
      expect(names).toEqual(expect.arrayContaining(['Provident Fund', 'Professional Tax', 'TDS']));
      // Existing PF component of 6,000 from the structure, plus the 5,000 statutory
      expect(Number(result!.totalDeductions)).toBe(11000);
      expect(Number(result!.netPay)).toBe(Number(result!.grossPay) - 11000);
    });

    it('should round a half-cent component up instead of losing it to binary floating point', async () => {
      // 1% of 14.50 is exactly 0.145, which must round to 0.15. In float,
      // 0.145 * 100 is 14.499999999999998, so Math.round(x * 100) / 100 yields
      // 0.14 and a cent disappears from every payslip carrying this shape.
      prisma.employeeSalary.findFirst.mockResolvedValue({
        ...mockSalary,
        basePay: 14.5,
        salaryStructure: {
          ...mockSalary.salaryStructure,
          components: [
            { name: 'Allowance', type: 'earning', calcType: 'percentage', value: 1 },
          ],
        },
      });
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 22 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(2026, 0, i + 1),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
      );
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result!.earnings[0].amount.toString()).toBe('0.15');
      // 14.50 base + 0.15 allowance
      expect(result!.grossPay.toString()).toBe('14.65');
    });

    it('should calculate payslip with full attendance (no leave, no holidays)', async () => {
      // January 2026: 31 days, 9 weekend days (5 Sat + 4 Sun) = 22 working days
      // No holidays
      prisma.holiday.findMany.mockResolvedValue([]);

      // Full attendance: 22 present days, some OT
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 22 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(2026, 0, i + 1),
          otMinutesApproved: 30,
          otMinutesCalculated: 30,
        })),
      );

      // No leave requests
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      expect(result!.employeeId).toBe(employeeId);
      expect(result!.workingDays).toBe(22);
      expect(result!.presentDays).toBe(22);
      expect(result!.leaveDays).toBe(0);
      expect(result!.lopDays).toBe(0);

      // basePay prorated: 50000 * (22/22) = 50000
      expect(Number(result!.basePay)).toBe(50000);

      // HRA: 50000 * 40% = 20000
      expect(toPlainAmounts(result!.earnings)).toEqual(
        expect.arrayContaining([
          { name: 'HRA', amount: 20000 },
          { name: 'Conveyance', amount: 1600 },
        ]),
      );

      // PF: 50000 * 12% = 6000
      expect(toPlainAmounts(result!.deductions)).toEqual(
        expect.arrayContaining([{ name: 'PF', amount: 6000 }]),
      );

      // OT: 22 * 30 min = 660 min = 11 hours
      expect(Number(result!.otHours)).toBe(11);

      // hourlyRate = 50000 / (22 * 8) = 284.0909..., otPay = 11 * 284.0909... * 1.5
      const hourlyRate = 50000 / (22 * 8);
      const expectedOtPay = Math.round(11 * hourlyRate * 1.5 * 100) / 100;
      expect(Number(result!.otPay)).toBe(expectedOtPay);

      // grossPay = basePay + HRA + Conveyance + otPay
      const grossPay = Math.round((50000 + 20000 + 1600 + expectedOtPay) * 100) / 100;
      expect(Number(result!.grossPay)).toBe(grossPay);

      // totalDeductions = PF = 6000
      expect(Number(result!.totalDeductions)).toBe(6000);

      // netPay = grossPay - totalDeductions
      const netPay = Math.round((grossPay - 6000) * 100) / 100;
      expect(Number(result!.netPay)).toBe(netPay);
    });

    it('should pro-rate salary for partial attendance', async () => {
      // No holidays
      prisma.holiday.findMany.mockResolvedValue([]);

      // Only 15 present days out of 22 working days
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 15 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(2026, 0, i + 1),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
      );

      // No leave requests
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      expect(result!.presentDays).toBe(15);

      // proRateFactor = 15/22
      const proRateFactor = 15 / 22;
      const expectedBasePay = Math.round(50000 * proRateFactor * 100) / 100;
      expect(Number(result!.basePay)).toBe(expectedBasePay);

      // HRA: prorated basePay * 40%
      const expectedHRA = Math.round(expectedBasePay * 0.4 * 100) / 100;
      expect(toPlainAmounts(result!.earnings)).toEqual(
        expect.arrayContaining([{ name: 'HRA', amount: expectedHRA }]),
      );
    });

    it('should count HALF_DAY attendance as 0.5 present days', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'PRESENT', date: new Date(2026, 0, 2), otMinutesApproved: 0, otMinutesCalculated: 0 },
        { status: 'HALF_DAY', date: new Date(2026, 0, 3), otMinutesApproved: 0, otMinutesCalculated: 0 },
        { status: 'WFH', date: new Date(2026, 0, 5), otMinutesApproved: 0, otMinutesCalculated: 0 },
      ]);

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // 1 (PRESENT) + 0.5 (HALF_DAY) + 1 (WFH) = 2.5
      expect(result!.presentDays).toBe(2.5);
    });

    it('should handle paid leave as effective present days', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      // 20 present days
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(2026, 0, i + 1),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
      );

      // 2 days paid leave (Thursday 2026-01-22, Friday 2026-01-23 - weekdays)
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          startDate: new Date(2026, 0, 22),
          endDate: new Date(2026, 0, 23),
          status: 'APPROVED',
          leaveType: { isPaid: true },
        },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      expect(result!.presentDays).toBe(20);
      // paidLeaveDays = 2, effectivePresent = min(20+2, 22) = 22
      expect(result!.leaveDays).toBe(2); // paidLeaveDays + lopDays
      expect(result!.lopDays).toBe(0);
    });

    it('should count unpaid leave as LOP days', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(2026, 0, i + 1),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
      );

      // 1 day unpaid leave (Wednesday 2026-01-21)
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          startDate: new Date(2026, 0, 21),
          endDate: new Date(2026, 0, 21),
          status: 'APPROVED',
          leaveType: { isPaid: false },
        },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      expect(result!.lopDays).toBe(1);
      expect(result!.leaveDays).toBe(1); // total: paid(0) + lop(1)
    });

    it('should account for holidays in working day calculation', async () => {
      // One weekday holiday: e.g., Wednesday Jan 14, 2026
      prisma.holiday.findMany.mockResolvedValue([
        {
          date: new Date(2026, 0, 14), // Wednesday
          isActive: true,
        },
      ]);

      // Full attendance for remaining working days (21)
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 21 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(2026, 0, i + 1),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
      );

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // 22 working days - 1 weekday holiday = 21
      expect(result!.workingDays).toBe(21);
    });

    it('should not count weekend holidays as working day reductions', async () => {
      // A Saturday holiday should not reduce working days further
      prisma.holiday.findMany.mockResolvedValue([
        {
          date: new Date(2026, 0, 10), // Saturday
          isActive: true,
        },
      ]);

      prisma.attendanceRecord.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // Saturday holidays should not affect workingDays count (already excluded as weekend)
      expect(result!.workingDays).toBe(22);
    });

    it('should use approved OT minutes when available', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          status: 'PRESENT',
          date: new Date(2026, 0, 2),
          otMinutesApproved: 60, // approved
          otMinutesCalculated: 90, // calculated
        },
      ]);

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // Should use approved (60 min = 1 hour), not calculated (90 min)
      expect(Number(result!.otHours)).toBe(1);
    });

    it('should fall back to calculated OT when approved is null', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          status: 'PRESENT',
          date: new Date(2026, 0, 2),
          otMinutesApproved: null,
          otMinutesCalculated: 120,
        },
      ]);

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // Should use calculated: 120 min = 2 hours
      expect(Number(result!.otHours)).toBe(2);
    });

    it('should use hourlyRate for HOURLY payType employees', async () => {
      const hourlySalary = {
        ...mockSalary,
        employee: {
          otMultiplier: 2,
          payType: 'HOURLY',
          hourlyRate: 300,
        },
      };
      prisma.employeeSalary.findFirst.mockResolvedValue(hourlySalary);
      prisma.holiday.findMany.mockResolvedValue([]);

      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          status: 'PRESENT',
          date: new Date(2026, 0, 2),
          otMinutesApproved: 120,
          otMinutesCalculated: 120,
        },
      ]);

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // OT: 2 hours * 300 hourlyRate * 2 multiplier = 1200
      expect(Number(result!.otPay)).toBe(1200);
    });

    it('should return zero otPay when there are no OT hours', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          status: 'PRESENT',
          date: new Date(2026, 0, 2),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        },
      ]);

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      expect(Number(result!.otHours)).toBe(0);
      expect(Number(result!.otPay)).toBe(0);
    });

    it('should handle salary with no components', async () => {
      const noComponentsSalary = {
        ...mockSalary,
        salaryStructure: {
          ...mockSalary.salaryStructure,
          components: [],
        },
      };
      prisma.employeeSalary.findFirst.mockResolvedValue(noComponentsSalary);
      prisma.holiday.findMany.mockResolvedValue([]);

      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 22 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(2026, 0, i + 1),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
      );

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      expect(toPlainAmounts(result!.earnings)).toEqual([]);
      expect(toPlainAmounts(result!.deductions)).toEqual([]);
      expect(Number(result!.basePay)).toBe(50000);
      expect(Number(result!.grossPay)).toBe(50000);
      expect(Number(result!.totalDeductions)).toBe(0);
      expect(Number(result!.netPay)).toBe(50000);
    });
  });
});
