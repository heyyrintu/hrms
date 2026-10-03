import { Test, TestingModule } from '@nestjs/testing';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { Decimal } from '@prisma/client/runtime/library';
import { StatutoryService } from './statutory/statutory.service';
import { LoansService } from '../loans/loans.service';

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
  let loans: { getPayrollDeductions: jest.Mock };

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
        {
          provide: LoansService,
          useValue: {
            // No loans by default, so these tests stay about the base pay maths.
            getPayrollDeductions: jest
              .fn()
              .mockResolvedValue({ total: 0, lines: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<PayrollCalculationService>(PayrollCalculationService);
    prisma = module.get(PrismaService);
    statutory = module.get(StatutoryService);
    loans = module.get(LoansService);
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
          status: 'PRESENT', date: new Date(Date.UTC(2026, 0, i + 1, 12)),
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
          status: 'PRESENT', date: new Date(Date.UTC(2026, 0, i + 1, 12)),
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
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
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
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
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
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
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
        { status: 'PRESENT', date: new Date(Date.UTC(2026, 0, 2, 12)), otMinutesApproved: 0, otMinutesCalculated: 0 },
        { status: 'HALF_DAY', date: new Date(Date.UTC(2026, 0, 3, 12)), otMinutesApproved: 0, otMinutesCalculated: 0 },
        { status: 'WFH', date: new Date(Date.UTC(2026, 0, 5, 12)), otMinutesApproved: 0, otMinutesCalculated: 0 },
      ]);

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // 1 (PRESENT) + 0.5 (HALF_DAY) + 1 (WFH) = 2.5
      expect(result!.presentDays).toBe(2.5);
    });

    // Keka wave G (time and attendance)
    it('counts an ON_DUTY day as 1 present day', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'PRESENT', date: new Date(Date.UTC(2026, 0, 2, 12)), otMinutesApproved: 0, otMinutesCalculated: 0 },
        { status: 'ON_DUTY', date: new Date(Date.UTC(2026, 0, 5, 12)), otMinutesApproved: 0, otMinutesCalculated: 0 },
      ]);

      prisma.leaveRequest.findMany.mockResolvedValue([]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // 1 (PRESENT) + 1 (ON_DUTY) = 2
      expect(result!.presentDays).toBe(2);
    });

    it('should handle paid leave as effective present days', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);

      // 20 present days
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
      );

      // 2 days paid leave (Thursday 2026-01-22, Friday 2026-01-23 - weekdays)
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          startDate: new Date(Date.UTC(2026, 0, 22, 12)),
          endDate: new Date(Date.UTC(2026, 0, 23, 12)),
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
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
      );

      // 1 day unpaid leave (Wednesday 2026-01-21)
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          startDate: new Date(Date.UTC(2026, 0, 21, 12)),
          endDate: new Date(Date.UTC(2026, 0, 21, 12)),
          status: 'APPROVED',
          leaveType: { isPaid: false },
        },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      expect(result!.lopDays).toBe(1);
      expect(result!.leaveDays).toBe(1); // total: paid(0) + lop(1)
    });

    it('counts ABSENT attendance rows as LOP days', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockResolvedValue({ absentIsLop: true });

      prisma.attendanceRecord.findMany.mockResolvedValue([
        ...Array.from({ length: 18 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
        { status: 'ABSENT', date: new Date(Date.UTC(2026, 0, 20, 12)), otMinutesApproved: null, otMinutesCalculated: 0 },
        { status: 'ABSENT', date: new Date(Date.UTC(2026, 0, 21, 12)), otMinutesApproved: null, otMinutesCalculated: 0 },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result).not.toBeNull();
      // Absences earn nothing, so they never raise presentDays.
      expect(result!.presentDays).toBe(18);
      expect(result!.lopDays).toBe(2);
      expect(prisma.attendancePolicy.findUnique).toHaveBeenCalledWith({
        where: { tenantId },
        select: { absentIsLop: true },
      });
    });

    // The month window filters `@db.Date` columns, which Prisma reads back as
    // UTC midnight. Built in the server's zone, the window ran to 30 Jan
    // 18:30Z on an IST box and the 31st fell outside `lte` entirely — its
    // attendance was dropped and its ABSENT row was never charged as LOP.
    it('builds the month window in UTC so the last day of the month is inside it', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockResolvedValue({ absentIsLop: true });
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.calculateForEmployee(tenantId, employeeId, month, year);

      const attendanceWhere = (prisma.attendanceRecord.findMany as jest.Mock).mock
        .calls[0][0].where;
      expect(attendanceWhere.date).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-01-31T00:00:00.000Z'),
      });

      const holidayWhere = (prisma.holiday.findMany as jest.Mock).mock.calls[0][0].where;
      expect(holidayWhere.date).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-01-31T00:00:00.000Z'),
      });

      const leaveWhere = (prisma.leaveRequest.findMany as jest.Mock).mock.calls[0][0].where;
      expect(leaveWhere.startDate).toEqual({ lte: new Date('2026-01-31T00:00:00.000Z') });
      expect(leaveWhere.endDate).toEqual({ gte: new Date('2026-01-01T00:00:00.000Z') });
    });

    it('charges an ABSENT row on the last day of the month', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockResolvedValue({ absentIsLop: true });
      prisma.attendanceRecord.findMany.mockResolvedValue([
        // 30 January 2026 is a Friday; 31 January is a Saturday, so use the
        // 30th as the last *working* day the window has to reach.
        {
          status: 'ABSENT',
          date: new Date('2026-01-30T00:00:00.000Z'),
          otMinutesApproved: null,
          otMinutesCalculated: 0,
        },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result!.lopDays).toBe(1);
    });

    it('adds absent LOP on top of unpaid-leave LOP', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockResolvedValue({ absentIsLop: true });

      prisma.attendanceRecord.findMany.mockResolvedValue([
        ...Array.from({ length: 19 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
        { status: 'ABSENT', date: new Date(Date.UTC(2026, 0, 20, 12)), otMinutesApproved: null, otMinutesCalculated: 0 },
      ]);
      // 1 day unpaid leave (Wednesday 2026-01-21)
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          startDate: new Date(Date.UTC(2026, 0, 21, 12)),
          endDate: new Date(Date.UTC(2026, 0, 21, 12)),
          status: 'APPROVED',
          leaveType: { isPaid: false },
        },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result!.lopDays).toBe(2);
    });

    it('charges one LOP day, not two, when an absence and unpaid leave land on the same day', async () => {
      // A manually created ABSENT row and an approved unpaid leave can both
      // describe the same missing Wednesday. The employee lost one day of pay,
      // so payroll must charge one.
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockResolvedValue({ absentIsLop: true });

      prisma.attendanceRecord.findMany.mockResolvedValue([
        ...Array.from({ length: 19 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
          otMinutesApproved: 0,
          otMinutesCalculated: 0,
        })),
        {
          status: 'ABSENT',
          date: new Date(Date.UTC(2026, 0, 21, 12)),
          otMinutesApproved: null,
          otMinutesCalculated: 0,
        },
      ]);
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          startDate: new Date(Date.UTC(2026, 0, 21, 12)),
          endDate: new Date(Date.UTC(2026, 0, 21, 12)),
          status: 'APPROVED',
          leaveType: { isPaid: false },
        },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result!.lopDays).toBe(1);
    });

    it('still charges an absence that a paid leave covers a different day of', async () => {
      // Paid leave never enters the LOP set, so an absence elsewhere in the
      // month is untouched by it.
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockResolvedValue({ absentIsLop: true });

      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          status: 'ABSENT',
          date: new Date(Date.UTC(2026, 0, 20, 12)),
          otMinutesApproved: null,
          otMinutesCalculated: 0,
        },
      ]);
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          startDate: new Date(Date.UTC(2026, 0, 21, 12)),
          endDate: new Date(Date.UTC(2026, 0, 21, 12)),
          status: 'APPROVED',
          leaveType: { isPaid: true },
        },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result!.lopDays).toBe(1);
      expect(result!.leaveDays).toBe(2); // paid(1) + lop(1)
    });

    it('does not charge LOP for absences when the tenant policy says not to', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockResolvedValue({ absentIsLop: false });

      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'ABSENT', date: new Date(Date.UTC(2026, 0, 20, 12)), otMinutesApproved: null, otMinutesCalculated: 0 },
        { status: 'ABSENT', date: new Date(Date.UTC(2026, 0, 21, 12)), otMinutesApproved: null, otMinutesCalculated: 0 },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result!.lopDays).toBe(0);
    });

    it('treats a missing policy row as absent-is-LOP, matching the schema default', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockResolvedValue(null);

      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'ABSENT', date: new Date(Date.UTC(2026, 0, 20, 12)), otMinutesApproved: null, otMinutesCalculated: 0 },
      ]);

      const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(result!.lopDays).toBe(1);
    });

    it('does not read the policy when nobody was absent', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.attendancePolicy.findUnique.mockClear();
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'PRESENT', date: new Date(Date.UTC(2026, 0, 2, 12)), otMinutesApproved: 0, otMinutesCalculated: 0 },
      ]);

      await service.calculateForEmployee(tenantId, employeeId, month, year);

      expect(prisma.attendancePolicy.findUnique).not.toHaveBeenCalled();
    });

    it('asks the database for ABSENT rows alongside the present ones', async () => {
      prisma.holiday.findMany.mockResolvedValue([]);
      prisma.leaveRequest.findMany.mockResolvedValue([]);
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      await service.calculateForEmployee(tenantId, employeeId, month, year);

      const where = prisma.attendanceRecord.findMany.mock.calls[0][0].where;
      expect(where.status.in).toEqual(['PRESENT', 'WFH', 'ON_DUTY', 'HALF_DAY', 'ABSENT']);
    });

    it('should account for holidays in working day calculation', async () => {
      // One weekday holiday: e.g., Wednesday Jan 14, 2026
      prisma.holiday.findMany.mockResolvedValue([
        {
          date: new Date(Date.UTC(2026, 0, 14, 12)), // Wednesday
          isActive: true,
        },
      ]);

      // Full attendance for remaining working days (21)
      prisma.attendanceRecord.findMany.mockResolvedValue(
        Array.from({ length: 21 }, (_, i) => ({
          status: 'PRESENT',
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
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
          date: new Date(Date.UTC(2026, 0, 10, 12)), // Saturday
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
          date: new Date(Date.UTC(2026, 0, 2, 12)),
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
          date: new Date(Date.UTC(2026, 0, 2, 12)),
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
          date: new Date(Date.UTC(2026, 0, 2, 12)),
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
          date: new Date(Date.UTC(2026, 0, 2, 12)),
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
          date: new Date(Date.UTC(2026, 0, i + 1, 12)),
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

describe('PayrollCalculationService - section 10 allowances actually paid', () => {
  let service: PayrollCalculationService;
  let prisma: any;
  let statutory: { compute: jest.Mock };
  let loans: { getPayrollDeductions: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';
  const month = 1; // January
  const year = 2026;

  /** A full month of attendance, so nothing is pro-rated away. */
  function fullAttendance() {
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.attendanceRecord.findMany.mockResolvedValue(
      Array.from({ length: 22 }, (_, i) => ({
        status: 'PRESENT', date: new Date(Date.UTC(2026, 0, i + 1, 12)),
        otMinutesApproved: 0, otMinutesCalculated: 0,
      })),
    );
    prisma.leaveRequest.findMany.mockResolvedValue([]);
  }

  function salaryWith(components: Record<string, unknown>[]) {
    return {
      id: 'es-1',
      tenantId,
      employeeId,
      basePay: 20000,
      isActive: true,
      salaryStructure: { id: 'ss-1', name: 'Standard', components },
      employee: { otMultiplier: 1.5, payType: 'MONTHLY', hourlyRate: null },
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollCalculationService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: StatutoryService,
          useValue: { compute: jest.fn().mockResolvedValue(noStatutory()) },
        },
        {
          provide: LoansService,
          useValue: {
            // No loans by default, so these tests stay about the base pay maths.
            getPayrollDeductions: jest
              .fn()
              .mockResolvedValue({ total: 0, lines: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<PayrollCalculationService>(PayrollCalculationService);
    prisma = module.get(PrismaService);
    statutory = module.get(StatutoryService);
    loans = module.get(LoansService);
  });

  it('tells the statutory engine what it actually paid under each marked head', async () => {
    // Section 10 exempts an allowance received. The engine cannot know what
    // was received unless payroll says so, and the structure marks the
    // components the same way it marks provident fund wages.
    prisma.employeeSalary.findFirst.mockResolvedValue(
      salaryWith([
        {
          name: 'Leave Travel Allowance', type: 'earning', calcType: 'fixed',
          value: 2500, section10Head: 'LTA',
        },
        {
          name: 'Education Allowance', type: 'earning', calcType: 'fixed',
          value: 200, section10Head: 'CHILDREN_EDUCATION',
        },
        { name: 'HRA', type: 'earning', calcType: 'fixed', value: 8000 },
      ]),
    );
    fullAttendance();

    await service.calculateForEmployee(tenantId, employeeId, month, year);

    const passed = statutory.compute.mock.calls[0][0].section10Allowances;

    expect(passed.paidThisMonth.lta.toString()).toBe('2500');
    expect(passed.paidThisMonth.childrenEducation.toString()).toBe('200');
    // Marked but not paid at all: the head exists in the map at nought, which
    // exempts nothing, rather than being absent and capping nothing.
    expect(passed.paidThisMonth.hostel.toString()).toBe('0');
    expect(passed.componentNames.LTA).toEqual(['Leave Travel Allowance']);
    expect(passed.componentNames.CHILDREN_EDUCATION).toEqual(['Education Allowance']);
    expect(passed.componentNames.HOSTEL_ALLOWANCE).toEqual([]);
  });

  it('adds up several components paid under the same head', async () => {
    // A structure can pay one head through more than one line; the section
    // exempts the allowance, not the line.
    prisma.employeeSalary.findFirst.mockResolvedValue(
      salaryWith([
        {
          name: 'Hostel Allowance', type: 'earning', calcType: 'fixed',
          value: 300, section10Head: 'HOSTEL_ALLOWANCE',
        },
        {
          name: 'Boarding Allowance', type: 'earning', calcType: 'fixed',
          value: 450, section10Head: 'HOSTEL_ALLOWANCE',
        },
      ]),
    );
    fullAttendance();

    await service.calculateForEmployee(tenantId, employeeId, month, year);

    const passed = statutory.compute.mock.calls[0][0].section10Allowances;

    expect(passed.paidThisMonth.hostel.toString()).toBe('750');
    expect(passed.componentNames.HOSTEL_ALLOWANCE).toEqual([
      'Hostel Allowance',
      'Boarding Allowance',
    ]);
  });

  it('reports the allowance as the payslip pays it, pro-rated and all', async () => {
    // Half a month present, so half the allowance is paid. The exemption
    // cannot exceed what the employee actually received, and what they
    // received is the line on their payslip.
    prisma.employeeSalary.findFirst.mockResolvedValue(
      salaryWith([
        {
          name: 'Leave Travel Allowance', type: 'earning', calcType: 'fixed',
          value: 2500, section10Head: 'LTA',
        },
      ]),
    );
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.attendanceRecord.findMany.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => ({
        status: 'PRESENT', date: new Date(Date.UTC(2026, 0, i + 1, 12)),
        otMinutesApproved: 0, otMinutesCalculated: 0,
      })),
    );
    prisma.leaveRequest.findMany.mockResolvedValue([]);

    const result = await service.calculateForEmployee(tenantId, employeeId, month, year);

    const line = result!.earnings.find((e) => e.name === 'Leave Travel Allowance');
    const passed = statutory.compute.mock.calls[0][0].section10Allowances;

    expect(passed.paidThisMonth.lta.toString()).toBe(line!.amount.toString());
    expect(line!.amount.lt(new Decimal(2500))).toBe(true);
  });

  it('passes nothing at all when the structure marks no component', async () => {
    // The regression that matters: an employer who has marked nothing must be
    // taxed to exactly the rupee they were before, and the way that is
    // guaranteed is that the engine is not told about allowances at all.
    prisma.employeeSalary.findFirst.mockResolvedValue(
      salaryWith([
        { name: 'HRA', type: 'earning', calcType: 'fixed', value: 8000 },
        { name: 'Conveyance', type: 'earning', calcType: 'fixed', value: 1600 },
      ]),
    );
    fullAttendance();

    await service.calculateForEmployee(tenantId, employeeId, month, year);

    expect(statutory.compute.mock.calls[0][0].section10Allowances).toBeUndefined();
  });

  it('ignores a head marked on a deduction, which pays the employee nothing', async () => {
    // Section 10 exempts an allowance received. A deduction is not one, and
    // marking it must not manufacture a receipt to exempt against.
    prisma.employeeSalary.findFirst.mockResolvedValue(
      salaryWith([
        {
          name: 'LTA Recovery', type: 'deduction', calcType: 'fixed',
          value: 2500, section10Head: 'LTA',
        },
      ]),
    );
    fullAttendance();

    await service.calculateForEmployee(tenantId, employeeId, month, year);

    expect(statutory.compute.mock.calls[0][0].section10Allowances).toBeUndefined();
  });
});

describe('PayrollCalculationService - loan and salary advance recovery', () => {
  let service: PayrollCalculationService;
  let prisma: any;
  let loans: { getPayrollDeductions: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';
  const month = 1; // January
  const year = 2026;

  /** A full month of attendance, so nothing is pro-rated away. */
  function fullAttendance() {
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.attendanceRecord.findMany.mockResolvedValue(
      Array.from({ length: 22 }, (_, i) => ({
        status: 'PRESENT', date: new Date(Date.UTC(2026, 0, i + 1, 12)),
        otMinutesApproved: 0, otMinutesCalculated: 0,
      })),
    );
    prisma.leaveRequest.findMany.mockResolvedValue([]);
  }

  /** A flat salary with no components, so net pay is exactly the base pay. */
  function salaryOf(basePay: number) {
    return {
      id: 'es-1',
      tenantId,
      employeeId,
      basePay,
      isActive: true,
      salaryStructure: { id: 'ss-1', name: 'Flat', components: [] },
      employee: { otMultiplier: 1.5, payType: 'MONTHLY', hourlyRate: null },
    };
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollCalculationService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: StatutoryService,
          useValue: { compute: jest.fn().mockResolvedValue(noStatutory()) },
        },
        {
          provide: LoansService,
          useValue: {
            getPayrollDeductions: jest
              .fn()
              .mockResolvedValue({ total: 0, lines: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<PayrollCalculationService>(PayrollCalculationService);
    prisma = module.get(PrismaService);
    loans = module.get(LoansService);
    prisma.employeeSalary.findFirst.mockResolvedValue(salaryOf(20000));
    fullAttendance();
  });

  it('shows the instalment as a deduction line and takes it off net pay', async () => {
    loans.getPayrollDeductions.mockResolvedValue({
      total: 5000,
      lines: [{ loanId: 'loan-1', type: 'LOAN', amount: 5000 }],
    });

    const result = await service.calculateForEmployee(
      tenantId, employeeId, month, year,
    );

    expect(loans.getPayrollDeductions).toHaveBeenCalledWith(
      tenantId, employeeId, month, year,
    );
    expect(toPlainAmounts(result!.deductions)).toEqual([
      { name: 'Loan EMI', amount: 5000 },
    ]);
    expect(Number(result!.totalDeductions)).toBe(5000);
    expect(Number(result!.netPay)).toBe(15000);
    expect(result!.loanRepayments).toEqual([{ loanId: 'loan-1', amount: 5000 }]);
  });

  it('names a salary advance recovery differently from a loan instalment', async () => {
    loans.getPayrollDeductions.mockResolvedValue({
      total: 3500,
      lines: [
        { loanId: 'loan-1', type: 'LOAN', amount: 2000 },
        { loanId: 'adv-1', type: 'SALARY_ADVANCE', amount: 1500 },
      ],
    });

    const result = await service.calculateForEmployee(
      tenantId, employeeId, month, year,
    );

    expect(toPlainAmounts(result!.deductions)).toEqual([
      { name: 'Loan EMI', amount: 2000 },
      { name: 'Salary advance recovery', amount: 1500 },
    ]);
    expect(Number(result!.netPay)).toBe(16500);
  });

  it('clamps the instalments so net pay lands on zero rather than going negative', async () => {
    // 20000 of pay against 25000 of scheduled instalments. Payroll may not pay
    // a negative salary to service a loan.
    loans.getPayrollDeductions.mockResolvedValue({
      total: 25000,
      lines: [
        { loanId: 'loan-1', type: 'LOAN', amount: 18000 },
        { loanId: 'adv-1', type: 'SALARY_ADVANCE', amount: 7000 },
      ],
    });

    const result = await service.calculateForEmployee(
      tenantId, employeeId, month, year,
    );

    // The last line is cut first, so the older loan keeps its full instalment.
    expect(toPlainAmounts(result!.deductions)).toEqual([
      { name: 'Loan EMI', amount: 18000 },
      { name: 'Salary advance recovery', amount: 2000 },
    ]);
    expect(Number(result!.netPay)).toBe(0);
    // What is recorded against each loan is what was actually charged.
    expect(result!.loanRepayments).toEqual([
      { loanId: 'loan-1', amount: 18000 },
      { loanId: 'adv-1', amount: 2000 },
    ]);
  });

  it('drops a line entirely when the clamp leaves nothing for it', async () => {
    loans.getPayrollDeductions.mockResolvedValue({
      total: 26000,
      lines: [
        { loanId: 'loan-1', type: 'LOAN', amount: 20000 },
        { loanId: 'adv-1', type: 'SALARY_ADVANCE', amount: 6000 },
      ],
    });

    const result = await service.calculateForEmployee(
      tenantId, employeeId, month, year,
    );

    expect(toPlainAmounts(result!.deductions)).toEqual([
      { name: 'Loan EMI', amount: 20000 },
    ]);
    expect(Number(result!.netPay)).toBe(0);
    expect(result!.loanRepayments).toEqual([
      { loanId: 'loan-1', amount: 20000 },
    ]);
  });

  it('records nothing and adds no line when the employee has no loans', async () => {
    const result = await service.calculateForEmployee(
      tenantId, employeeId, month, year,
    );

    expect(toPlainAmounts(result!.deductions)).toEqual([]);
    expect(result!.loanRepayments).toEqual([]);
    expect(Number(result!.netPay)).toBe(20000);
  });
});

// ============================================================================
// Keka wave C (spec C.0, C1-C5): the payslip line contract and run extras.
// ============================================================================

describe('PayrollCalculationService — run extras and the line contract (Keka wave C)', () => {
  let service: PayrollCalculationService;
  let prisma: any;
  let statutory: { compute: jest.Mock };
  let loans: { getPayrollDeductions: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';
  // October 2026 has 22 weekdays; with no attendance rows the employee is
  // treated as present only for what the records say, so give every weekday.
  const month = 10;
  const year = 2026;

  const salaryRow = {
    id: 'es-1',
    tenantId,
    employeeId,
    basePay: 40000,
    isActive: true,
    salaryStructure: {
      id: 'ss-1',
      components: [
        { name: 'HRA', type: 'earning', calcType: 'percentage', value: 50, pfApplicable: false },
        { name: 'DA', type: 'earning', calcType: 'fixed', value: 5000, pfApplicable: true },
        { name: 'Canteen', type: 'deduction', calcType: 'fixed', value: 500 },
      ],
    },
    employee: {
      otMultiplier: 1.5, payType: 'MONTHLY', hourlyRate: null, gender: null,
      dateOfBirth: null, pfOptOut: false, taxRegime: null,
    },
  };

  /** Every weekday of October 2026 attended. */
  function fullMonthAttendance() {
    const rows = [];
    for (let d = 1; d <= 31; d++) {
      const date = new Date(Date.UTC(2026, 9, d, 12));
      const day = date.getUTCDay();
      if (day === 0 || day === 6) continue;
      rows.push({ date, status: 'PRESENT', otMinutesApproved: 0, otMinutesCalculated: 0 });
    }
    return rows;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollCalculationService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: StatutoryService, useValue: { compute: jest.fn().mockResolvedValue(noStatutory()) } },
        {
          provide: LoansService,
          useValue: { getPayrollDeductions: jest.fn().mockResolvedValue({ total: 0, lines: [] }) },
        },
      ],
    }).compile();

    service = module.get(PayrollCalculationService);
    prisma = module.get(PrismaService);
    statutory = module.get(StatutoryService);
    loans = module.get(LoansService);

    prisma.employeeSalary.findFirst.mockResolvedValue(salaryRow);
    prisma.holiday.findMany.mockResolvedValue([]);
    prisma.leaveRequest.findMany.mockResolvedValue([]);
    prisma.attendanceRecord.findMany.mockResolvedValue(fullMonthAttendance());
    prisma.employee.findFirst.mockResolvedValue(salaryRow.employee);
  });

  it('writes a kind on every line: components, statutory and loans', async () => {
    statutory.compute.mockResolvedValue({
      ...noStatutory(),
      pfEmployee: new Decimal(1800),
      tds: new Decimal(1000),
      totalEmployeeDeductions: new Decimal(2800),
    });
    loans.getPayrollDeductions.mockResolvedValue({
      total: 2000,
      lines: [{ loanId: 'loan-1', type: 'PERSONAL', amount: 2000 }],
    });

    const r = await service.calculateForEmployee(tenantId, employeeId, month, year);

    expect(r!.earnings.map((e) => [e.name, e.kind])).toEqual([
      ['HRA', 'COMPONENT'],
      ['DA', 'COMPONENT'],
    ]);
    expect(r!.deductions.map((d) => [d.name, d.kind])).toEqual([
      ['Canteen', 'COMPONENT'],
      ['Provident Fund', 'STATUTORY'],
      ['TDS', 'STATUTORY'],
      ['Loan EMI', 'LOAN'],
    ]);
    // No extras: the new figures are all nought and net is unchanged.
    expect(r!.nonRecurringTaxable.toString()).toBe('0');
    expect(r!.nonTaxableEarnings.toString()).toBe('0');
    expect(r!.netPay.toString()).toBe(
      r!.grossPay.sub(r!.totalDeductions).toString(),
    );
  });

  it('pays net positive arrears as one taxable, non-recurring earning with its PF wages', async () => {
    const r = await service.calculateForEmployee(tenantId, employeeId, month, year, {
      extras: {
        arrears: [
          { id: 'ar-1', amount: new Decimal(3000), pfWagesDelta: new Decimal(2000), financialYear: 2026 },
          { id: 'ar-2', amount: new Decimal(2000), pfWagesDelta: new Decimal(1000), financialYear: 2026 },
        ],
      },
    });

    const arrears = r!.earnings.find((e) => e.kind === 'ARREAR')!;
    expect(arrears).toMatchObject({ name: 'Arrears', taxable: true });
    expect(arrears.amount.toString()).toBe('5000');
    // 40,000 + 20,000 HRA + 5,000 DA + 5,000 arrears.
    expect(r!.grossPay.toString()).toBe('70000');
    expect(r!.arrearsAmount.toString()).toBe('5000');
    expect(r!.nonRecurringTaxable.toString()).toBe('5000');

    const input = statutory.compute.mock.calls[0][0];
    expect(input.nonRecurringTaxable.toString()).toBe('5000');
    // Basic 40,000 + DA 5,000 + 3,000 of arrears PF wages.
    expect(input.pfWages.toString()).toBe('48000');
    expect(input.priorYearArrears).toBeUndefined();
  });

  it('recovers net negative arrears after tax without touching the gross', async () => {
    const r = await service.calculateForEmployee(tenantId, employeeId, month, year, {
      extras: {
        arrears: [{ id: 'ar-1', amount: new Decimal(-1500), pfWagesDelta: new Decimal(-1500), financialYear: 2026 }],
      },
    });

    expect(r!.grossPay.toString()).toBe('65000');
    expect(r!.arrearsAmount.toString()).toBe('0');
    const recovery = r!.deductions.find((d) => d.kind === 'ARREAR')!;
    expect(recovery.name).toBe('Arrears recovery');
    expect(recovery.amount.toString()).toBe('1500');
    // 65,000 - 500 canteen - 1,500 recovery.
    expect(r!.netPay.toString()).toBe('63000');
    expect(statutory.compute.mock.calls[0][0].pfWages.toString()).toBe('45000');
  });

  it('flags arrears of an earlier financial year for section 89', async () => {
    await service.calculateForEmployee(tenantId, employeeId, month, year, {
      extras: {
        arrears: [
          { id: 'ar-1', amount: new Decimal(4000), pfWagesDelta: new Decimal(0), financialYear: 2025 },
          { id: 'ar-2', amount: new Decimal(1000), pfWagesDelta: new Decimal(0), financialYear: 2026 },
        ],
      },
    });

    const input = statutory.compute.mock.calls[0][0];
    expect(input.priorYearArrears.amount.toString()).toBe('4000');
    expect(input.priorYearArrears.financialYears).toEqual([2025]);
  });

  it('pays one-time earnings and deductions per their taxability', async () => {
    const r = await service.calculateForEmployee(tenantId, employeeId, month, year, {
      extras: {
        oneTimePayments: [
          { id: 'otp-1', kind: 'BONUS', name: 'Diwali bonus', amount: new Decimal(10000), taxable: true },
          { id: 'otp-2', kind: 'OTHER_EARNING', name: 'Relocation', amount: new Decimal(3000), taxable: false },
          { id: 'otp-3', kind: 'RECOVERY', name: 'Laptop damage', amount: new Decimal(2000), taxable: false },
        ],
      },
    });

    expect(r!.earnings.filter((e) => e.kind === 'ONE_TIME')).toEqual([
      expect.objectContaining({ name: 'Diwali bonus', taxable: true, refId: 'otp-1' }),
      expect.objectContaining({ name: 'Relocation', taxable: false, refId: 'otp-2' }),
    ]);
    expect(r!.deductions.filter((d) => d.kind === 'ONE_TIME')).toEqual([
      expect.objectContaining({ name: 'Laptop damage', refId: 'otp-3' }),
    ]);
    expect(r!.grossPay.toString()).toBe('75000'); // 65,000 + taxable bonus
    expect(r!.nonRecurringTaxable.toString()).toBe('10000');
    expect(r!.nonTaxableEarnings.toString()).toBe('3000');
    // 75,000 + 3,000 - 500 canteen - 2,000 recovery.
    expect(r!.netPay.toString()).toBe('75500');
    expect(r!.totalDeductions.toString()).toBe('2500');
  });

  it('pays reimbursements and released held salary on top of the gross, untaxed', async () => {
    const r = await service.calculateForEmployee(tenantId, employeeId, month, year, {
      extras: {
        reimbursements: [
          { id: 'cl-1', amount: new Decimal(1200) },
          { id: 'cl-2', amount: new Decimal(800) },
        ],
        holdReleases: [{ id: 'hold-1', amount: new Decimal(52000), heldMonth: 3, heldYear: 2026 }],
      },
    });

    expect(r!.earnings.find((e) => e.kind === 'REIMBURSEMENT')).toMatchObject({
      name: 'Reimbursements', taxable: false,
    });
    expect(r!.earnings.find((e) => e.kind === 'HOLD_RELEASE')).toMatchObject({
      name: 'Held salary release (Mar 2026)', taxable: false, refId: 'hold-1',
    });
    expect(r!.grossPay.toString()).toBe('65000');
    expect(r!.reimbursementAmount.toString()).toBe('2000');
    expect(r!.nonTaxableEarnings.toString()).toBe('54000');
    expect(r!.netPay.toString()).toBe('118500'); // 65,000 + 54,000 - 500
    expect(statutory.compute.mock.calls[0][0].grossPay.toString()).toBe('65000');
  });

  it('lets loan instalments eat into the untaxed earnings before clamping', async () => {
    loans.getPayrollDeductions.mockResolvedValue({
      total: 70000,
      lines: [{ loanId: 'loan-1', type: 'PERSONAL', amount: 70000 }],
    });

    const r = await service.calculateForEmployee(tenantId, employeeId, month, year, {
      extras: { reimbursements: [{ id: 'cl-1', amount: new Decimal(1000) }] },
    });

    // 65,000 + 1,000 - 500 leaves 65,500 for the loan.
    expect(r!.loanRepayments).toEqual([{ loanId: 'loan-1', amount: 65500 }]);
    expect(r!.netPay.toString()).toBe('0');
  });

  it('does not ask for loan instalments when loans are not deducted (off-cycle)', async () => {
    await service.calculateForEmployee(tenantId, employeeId, month, year, {
      deductLoans: false,
      chargeMonthlyStatutory: false,
      payrollRunId: 'run-oc',
    });

    expect(loans.getPayrollDeductions).not.toHaveBeenCalled();
    const input = statutory.compute.mock.calls[0][0];
    expect(input.chargeMonthlyStatutory).toBe(false);
    expect(input.excludePayrollRunId).toBe('run-oc');
  });

  describe('without salary (off-cycle, includeSalary false)', () => {
    it('returns no payslip when there is nothing to pay', async () => {
      const r = await service.calculateForEmployee(tenantId, employeeId, month, year, {
        includeSalary: false,
        deductLoans: false,
        chargeMonthlyStatutory: false,
      });
      expect(r).toBeNull();
      expect(prisma.employeeSalary.findFirst).not.toHaveBeenCalled();
      expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
    });

    it('pays only the extras, with no base pay, components or attendance', async () => {
      const r = await service.calculateForEmployee(tenantId, employeeId, month, year, {
        includeSalary: false,
        deductLoans: false,
        chargeMonthlyStatutory: false,
        extras: {
          oneTimePayments: [
            { id: 'otp-1', kind: 'INCENTIVE', name: 'Q3 incentive', amount: new Decimal(8000), taxable: true },
          ],
        },
      });

      expect(r!.basePay.toString()).toBe('0');
      expect(r!.workingDays).toBe(0);
      expect(r!.earnings.map((e) => e.name)).toEqual(['Q3 incentive']);
      expect(r!.grossPay.toString()).toBe('8000');
      expect(r!.netPay.toString()).toBe('8000');
      expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled();
      // The employee's statutory attributes still come from the record.
      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: employeeId, tenantId } }),
      );
    });

    it('projects the regular salary for TDS on the non-recurring amount', async () => {
      // The month's regular run has already paid October.
      prisma.payslip.findFirst.mockResolvedValue({ id: 'slip-regular' });

      await service.calculateForEmployee(tenantId, employeeId, month, year, {
        includeSalary: false,
        deductLoans: false,
        chargeMonthlyStatutory: false,
        offCycle: true,
        extras: {
          oneTimePayments: [
            { id: 'otp-1', kind: 'BONUS', name: 'Bonus', amount: new Decimal(8000), taxable: true },
          ],
        },
      });

      const input = statutory.compute.mock.calls[0][0];
      // 40,000 + 20,000 HRA + 5,000 DA, prorated over a full month.
      expect(input.offCycleProjection.regularMonthlyGross.toString()).toBe('65000');
      // October paid already: November to March still to come.
      expect(input.offCycleProjection.monthsAhead).toBe(5);
      expect(input.nonRecurringTaxable.toString()).toBe('8000');
    });
  });

  describe('a settlement carried by an off-cycle run', () => {
    const settlement = {
      id: 'set-1',
      proRataSalary: new Decimal(20000),
      leaveEncashment: new Decimal(30000),
      leaveEncashmentExempt: new Decimal(10000),
      gratuity: new Decimal(50000),
      gratuityExempt: new Decimal(50000),
      otherEarnings: new Decimal(0),
      noticeRecovery: new Decimal(5000),
      otherRecoveries: new Decimal(1000),
      totalRecoveries: new Decimal(9000), // includes 3,000 of loan recovery
      tds: new Decimal(4000),
      netPayable: new Decimal(87000),
    };

    it('copies the settlement verbatim, with no recalculation', async () => {
      const r = await service.calculateForEmployee(tenantId, employeeId, month, year, {
        includeSalary: false,
        deductLoans: false,
        chargeMonthlyStatutory: false,
        extras: { settlement },
      });

      expect(statutory.compute).not.toHaveBeenCalled();
      expect(prisma.employeeSalary.findFirst).not.toHaveBeenCalled();
      expect(r!.earnings.every((e) => e.kind === 'SETTLEMENT' && e.refId === 'set-1')).toBe(true);
      // Taxable: 20,000 + 20,000 encashment; exempt: 10,000 + 50,000.
      expect(r!.grossPay.toString()).toBe('40000');
      expect(r!.nonTaxableEarnings.toString()).toBe('60000');
      expect(r!.statutory.tds.toString()).toBe('4000');
      expect(r!.deductions.map((d) => [d.name, d.kind, d.amount.toString()])).toEqual([
        ['Notice pay recovery', 'SETTLEMENT', '5000'],
        ['Other recoveries', 'SETTLEMENT', '1000'],
        ['Loan recovery', 'LOAN', '3000'],
        ['TDS', 'STATUTORY', '4000'],
      ]);
      expect(r!.netPay.toString()).toBe('87000');
      expect(r!.loanRepayments).toEqual([]);
    });

    it('refuses when the payslip would not pay exactly the settlement', async () => {
      await expect(
        service.calculateForEmployee(tenantId, employeeId, month, year, {
          includeSalary: false,
          extras: { settlement: { ...settlement, netPayable: new Decimal(90000) } },
        }),
      ).rejects.toThrow(/does not match/);
    });
  });

  describe('calculateRegularEarnings', () => {
    it("values a month's regular earnings with a given salary row, prorated, without statutory", async () => {
      prisma.employeeSalary.findFirst.mockResolvedValue({ ...salaryRow, id: 'es-2', basePay: 50000 });

      const r = await service.calculateRegularEarnings(tenantId, employeeId, month, year, 'es-2');

      expect(prisma.employeeSalary.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'es-2', tenantId, employeeId } }),
      );
      expect(r!.basePay.toString()).toBe('50000');
      expect(r!.earnings.map((e) => [e.name, e.amount.toString()])).toEqual([
        ['HRA', '25000'],
        ['DA', '5000'],
      ]);
      expect(r!.total.toString()).toBe('80000');
      expect(r!.pfWages.toString()).toBe('55000');
      expect(r!.pfApplicableNames).toEqual(['DA']);
      expect(statutory.compute).not.toHaveBeenCalled();
      expect(loans.getPayrollDeductions).not.toHaveBeenCalled();
    });

    it('prorates for loss of pay the same way the payslip does', async () => {
      // Two ABSENT weekdays out of 22 are loss of pay under the default policy.
      const rows = fullMonthAttendance();
      rows[0].status = 'ABSENT';
      rows[1].status = 'ABSENT';
      prisma.attendanceRecord.findMany.mockResolvedValue(rows);
      prisma.attendancePolicy.findUnique.mockResolvedValue(null);

      const r = await service.calculateRegularEarnings(tenantId, employeeId, month, year, 'es-1');

      // 40,000 x 20/22.
      expect(r!.basePay.toString()).toBe('36363.64');
    });

    it('returns null for a salary row of another employee or tenant', async () => {
      prisma.employeeSalary.findFirst.mockResolvedValue(null);
      await expect(
        service.calculateRegularEarnings(tenantId, employeeId, month, year, 'es-x'),
      ).resolves.toBeNull();
    });
  });
});
