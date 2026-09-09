import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';
import {
  StatutoryService,
  financialYearOf,
  monthsRemainingInFy,
  esiContributionPeriod,
} from './statutory.service';

describe('financialYearOf', () => {
  it('puts April to March into one Indian financial year', () => {
    expect(financialYearOf(4, 2026)).toBe(2026); // April 2026 starts FY 2026-27
    expect(financialYearOf(12, 2026)).toBe(2026);
    expect(financialYearOf(3, 2027)).toBe(2026); // March 2027 still closes it
    expect(financialYearOf(1, 2027)).toBe(2026);
  });
});

describe('monthsRemainingInFy', () => {
  it('counts the current month and every one left before March', () => {
    expect(monthsRemainingInFy(4)).toBe(12); // April: the whole year ahead
    expect(monthsRemainingInFy(9)).toBe(7);
    expect(monthsRemainingInFy(1)).toBe(3); // January, then February and March
    expect(monthsRemainingInFy(3)).toBe(1); // March: last chance to collect
  });
});

describe('esiContributionPeriod', () => {
  it('splits the year at April and October', () => {
    expect(esiContributionPeriod(5, 2026)).toEqual({
      startMonth: 4, startYear: 2026, endMonth: 9, endYear: 2026,
    });
    expect(esiContributionPeriod(11, 2026)).toEqual({
      startMonth: 10, startYear: 2026, endMonth: 3, endYear: 2027,
    });
  });

  it('places January in the period that began the previous October', () => {
    expect(esiContributionPeriod(1, 2027)).toEqual({
      startMonth: 10, startYear: 2026, endMonth: 3, endYear: 2027,
    });
  });
});

describe('StatutoryService.compute', () => {
  let service: StatutoryService;
  let prisma: any;

  const input = {
    tenantId: 'tenant-1',
    employeeId: 'emp-1',
    month: 5,
    year: 2026,
    pfWages: new Decimal(20000),
    grossPay: new Decimal(30000),
    pfOptOut: false,
    gender: null,
    employeeRegime: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatutoryService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get(StatutoryService);
    prisma = module.get(PrismaService);
  });

  it('deducts nothing at all when the tenant has not configured statutory payroll', async () => {
    // Existing installations must keep behaving exactly as before rather than
    // having rates guessed on their behalf.
    prisma.statutoryConfig.findUnique.mockResolvedValue(null);

    const r = await service.compute(input);

    expect(r.totalEmployeeDeductions.toString()).toBe('0');
    expect(r.pfEmployee.toString()).toBe('0');
    expect(r.tds.toString()).toBe('0');
  });

  it('applies provident tax and professional tax from the tenant configuration', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue({
      pfEnabled: true,
      pfEmployeeRate: new Decimal(12),
      pfEmployerRate: new Decimal(12),
      epsRate: new Decimal(8.33),
      pfWageCeiling: new Decimal(15000),
      applyPfCeiling: true,
      edliRate: new Decimal(0.5),
      pfAdminRate: new Decimal(0.5),
      esiEnabled: true,
      esiEmployeeRate: new Decimal(0.75),
      esiEmployerRate: new Decimal(3.25),
      esiWageLimit: new Decimal(21000),
      ptEnabled: true,
      ptState: 'Karnataka',
      lwfEnabled: false,
      lwfEmployeeAmount: new Decimal(0),
      lwfEmployerAmount: new Decimal(0),
      lwfMonths: [],
      tdsEnabled: false,
    });
    prisma.payslip.findFirst.mockResolvedValue(null);
    prisma.professionalTaxSlab.findMany.mockResolvedValue([
      { fromAmount: new Decimal(25000), toAmount: null, amount: new Decimal(200), februaryAmount: null, gender: null },
    ]);

    const r = await service.compute(input);

    expect(r.pfEmployee.toString()).toBe('1800'); // 12% of the capped 15,000
    expect(r.epsEmployer.toString()).toBe('1250');
    expect(r.professionalTax.toString()).toBe('200');
    // Gross of 30,000 is above the ESI limit
    expect(r.esiEmployee.toString()).toBe('0');
    expect(r.totalEmployeeDeductions.toString()).toBe('2000');
  });

  it('keeps an employee in ESI for the rest of the period once they have contributed in it', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue({
      pfEnabled: false,
      pfEmployeeRate: new Decimal(12), pfEmployerRate: new Decimal(12),
      epsRate: new Decimal(8.33), pfWageCeiling: new Decimal(15000),
      applyPfCeiling: true, edliRate: new Decimal(0.5), pfAdminRate: new Decimal(0.5),
      esiEnabled: true,
      esiEmployeeRate: new Decimal(0.75),
      esiEmployerRate: new Decimal(3.25),
      esiWageLimit: new Decimal(21000),
      ptEnabled: false, ptState: null,
      lwfEnabled: false, lwfEmployeeAmount: new Decimal(0),
      lwfEmployerAmount: new Decimal(0), lwfMonths: [],
      tdsEnabled: false,
    });
    // A payslip earlier in this contribution period carried an ESI deduction.
    prisma.payslip.findFirst.mockResolvedValue({ id: 'slip-earlier' });

    const r = await service.compute({ ...input, grossPay: new Decimal(25000) });

    // Above the limit, but coverage runs to the end of the period.
    expect(r.esiEmployee.toString()).toBe('188');
  });

  it('deducts no TDS when no slabs are configured for the year, rather than guessing', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue({
      pfEnabled: false,
      pfEmployeeRate: new Decimal(12), pfEmployerRate: new Decimal(12),
      epsRate: new Decimal(8.33), pfWageCeiling: new Decimal(15000),
      applyPfCeiling: true, edliRate: new Decimal(0.5), pfAdminRate: new Decimal(0.5),
      esiEnabled: false, esiEmployeeRate: new Decimal(0.75),
      esiEmployerRate: new Decimal(3.25), esiWageLimit: new Decimal(21000),
      ptEnabled: false, ptState: null,
      lwfEnabled: false, lwfEmployeeAmount: new Decimal(0),
      lwfEmployerAmount: new Decimal(0), lwfMonths: [],
      tdsEnabled: true,
      defaultTaxRegime: 'NEW',
    });
    prisma.payslip.findFirst.mockResolvedValue(null);
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue(null);
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(null);

    const r = await service.compute(input);

    expect(r.tds.toString()).toBe('0');
    expect(r.taxComputation).toBeNull();
  });
});
