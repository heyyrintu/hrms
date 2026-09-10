import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService, mockEmployee, mockHrAdmin } from '../../../test/helpers';
import * as calculators from '../statutory/statutory.calculators';
import { Form16Service, financialYearLabel, assessmentYearLabel, quarterOfFy } from './form16.service';

// ---------------------------------------------------------------------------
// Fixtures
//
// Every figure below is chosen so the expectations can be worked by hand; the
// arithmetic is spelled out in the comment above each assertion block.
// ---------------------------------------------------------------------------

const TENANT = 'tenant-1';
const EMPLOYEE = 'emp-1';
const FY = 2025; // FY 2025-26, assessment year 2026-27

/** The twelve months of FY 2025-26 in payroll-run order. */
const FY_MONTHS: { month: number; year: number }[] = [
  { month: 4, year: 2025 },
  { month: 5, year: 2025 },
  { month: 6, year: 2025 },
  { month: 7, year: 2025 },
  { month: 8, year: 2025 },
  { month: 9, year: 2025 },
  { month: 10, year: 2025 },
  { month: 11, year: 2025 },
  { month: 12, year: 2025 },
  { month: 1, year: 2026 },
  { month: 2, year: 2026 },
  { month: 3, year: 2026 },
];

function payslips(gross: number, professionalTax: number, tds: number) {
  return FY_MONTHS.map((m, i) => ({
    id: `slip-${i}`,
    grossPay: new Decimal(gross),
    professionalTax: new Decimal(professionalTax),
    tds: new Decimal(tds),
    pfEmployee: new Decimal(1800),
    payrollRun: { month: m.month, year: m.year },
  }));
}

const employeeRow = {
  id: EMPLOYEE,
  employeeCode: 'E001',
  firstName: 'Asha',
  lastName: 'Rao',
  pan: 'ABCDE1234F',
  designation: null,
  taxRegime: null,
  joinDate: new Date('2020-06-01T12:00:00Z'),
};

const tenantRow = {
  id: TENANT,
  name: 'Drona Logitech',
  legalName: 'Drona Logitech Private Limited',
  addressLine1: '12 MG Road',
  addressLine2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pinCode: '560001',
  country: 'India',
  pan: 'AAACD1234E',
  tan: 'BLRD12345E',
};

const oldRegimeDeclaration = {
  regime: 'OLD',
  section80C: new Decimal(150000),
  section80D: new Decimal(25000),
  section80CCD1B: new Decimal(50000),
  section80CCD2: new Decimal(0),
  hraExemption: new Decimal(120000),
  homeLoanInterest: new Decimal(0),
  otherDeductions: new Decimal(0),
  otherIncome: new Decimal(0),
  previousEmployerTds: new Decimal(0),
};

const oldRegimeTaxConfig = {
  standardDeduction: new Decimal(50000),
  rebateIncomeLimit: new Decimal(500000),
  rebateMaxAmount: new Decimal(12500),
  cessRate: new Decimal(4),
  surchargeSlabs: [],
  slabs: [
    { fromAmount: new Decimal(0), toAmount: new Decimal(250000), rate: new Decimal(0) },
    { fromAmount: new Decimal(250000), toAmount: new Decimal(500000), rate: new Decimal(5) },
    { fromAmount: new Decimal(500000), toAmount: new Decimal(1000000), rate: new Decimal(20) },
    { fromAmount: new Decimal(1000000), toAmount: null, rate: new Decimal(30) },
  ],
};

const newRegimeTaxConfig = {
  standardDeduction: new Decimal(75000),
  rebateIncomeLimit: new Decimal(700000),
  rebateMaxAmount: new Decimal(25000),
  cessRate: new Decimal(4),
  surchargeSlabs: [],
  slabs: [
    { fromAmount: new Decimal(0), toAmount: new Decimal(300000), rate: new Decimal(0) },
    { fromAmount: new Decimal(300000), toAmount: new Decimal(700000), rate: new Decimal(5) },
    { fromAmount: new Decimal(700000), toAmount: new Decimal(1000000), rate: new Decimal(10) },
    { fromAmount: new Decimal(1000000), toAmount: new Decimal(1200000), rate: new Decimal(15) },
    { fromAmount: new Decimal(1200000), toAmount: new Decimal(1500000), rate: new Decimal(20) },
    { fromAmount: new Decimal(1500000), toAmount: null, rate: new Decimal(30) },
  ],
};

// ---------------------------------------------------------------------------

describe('financialYearLabel / assessmentYearLabel', () => {
  it('labels the year the way the department writes it', () => {
    expect(financialYearLabel(2025)).toBe('2025-26');
    expect(assessmentYearLabel(2025)).toBe('2026-27');
    expect(financialYearLabel(2029)).toBe('2029-30');
    expect(assessmentYearLabel(2029)).toBe('2030-31');
  });
});

describe('quarterOfFy', () => {
  it('starts the quarters in April, not January', () => {
    expect(quarterOfFy(4)).toBe(1);
    expect(quarterOfFy(6)).toBe(1);
    expect(quarterOfFy(7)).toBe(2);
    expect(quarterOfFy(9)).toBe(2);
    expect(quarterOfFy(10)).toBe(3);
    expect(quarterOfFy(12)).toBe(3);
    expect(quarterOfFy(1)).toBe(4);
    expect(quarterOfFy(3)).toBe(4);
  });
});

describe('Form16Service.computePartB', () => {
  let service: Form16Service;
  let prisma: any;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [Form16Service, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<Form16Service>(Form16Service);

    prisma.employee.findFirst.mockResolvedValue(employeeRow);
    prisma.tenant.findUnique.mockResolvedValue(tenantRow);
    prisma.statutoryConfig.findUnique.mockResolvedValue({ defaultTaxRegime: 'NEW' });
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue(oldRegimeDeclaration);
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(oldRegimeTaxConfig);
    prisma.payslip.findMany.mockResolvedValue(payslips(100000, 200, 5000));
  });

  it('aggregates the year and lays it out as the numbered Part B breakdown', async () => {
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // Twelve months at 1,00,000 gross, 200 professional tax, 5,000 TDS.
    //  1. gross salary                            12,00,000
    //  2. less HRA exempt under section 10         1,20,000
    //  3. balance                                 10,80,000
    //  4. section 16: 50,000 standard + 2,400 PT     52,400
    //  5. income chargeable under Salaries         10,27,600
    //  6. other income / house property                  nil
    //  7. gross total income                       10,27,600
    //  8. chapter VI-A: 1,50,000 + 25,000 + 50,000  2,25,000
    //  9. total income                              8,02,600
    // 10. tax: 2,50,000 @5% = 12,500;
    //          3,02,600 @20% = 60,520                73,020
    // 11. rebate (total income above 5,00,000)           nil
    // 12. surcharge                                      nil
    // 13. cess at 4% of 73,020 = 2,920.80 -> 2,921      2,921
    // 14. total tax                                    75,941
    // 15. tax deducted (12 x 5,000)                    60,000
    expect(result.grossSalary.toFixed(2)).toBe('1200000.00');
    expect(result.allowancesExemptSection10.toFixed(2)).toBe('120000.00');
    expect(result.balance.toFixed(2)).toBe('1080000.00');
    expect(result.deductionsSection16.standardDeduction.toFixed(2)).toBe('50000.00');
    expect(result.deductionsSection16.professionalTax.toFixed(2)).toBe('2400.00');
    expect(result.deductionsSection16.total.toFixed(2)).toBe('52400.00');
    expect(result.incomeChargeableUnderSalaries.toFixed(2)).toBe('1027600.00');
    expect(result.otherIncome.toFixed(2)).toBe('0.00');
    expect(result.incomeFromHouseProperty.toFixed(2)).toBe('0.00');
    expect(result.grossTotalIncome.toFixed(2)).toBe('1027600.00');
    expect(result.deductionsChapterVIA.total.toFixed(2)).toBe('225000.00');
    expect(result.totalIncome.toFixed(2)).toBe('802600.00');
    expect(result.taxOnTotalIncome.toFixed(2)).toBe('73020.00');
    expect(result.rebateSection87A.toFixed(2)).toBe('0.00');
    expect(result.surcharge.toFixed(2)).toBe('0.00');
    expect(result.healthAndEducationCess.toFixed(2)).toBe('2921.00');
    expect(result.totalTaxPayable.toFixed(2)).toBe('75941.00');
    expect(result.taxDeductedByEmployer.toFixed(2)).toBe('60000.00');
    expect(result.taxDeductedByPreviousEmployer.toFixed(2)).toBe('0.00');
    expect(result.totalTaxDeducted.toFixed(2)).toBe('60000.00');
  });

  it('reports the balance still payable when the year under-deducted', async () => {
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // 75,941 due against 60,000 collected.
    expect(result.balanceTaxPayable.toFixed(2)).toBe('15941.00');
    expect(result.refundDue.toFixed(2)).toBe('0.00');
  });

  it('reports a refund rather than a negative balance when over-deducted', async () => {
    prisma.payslip.findMany.mockResolvedValue(payslips(100000, 200, 8000));

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // 12 x 8,000 = 96,000 collected against 75,941 due.
    expect(result.totalTaxDeducted.toFixed(2)).toBe('96000.00');
    expect(result.balanceTaxPayable.toFixed(2)).toBe('0.00');
    expect(result.refundDue.toFixed(2)).toBe('20059.00');
  });

  it('denies the old regime its exemptions when the employee is on the new one', async () => {
    prisma.employee.findFirst.mockResolvedValue({ ...employeeRow, taxRegime: 'NEW' });
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue({
      ...oldRegimeDeclaration,
      regime: 'NEW',
      section80CCD2: new Decimal(60000),
    });
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(newRegimeTaxConfig);

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    //  1. gross salary                            12,00,000
    //  2. HRA is not exempt under the new regime         nil
    //  4. section 16: standard deduction only        75,000
    //     (professional tax under 16(iii) is not available)
    //  5/7. income chargeable                      11,25,000
    //  8. chapter VI-A: 80CCD(2) only                60,000
    //  9. total income                             10,65,000
    // 10. 4,00,000 @5% = 20,000; 3,00,000 @10% = 30,000;
    //     65,000 @15% = 9,750                        59,750
    // 13. cess 4%                                     2,390
    // 14. total tax                                  62,140
    expect(result.regime).toBe('NEW');
    expect(result.allowancesExemptSection10.toFixed(2)).toBe('0.00');
    expect(result.deductionsSection16.professionalTax.toFixed(2)).toBe('0.00');
    expect(result.deductionsSection16.total.toFixed(2)).toBe('75000.00');
    expect(result.deductionsChapterVIA.section80C.toFixed(2)).toBe('0.00');
    expect(result.deductionsChapterVIA.section80CCD2.toFixed(2)).toBe('60000.00');
    expect(result.deductionsChapterVIA.total.toFixed(2)).toBe('60000.00');
    expect(result.totalIncome.toFixed(2)).toBe('1065000.00');
    expect(result.taxOnTotalIncome.toFixed(2)).toBe('59750.00');
    expect(result.healthAndEducationCess.toFixed(2)).toBe('2390.00');
    expect(result.totalTaxPayable.toFixed(2)).toBe('62140.00');
  });

  it('adds the previous employer’s TDS to the tax already collected', async () => {
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue({
      ...oldRegimeDeclaration,
      previousEmployerTds: new Decimal(9000),
    });

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.taxDeductedByEmployer.toFixed(2)).toBe('60000.00');
    expect(result.taxDeductedByPreviousEmployer.toFixed(2)).toBe('9000.00');
    expect(result.totalTaxDeducted.toFixed(2)).toBe('69000.00');
    // 75,941 due against 69,000 collected.
    expect(result.balanceTaxPayable.toFixed(2)).toBe('6941.00');
  });

  it('carries a house property loss as negative other-head income', async () => {
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue({
      ...oldRegimeDeclaration,
      homeLoanInterest: new Decimal(200000),
      otherIncome: new Decimal(30000),
    });

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // 10,27,600 salary + 30,000 other income - 2,00,000 house property loss.
    expect(result.incomeFromHouseProperty.toFixed(2)).toBe('-200000.00');
    expect(result.otherIncome.toFixed(2)).toBe('30000.00');
    expect(result.grossTotalIncome.toFixed(2)).toBe('857600.00');
    expect(result.totalIncome.toFixed(2)).toBe('632600.00');
  });

  // -------------------------------------------------------------------------
  // Tenant scoping
  // -------------------------------------------------------------------------

  it('scopes every query it makes to the tenant', async () => {
    await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(prisma.employee.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: EMPLOYEE, tenantId: TENANT }) }),
    );
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TENANT } }),
    );
    expect(prisma.payslip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, employeeId: EMPLOYEE }),
      }),
    );
    expect(prisma.employeeTaxDeclaration.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_employeeId_financialYear: {
            tenantId: TENANT,
            employeeId: EMPLOYEE,
            financialYear: FY,
          },
        },
      }),
    );
    // The unique key gained an age band; this employee has no date of birth
    // on record, so it reads as GENERAL — the safe default.
    expect(prisma.incomeTaxConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_financialYear_regime_ageBand: {
            tenantId: TENANT,
            financialYear: FY,
            regime: 'OLD',
            ageBand: 'GENERAL',
          },
        },
      }),
    );
  });

  it('reads only the April-to-March window of the financial year', async () => {
    await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    const where = prisma.payslip.findMany.mock.calls[0][0].where;
    expect(where.payrollRun.OR).toEqual([
      { year: 2025, month: { gte: 4 } },
      { year: 2026, month: { lte: 3 } },
    ]);
  });

  // -------------------------------------------------------------------------
  // Degenerate years
  // -------------------------------------------------------------------------

  it('returns a nil certificate, not an error, when there were no payslips', async () => {
    prisma.payslip.findMany.mockResolvedValue([]);

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.hasPayslipsInYear).toBe(false);
    expect(result.grossSalary.toFixed(2)).toBe('0.00');
    expect(result.totalIncome.toFixed(2)).toBe('0.00');
    expect(result.totalTaxPayable.toFixed(2)).toBe('0.00');
    expect(result.totalTaxDeducted.toFixed(2)).toBe('0.00');
    expect(result.balanceTaxPayable.toFixed(2)).toBe('0.00');
    expect(result.quarterlyTds).toHaveLength(4);
    expect(result.notes.join(' ')).toMatch(/no payslip/i);
  });

  it('says so rather than guessing when the year has no tax slabs configured', async () => {
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(null);

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // The salary still happened and the TDS was still collected; only the
    // liability is unknown.
    expect(result.grossSalary.toFixed(2)).toBe('1200000.00');
    expect(result.totalTaxDeducted.toFixed(2)).toBe('60000.00');
    expect(result.taxOnTotalIncome.toFixed(2)).toBe('0.00');
    expect(result.totalTaxPayable.toFixed(2)).toBe('0.00');
    expect(result.notes.join(' ')).toMatch(/income tax (slabs|configuration)/i);
  });

  it('treats a missing declaration as a nil declaration', async () => {
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue(null);

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // Falls back to the tenant default regime, which the fixture sets to NEW.
    expect(result.regime).toBe('NEW');
    expect(result.deductionsChapterVIA.total.toFixed(2)).toBe('0.00');
    expect(result.allowancesExemptSection10.toFixed(2)).toBe('0.00');
  });

  it('rejects an employee who does not belong to the tenant', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);

    await expect(
      service.computePartB(TENANT, 'someone-else', FY, mockHrAdmin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // -------------------------------------------------------------------------
  // Authorisation
  // -------------------------------------------------------------------------

  it('lets an employee fetch their own certificate', async () => {
    prisma.employee.findFirst.mockResolvedValue({
      ...employeeRow,
      id: mockEmployee.employeeId,
    });

    const result = await service.computePartB(
      mockEmployee.tenantId,
      mockEmployee.employeeId!,
      FY,
      mockEmployee,
    );

    expect(result.employee.id).toBe(mockEmployee.employeeId);
  });

  it('refuses an employee asking for somebody else’s certificate', async () => {
    await expect(
      service.computePartB(mockEmployee.tenantId, 'emp-someone-else', FY, mockEmployee),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses before it reads anything, so nothing leaks through the error', async () => {
    await expect(
      service.computePartB(mockEmployee.tenantId, 'emp-someone-else', FY, mockEmployee),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    expect(prisma.payslip.findMany).not.toHaveBeenCalled();
  });

  it('refuses a manager the same way; the scope here is self or HR, not a team', async () => {
    const manager = {
      userId: 'u',
      email: 'm@test.com',
      tenantId: TENANT,
      role: 'MANAGER' as never,
      employeeId: 'emp-manager',
    };

    await expect(
      service.computePartB(TENANT, EMPLOYEE, FY, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets HR fetch anybody in their own tenant', async () => {
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);
    expect(result.employee.id).toBe(EMPLOYEE);
  });

  it('refuses a caller with no employee record when asking for a named employee', async () => {
    const orphan = {
      userId: 'u',
      email: 'o@test.com',
      tenantId: TENANT,
      role: 'EMPLOYEE' as never,
      employeeId: undefined,
    };

    await expect(
      service.computePartB(TENANT, EMPLOYEE, FY, orphan),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // -------------------------------------------------------------------------
  // Identification block
  // -------------------------------------------------------------------------

  it('carries the identifiers a certificate is worthless without', async () => {
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.financialYear).toBe(2025);
    expect(result.financialYearLabel).toBe('2025-26');
    expect(result.assessmentYear).toBe('2026-27');
    expect(result.employer.name).toBe('Drona Logitech Private Limited');
    expect(result.employer.tan).toBe('BLRD12345E');
    expect(result.employer.pan).toBe('AAACD1234E');
    expect(result.employer.address).toContain('Bengaluru');
    expect(result.employee.pan).toBe('ABCDE1234F');
    expect(result.employee.name).toBe('Asha Rao');
    expect(result.periodFrom).toBe('2025-04-01');
    expect(result.periodTo).toBe('2026-03-31');
  });

  it('flags a missing TAN or PAN instead of printing a blank certificate quietly', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ ...tenantRow, tan: null });
    prisma.employee.findFirst.mockResolvedValue({ ...employeeRow, pan: null });

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.notes.join(' ')).toMatch(/TAN/);
    expect(result.notes.join(' ')).toMatch(/PAN/);
  });

  it('always states that this is not the TRACES-issued certificate', async () => {
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);
    expect(result.notes.join(' ')).toMatch(/TRACES/);
  });

  // -------------------------------------------------------------------------
  // Age band: must select the same slabs the monthly TDS engine would, so the
  // certificate cannot disagree with the year's payslips.
  // -------------------------------------------------------------------------

  it('reports GENERAL as the age band when the employee has no date of birth on record', async () => {
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.ageBand).toBe('GENERAL');
    expect(result.ageBandFallbackApplied).toBe(false);
  });

  it('selects the age band from date of birth as at 31 March, matching the monthly TDS engine', async () => {
    // Born 20 February 1966: 60 on 31 March 2026, the last day of FY 2025-26.
    prisma.employee.findFirst.mockResolvedValue({
      ...employeeRow,
      dateOfBirth: new Date(Date.UTC(1966, 1, 20)),
    });

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.ageBand).toBe('SENIOR');
    expect(prisma.incomeTaxConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_financialYear_regime_ageBand: {
            tenantId: TENANT,
            financialYear: FY,
            regime: 'OLD',
            ageBand: 'SENIOR',
          },
        },
      }),
    );
  });

  it('falls back to GENERAL, and notes it, when the SENIOR row is missing — the liability is not left nil', async () => {
    prisma.employee.findFirst.mockResolvedValue({
      ...employeeRow,
      dateOfBirth: new Date(Date.UTC(1966, 1, 20)), // senior for FY 2025-26
    });
    prisma.incomeTaxConfig.findUnique
      .mockResolvedValueOnce(null) // the SENIOR lookup
      .mockResolvedValueOnce(oldRegimeTaxConfig); // the GENERAL fallback

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.ageBand).toBe('GENERAL');
    expect(result.ageBandFallbackApplied).toBe(true);
    expect(result.notes.join(' ')).toMatch(/GENERAL slabs were used/);
    // Same figure as the ordinary GENERAL-band computation above: the
    // liability is computed on the fallback slabs, not left nil.
    expect(result.totalTaxPayable.toFixed(2)).toBe('75941.00');
  });

  it('passes the Chapter VI-A ceilings and marginal relief flag to the calculator', async () => {
    prisma.incomeTaxConfig.findUnique.mockResolvedValue({
      ...oldRegimeTaxConfig,
      section80CLimit: new Decimal(120000),
      section80DLimit: new Decimal(20000),
      section80CCD1BLimit: new Decimal(40000),
      marginalReliefEnabled: false,
    });

    const spy = jest.spyOn(calculators, 'calculateIncomeTax');

    await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ marginalReliefEnabled: false }),
      expect.anything(),
      expect.anything(),
    );
    const passedLimits = (spy.mock.calls[0][1] as any).limits;
    expect(passedLimits.section80C.toString()).toBe('120000');
    expect(passedLimits.section80D.toString()).toBe('20000');
    expect(passedLimits.section80CCD1B.toString()).toBe('40000');

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe('Form16Service.getQuarterlyTdsSummary', () => {
  let service: Form16Service;
  let prisma: any;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [Form16Service, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<Form16Service>(Form16Service);

    prisma.employee.findFirst.mockResolvedValue(employeeRow);
    prisma.payslip.findMany.mockResolvedValue(payslips(100000, 200, 5000));
  });

  it('buckets the year into the four return quarters, April first', async () => {
    const result = await service.getQuarterlyTdsSummary(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.quarters).toHaveLength(4);
    expect(result.quarters.map((q) => q.quarter)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(result.quarters[0].months).toEqual(['April', 'May', 'June']);
    expect(result.quarters[3].months).toEqual(['January', 'February', 'March']);
  });

  it('totals three months of pay and tax into each quarter', async () => {
    const result = await service.getQuarterlyTdsSummary(TENANT, EMPLOYEE, FY, mockHrAdmin);

    for (const q of result.quarters) {
      // Three months at 1,00,000 paid and 5,000 deducted.
      expect(q.amountPaid.toFixed(2)).toBe('300000.00');
      expect(q.taxDeducted.toFixed(2)).toBe('15000.00');
      expect(q.payslipCount).toBe(3);
    }
    expect(result.totalTaxDeducted.toFixed(2)).toBe('60000.00');
    expect(result.totalAmountPaid.toFixed(2)).toBe('1200000.00');
  });

  it('shows an empty quarter as nil rather than omitting it', async () => {
    // Someone who joined in October: only Q3 and Q4 have payslips.
    prisma.payslip.findMany.mockResolvedValue(
      payslips(100000, 200, 5000).filter((p) =>
        [10, 11, 12, 1, 2, 3].includes(p.payrollRun.month),
      ),
    );

    const result = await service.getQuarterlyTdsSummary(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.quarters).toHaveLength(4);
    expect(result.quarters[0].taxDeducted.toFixed(2)).toBe('0.00');
    expect(result.quarters[0].payslipCount).toBe(0);
    expect(result.quarters[2].taxDeducted.toFixed(2)).toBe('15000.00');
    expect(result.totalTaxDeducted.toFixed(2)).toBe('30000.00');
  });

  it('leaves the TRACES receipt numbers null, because only TRACES issues them', async () => {
    const result = await service.getQuarterlyTdsSummary(TENANT, EMPLOYEE, FY, mockHrAdmin);

    for (const q of result.quarters) {
      expect(q.tracesReceiptNumber).toBeNull();
    }
    expect(result.notes.join(' ')).toMatch(/TRACES/);
  });

  it('refuses an employee asking for somebody else’s quarters', async () => {
    await expect(
      service.getQuarterlyTdsSummary(TENANT, 'emp-someone-else', FY, mockEmployee),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes the payslip read to the tenant', async () => {
    await service.getQuarterlyTdsSummary(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(prisma.payslip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, employeeId: EMPLOYEE }),
      }),
    );
  });
});

describe('Form16Service.computePartB — section 10 exemptions beyond house rent', () => {
  let service: Form16Service;
  let prisma: any;

  /** The old-regime declaration, plus the three section 10 heads. */
  const withSection10 = {
    ...oldRegimeDeclaration,
    ltaExemption: new Decimal(45000),
    childrenEducationAllowance: new Decimal(5000),
    hostelAllowance: new Decimal(9000),
    childrenCount: 1,
  };

  const taxConfigWithSection10 = {
    ...oldRegimeTaxConfig,
    childrenEducationMonthlyLimit: new Decimal(100),
    hostelAllowanceMonthlyLimit: new Decimal(300),
    childrenAllowanceMaxChildren: 2,
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [Form16Service, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<Form16Service>(Form16Service);

    prisma.employee.findFirst.mockResolvedValue(employeeRow);
    prisma.tenant.findUnique.mockResolvedValue(tenantRow);
    prisma.statutoryConfig.findUnique.mockResolvedValue({ defaultTaxRegime: 'NEW' });
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue(withSection10);
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(taxConfigWithSection10);
    prisma.payslip.findMany.mockResolvedValue(payslips(100000, 200, 5000));
  });

  it('puts all four exempt allowances on line 2, not among the Chapter VI-A deductions', async () => {
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // One child, so the two section 10(14) ceilings are 100 x 12 = 1,200 and
    // 300 x 12 = 3,600 for the year.
    //
    //  1. gross salary                            12,00,000
    //  2. exempt under section 10:
    //       house rent                             1,20,000
    //       leave travel                             45,000
    //       education (1,200 of the 5,000 claimed)    1,200
    //       hostel (3,600 of the 9,000 claimed)       3,600
    //                                              1,69,800
    //  3. balance                                 10,30,200
    //  4. section 16: 50,000 standard + 2,400 PT     52,400
    //  5/7. income chargeable / gross total         9,77,800
    //  8. chapter VI-A: 1,50,000 + 25,000 + 50,000  2,25,000
    //  9. total income                              7,52,800
    // 10. tax: 2,50,000 @5% = 12,500;
    //          2,52,800 @20% = 50,560                63,060
    // 13. cess at 4% of 63,060 = 2,522.40 -> 2,522    2,522
    // 14. total tax                                  65,582
    expect(result.allowancesExemptSection10.toFixed(2)).toBe('169800.00');
    expect(result.balance.toFixed(2)).toBe('1030200.00');
    expect(result.incomeChargeableUnderSalaries.toFixed(2)).toBe('977800.00');
    // The three new heads reduce salary. None of them may appear on line 8.
    expect(result.deductionsChapterVIA.total.toFixed(2)).toBe('225000.00');
    expect(result.totalIncome.toFixed(2)).toBe('752800.00');
    expect(result.taxOnTotalIncome.toFixed(2)).toBe('63060.00');
    expect(result.healthAndEducationCess.toFixed(2)).toBe('2522.00');
    expect(result.totalTaxPayable.toFixed(2)).toBe('65582.00');
  });

  it('reconciles line 9 with the taxable income the tax engine used', async () => {
    // The certificate and the payslips must not hold two opinions of the same
    // year. The service warns into `notes` when they diverge, so an empty
    // divergence note is the assertion that they did not.
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.notes.some((n) => n.includes('does not reconcile'))).toBe(false);
  });

  it('shows what each head claimed against what it was allowed', async () => {
    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    const byHead = new Map(
      (result.allowancesExemptSection10Breakdown ?? []).map((e) => [e.head, e]),
    );

    expect(byHead.get('HRA')?.allowed.toFixed(2)).toBe('120000.00');
    expect(byHead.get('LTA')?.allowed.toFixed(2)).toBe('45000.00');
    expect(byHead.get('LTA')?.limit).toBeNull();
    expect(byHead.get('CHILDREN_EDUCATION')?.declared.toFixed(2)).toBe('5000.00');
    expect(byHead.get('CHILDREN_EDUCATION')?.limit?.toFixed(2)).toBe('1200.00');
    expect(byHead.get('CHILDREN_EDUCATION')?.allowed.toFixed(2)).toBe('1200.00');
    expect(byHead.get('CHILDREN_EDUCATION')?.disallowed.toFixed(2)).toBe('3800.00');
    expect(byHead.get('HOSTEL_ALLOWANCE')?.limit?.toFixed(2)).toBe('3600.00');
    expect(byHead.get('HOSTEL_ALLOWANCE')?.disallowed.toFixed(2)).toBe('5400.00');
  });

  it('exempts none of them on a new-regime certificate', async () => {
    prisma.employee.findFirst.mockResolvedValue({ ...employeeRow, taxRegime: 'NEW' });
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue({
      ...withSection10,
      regime: 'NEW',
    });
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(newRegimeTaxConfig);

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // Section 115BAC withdraws all four, so line 2 is nil and line 3 is the
    // whole of the gross salary.
    expect(result.allowancesExemptSection10.toFixed(2)).toBe('0.00');
    expect(result.balance.toFixed(2)).toBe('1200000.00');
    expect(result.allowancesExemptSection10Breakdown).toEqual([]);
  });

  it('still caps line 2 on a certificate with no slabs to compute a liability from', async () => {
    // No income tax configuration for the year: lines 10 to 14 are nil and a
    // note says why, but the salary lines are still reported — and an
    // uncapped 5,000 of school fees on line 2 would be as wrong there as
    // anywhere else.
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(null);

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    // 1,20,000 house rent + 45,000 leave travel + 1,200 education +
    // 3,600 hostel, on the statutory ceilings the calculator falls back to.
    expect(result.allowancesExemptSection10.toFixed(2)).toBe('169800.00');
    expect(result.totalTaxPayable.toFixed(2)).toBe('0.00');
  });

  it('leaves a certificate that declares none of them exactly as it was', async () => {
    // The regression that matters: no certificate already issued may change
    // because three new heads exist on the declaration.
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue(oldRegimeDeclaration);
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(oldRegimeTaxConfig);

    const result = await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(result.allowancesExemptSection10.toFixed(2)).toBe('120000.00');
    expect(result.totalIncome.toFixed(2)).toBe('802600.00');
    expect(result.totalTaxPayable.toFixed(2)).toBe('75941.00');
  });

  it('uses verified amounts on the certificate when the employer requires proofs', async () => {
    // The year's TDS was computed from approved proofs once verification bit.
    // A certificate built from the declaration instead would show more exempt
    // than the payslips allowed, and the two must not disagree.
    prisma.statutoryConfig.findUnique.mockResolvedValue({
      proofVerificationRequired: true,
      proofCutoffMonth: 1,
    });
    prisma.investmentProof.findMany.mockResolvedValue([
      { section: 'SECTION_80C', verifiedAmount: new Decimal(40000) },
    ]);

    await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(prisma.investmentProof.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'APPROVED', financialYear: FY }),
      }),
    );
  });

  it('leaves the certificate on declared amounts when the employer does not require proofs', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue({
      proofVerificationRequired: false,
      proofCutoffMonth: 1,
    });

    await service.computePartB(TENANT, EMPLOYEE, FY, mockHrAdmin);

    expect(prisma.investmentProof.findMany).not.toHaveBeenCalled();
  });
});
