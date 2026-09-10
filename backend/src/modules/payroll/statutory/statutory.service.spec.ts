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

describe('StatutoryService.compute with investment proofs', () => {
  let service: StatutoryService;
  let prisma: any;

  /** January 2027: month 10 of FY 2026-27, three months left to collect in. */
  const january = {
    tenantId: 'tenant-1',
    employeeId: 'emp-1',
    month: 1,
    year: 2027,
    pfWages: new Decimal(0),
    grossPay: new Decimal(400000),
    pfOptOut: true,
    gender: null,
    employeeRegime: 'OLD' as const,
  };

  /**
   * Only the fields the TDS path reads. The old regime is used throughout
   * because the new one allows none of the proof-backed deductions, so nothing
   * a proof could support would show in the figures.
   */
  function config(overrides: Record<string, unknown> = {}) {
    return {
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
      defaultTaxRegime: 'OLD',
      proofVerificationRequired: false,
      proofCutoffMonth: 1,
      ...overrides,
    };
  }

  const declaration = {
    regime: 'OLD',
    section80C: new Decimal(150000),
    section80D: new Decimal(25000),
    section80CCD1B: new Decimal(50000),
    section80CCD2: new Decimal(40000),
    hraExemption: new Decimal(120000),
    homeLoanInterest: new Decimal(200000),
    otherDeductions: new Decimal(10000),
    otherIncome: new Decimal(60000),
    previousEmployerTds: new Decimal(5000),
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

    prisma.payslip.findFirst.mockResolvedValue(null);
    prisma.payslip.findMany.mockResolvedValue([]);
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue(declaration);
    prisma.incomeTaxConfig.findUnique.mockResolvedValue({
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
    });
    prisma.investmentProof.findMany.mockResolvedValue([]);
  });

  it('deducts exactly what it did before for a tenant that has not opted in, and asks the database for no proofs', async () => {
    // proofVerificationRequired is false for every tenant that existed before
    // this feature. Not one rupee of their TDS may move, and no payroll run of
    // theirs may pay for a query it has no use for.
    prisma.statutoryConfig.findUnique.mockResolvedValue(config());
    // Approved proofs exist, and must be ignored entirely.
    prisma.investmentProof.findMany.mockResolvedValue([
      { section: 'SECTION_80C', verifiedAmount: new Decimal(1) },
    ]);

    const r = await service.compute(january);

    // 50,000 standard + 40,000 under 80CCD(2) + the full declared 555,000.
    expect((r.taxComputation as any).totalDeductions).toBe('645000.00');
    expect((r.taxComputation as any).taxableIncome).toBe('615000.00');
    expect(r.tds.toString()).toBe('10640');
    expect(prisma.investmentProof.findMany).not.toHaveBeenCalled();
  });

  it('lets the declaration stand on its own before the cutoff month', async () => {
    // December is month 9 of the financial year; the January cutoff has not
    // been reached, so proofs are not yet due and nothing is withheld for them.
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      config({ proofVerificationRequired: true, proofCutoffMonth: 1 }),
    );

    const r = await service.compute({ ...january, month: 12, year: 2026 });

    expect((r.taxComputation as any).totalDeductions).toBe('645000.00');
    expect(prisma.investmentProof.findMany).not.toHaveBeenCalled();
  });

  it('allows only the approved verified amounts once the cutoff month is reached', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      config({ proofVerificationRequired: true, proofCutoffMonth: 1 }),
    );
    prisma.investmentProof.findMany.mockResolvedValue([
      // Two documents under one head: what counts is the sum of the approved.
      { section: 'SECTION_80C', verifiedAmount: new Decimal(60000) },
      { section: 'SECTION_80C', verifiedAmount: new Decimal(40000) },
      { section: 'SECTION_80D', verifiedAmount: new Decimal(20000) },
      { section: 'HRA', verifiedAmount: new Decimal(90000) },
      // Approved but no figure recorded: nothing is allowed, and certainly not
      // the 50,000 the employee claimed.
      { section: 'SECTION_80CCD1B', verifiedAmount: null },
    ]);

    const r = await service.compute(january);

    // 50,000 standard + 40,000 under 80CCD(2) + 100,000 + 20,000 + 90,000.
    expect((r.taxComputation as any).totalDeductions).toBe('300000.00');
    // Other income still raises the total: 1,200,000 + 60,000 - 300,000.
    expect((r.taxComputation as any).taxableIncome).toBe('960000.00');
    expect(r.tds.toString()).toBe('36227');
  });

  it('queries proofs for this tenant, employee and financial year, and counts only approved ones', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      config({ proofVerificationRequired: true, proofCutoffMonth: 1 }),
    );

    await service.compute(january);

    expect(prisma.investmentProof.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          employeeId: 'emp-1',
          financialYear: 2026,
          status: 'APPROVED',
        }),
      }),
    );
  });

  it('allows nothing under a proof-backed head when no proof has been approved', async () => {
    // The point of switching verification on: an employee who filed nothing
    // gets no relief, and their TDS rises. That is why it is opt-in.
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      config({ proofVerificationRequired: true, proofCutoffMonth: 1 }),
    );
    prisma.investmentProof.findMany.mockResolvedValue([]);

    const r = await service.compute(january);

    // Only the standard deduction and the employer's own NPS contribution.
    expect((r.taxComputation as any).totalDeductions).toBe('90000.00');
    expect((r.taxComputation as any).taxableIncome).toBe('1170000.00');
    expect(r.tds.toString()).toBe('56680');
  });

  it('keeps the employer NPS contribution and declared other income from the declaration even under verification', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      config({ proofVerificationRequired: true, proofCutoffMonth: 1 }),
    );
    prisma.investmentProof.findMany.mockResolvedValue([]);

    const r = await service.compute(january);
    const working = r.taxComputation as any;

    // 90,000 of deductions is 50,000 standard plus the declared 40,000 under
    // 80CCD(2); without it the figure would be 50,000.
    expect(working.totalDeductions).toBe('90000.00');
    // 1,200,000 projected salary plus the declared 60,000 of other income.
    expect(working.taxableIncome).toBe('1170000.00');
  });

  it('records in the working that verified amounts were used, and what each head allowed', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      config({ proofVerificationRequired: true, proofCutoffMonth: 1 }),
    );
    prisma.investmentProof.findMany.mockResolvedValue([
      { section: 'SECTION_80C', verifiedAmount: new Decimal(100000) },
    ]);

    const r = await service.compute(january);
    const working = r.taxComputation as any;

    expect(working.verifiedAmountsUsed).toBe(true);
    expect(working.proofCutoffMonth).toBe(1);
    expect(working.verifiedDeductions.section80C).toBe('100000.00');
    expect(working.verifiedDeductions.section80D).toBe('0.00');
    expect(working.declaredDeductions.section80C).toBe('150000.00');
    // Neither has a proof head, so neither belongs in the verified working.
    expect(working.verifiedDeductions.section80CCD2).toBeUndefined();
    expect(working.verifiedDeductions.otherIncome).toBeUndefined();
  });

  it('records that verified amounts were not used when the tenant has not opted in', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(config());

    const r = await service.compute(january);

    expect((r.taxComputation as any).verifiedAmountsUsed).toBe(false);
  });
});
