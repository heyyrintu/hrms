import { Test, TestingModule } from '@nestjs/testing';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';

describe('PayrollCalculationService', () => {
  let service: PayrollCalculationService;
  let prisma: any;

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';
  const month = 1; // January
  const year = 2026;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollCalculationService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<PayrollCalculationService>(PayrollCalculationService);
    prisma = module.get(PrismaService);
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
      expect(result!.basePay).toBe(50000);

      // HRA: 50000 * 40% = 20000
      expect(result!.earnings).toEqual(
        expect.arrayContaining([
          { name: 'HRA', amount: 20000 },
          { name: 'Conveyance', amount: 1600 },
        ]),
      );

      // PF: 50000 * 12% = 6000
      expect(result!.deductions).toEqual(
        expect.arrayContaining([{ name: 'PF', amount: 6000 }]),
      );

      // OT: 22 * 30 min = 660 min = 11 hours
      expect(result!.otHours).toBe(11);

      // hourlyRate = 50000 / (22 * 8) = 284.0909..., otPay = 11 * 284.0909... * 1.5
      const hourlyRate = 50000 / (22 * 8);
      const expectedOtPay = Math.round(11 * hourlyRate * 1.5 * 100) / 100;
      expect(result!.otPay).toBe(expectedOtPay);

      // grossPay = basePay + HRA + Conveyance + otPay
      const grossPay = Math.round((50000 + 20000 + 1600 + expectedOtPay) * 100) / 100;
      expect(result!.grossPay).toBe(grossPay);

      // totalDeductions = PF = 6000
      expect(result!.totalDeductions).toBe(6000);

      // netPay = grossPay - totalDeductions
      const netPay = Math.round((grossPay - 6000) * 100) / 100;
      expect(result!.netPay).toBe(netPay);
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
      expect(result!.basePay).toBe(expectedBasePay);

      // HRA: prorated basePay * 40%
      const expectedHRA = Math.round(expectedBasePay * 0.4 * 100) / 100;
      expect(result!.earnings).toEqual(
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
      expect(result!.otHours).toBe(1);
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
      expect(result!.otHours).toBe(2);
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
      expect(result!.otPay).toBe(1200);
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
      expect(result!.otHours).toBe(0);
      expect(result!.otPay).toBe(0);
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
      expect(result!.earnings).toEqual([]);
      expect(result!.deductions).toEqual([]);
      expect(result!.basePay).toBe(50000);
      expect(result!.grossPay).toBe(50000);
      expect(result!.totalDeductions).toBe(0);
      expect(result!.netPay).toBe(50000);
    });
  });
});
