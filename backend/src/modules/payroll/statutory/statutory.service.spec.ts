import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';
import * as calculators from './statutory.calculators';
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

// ---------------------------------------------------------------------------
// Age band selection, the GENERAL fallback, ceilings and PT collection months
// ---------------------------------------------------------------------------

describe('StatutoryService.compute — income tax age band', () => {
  let service: StatutoryService;
  let prisma: any;

  /** April 2026: month 1 of FY 2026-27, twelve months left to collect in. */
  const april = {
    tenantId: 'tenant-1',
    employeeId: 'emp-1',
    month: 4,
    year: 2026,
    pfWages: new Decimal(0),
    grossPay: new Decimal(100000),
    pfOptOut: true,
    gender: null,
    employeeRegime: 'OLD' as const,
  };

  function statutoryConfig(overrides: Record<string, unknown> = {}) {
    return {
      pfEnabled: false,
      pfEmployeeRate: new Decimal(12), pfEmployerRate: new Decimal(12),
      epsRate: new Decimal(8.33), pfWageCeiling: new Decimal(15000),
      applyPfCeiling: true, edliRate: new Decimal(0.5), pfAdminRate: new Decimal(0.5),
      esiEnabled: false, esiEmployeeRate: new Decimal(0.75),
      esiEmployerRate: new Decimal(3.25), esiWageLimit: new Decimal(21000),
      ptEnabled: false, ptState: null, ptMonths: [],
      lwfEnabled: false, lwfEmployeeAmount: new Decimal(0),
      lwfEmployerAmount: new Decimal(0), lwfMonths: [],
      tdsEnabled: true,
      defaultTaxRegime: 'OLD',
      proofVerificationRequired: false,
      proofCutoffMonth: 1,
      ...overrides,
    };
  }

  // Same basic exemption shape for every band except where noted; the SENIOR
  // config exempts an extra 50,000 at the bottom so a test can tell, from the
  // TDS figure alone, which slab table was actually used.
  const generalTaxConfig = {
    standardDeduction: new Decimal(50000),
    rebateIncomeLimit: new Decimal(500000),
    rebateMaxAmount: new Decimal(12500),
    cessRate: new Decimal(4),
    surchargeSlabs: [],
    section80CLimit: new Decimal(150000),
    section80DLimit: new Decimal(25000),
    section80CCD1BLimit: new Decimal(50000),
    marginalReliefEnabled: true,
    slabs: [
      { fromAmount: new Decimal(0), toAmount: new Decimal(250000), rate: new Decimal(0) },
      { fromAmount: new Decimal(250000), toAmount: new Decimal(500000), rate: new Decimal(5) },
      { fromAmount: new Decimal(500000), toAmount: new Decimal(1000000), rate: new Decimal(20) },
      { fromAmount: new Decimal(1000000), toAmount: null, rate: new Decimal(30) },
    ],
  };

  const seniorTaxConfig = {
    ...generalTaxConfig,
    slabs: [
      { fromAmount: new Decimal(0), toAmount: new Decimal(300000), rate: new Decimal(0) },
      { fromAmount: new Decimal(300000), toAmount: new Decimal(500000), rate: new Decimal(5) },
      { fromAmount: new Decimal(500000), toAmount: new Decimal(1000000), rate: new Decimal(20) },
      { fromAmount: new Decimal(1000000), toAmount: null, rate: new Decimal(30) },
    ],
  };

  // With no declaration, on the GENERAL slabs: 1,200,000 gross - 50,000
  // standard = 1,150,000 taxable; tax 157,500 + 4% cess 6,300 = 163,800;
  // spread over 12 months = 13,650.
  const GENERAL_TDS = '13650';
  // On the SENIOR slabs the same taxable income is taxed 155,000 + cess
  // 6,200 = 161,200; spread over 12 months = 13,433.
  const SENIOR_TDS = '13433';

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
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue(null);
    prisma.investmentProof.findMany.mockResolvedValue([]);
  });

  it('selects the band from date of birth as at 31 March, not the payroll date', async () => {
    // Born 20 February 1967: 60 on 31 March 2027, inside FY 2026-27. Senior
    // for the whole of that year, including this April run ten months before
    // the birthday — the case the frozen contract itself documents.
    prisma.statutoryConfig.findUnique.mockResolvedValue(statutoryConfig());
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(seniorTaxConfig);

    const r = await service.compute({
      ...april,
      dateOfBirth: new Date(Date.UTC(1967, 1, 20)),
    });

    expect(r.tds.toString()).toBe(SENIOR_TDS);
    expect((r.taxComputation as any).ageBand).toBe('SENIOR');
    expect((r.taxComputation as any).ageBandRequested).toBe('SENIOR');
    expect((r.taxComputation as any).ageBandFallbackApplied).toBe(false);
    expect(prisma.incomeTaxConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_financialYear_regime_ageBand: {
            tenantId: 'tenant-1',
            financialYear: 2026,
            regime: 'OLD',
            ageBand: 'SENIOR',
          },
        },
      }),
    );
  });

  it('does not promote somebody whose birthday falls after 31 March', async () => {
    // Born 2 April 1967: still 59 on 31 March 2027, so GENERAL applies.
    prisma.statutoryConfig.findUnique.mockResolvedValue(statutoryConfig());
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(generalTaxConfig);

    const r = await service.compute({
      ...april,
      dateOfBirth: new Date(Date.UTC(1967, 3, 2)),
    });

    expect(r.tds.toString()).toBe(GENERAL_TDS);
    expect((r.taxComputation as any).ageBand).toBe('GENERAL');
  });

  it('uses GENERAL when the employee has no date of birth on record', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(statutoryConfig());
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(generalTaxConfig);

    const r = await service.compute(april); // no dateOfBirth at all

    expect(r.tds.toString()).toBe(GENERAL_TDS);
    expect((r.taxComputation as any).ageBand).toBe('GENERAL');
    expect((r.taxComputation as any).ageBandRequested).toBe('GENERAL');
    expect((r.taxComputation as any).ageBandFallbackApplied).toBe(false);
    expect(prisma.incomeTaxConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_financialYear_regime_ageBand: expect.objectContaining({ ageBand: 'GENERAL' }),
        }),
      }),
    );
  });

  it('falls back to GENERAL, and says so in the working, when the SENIOR row is missing', async () => {
    // A tenant that seeded only GENERAL rows. Finding nothing for SENIOR must
    // not mean no tax: that would silently stop deducting TDS from this
    // employee, which is worse than taxing them on the general slabs.
    prisma.statutoryConfig.findUnique.mockResolvedValue(statutoryConfig());
    prisma.incomeTaxConfig.findUnique
      .mockResolvedValueOnce(null) // the SENIOR lookup
      .mockResolvedValueOnce(generalTaxConfig); // the GENERAL fallback

    const r = await service.compute({
      ...april,
      dateOfBirth: new Date(Date.UTC(1967, 1, 20)), // senior, per the test above
    });

    // GENERAL was actually applied, not zero.
    expect(r.tds.toString()).toBe(GENERAL_TDS);
    expect((r.taxComputation as any).ageBand).toBe('GENERAL');
    expect((r.taxComputation as any).ageBandRequested).toBe('SENIOR');
    expect((r.taxComputation as any).ageBandFallbackApplied).toBe(true);
    expect(prisma.incomeTaxConfig.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.incomeTaxConfig.findUnique).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_financialYear_regime_ageBand: expect.objectContaining({ ageBand: 'GENERAL' }),
        }),
      }),
    );
  });

  it('treats a SENIOR row with no slabs the same as a missing row', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(statutoryConfig());
    prisma.incomeTaxConfig.findUnique
      .mockResolvedValueOnce({ ...seniorTaxConfig, slabs: [] })
      .mockResolvedValueOnce(generalTaxConfig);

    const r = await service.compute({
      ...april,
      dateOfBirth: new Date(Date.UTC(1967, 1, 20)),
    });

    expect(r.tds.toString()).toBe(GENERAL_TDS);
    expect((r.taxComputation as any).ageBandFallbackApplied).toBe(true);
  });

  it('deducts no TDS, rather than guessing, when neither the band nor GENERAL is configured', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(statutoryConfig());
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(null);

    const r = await service.compute({
      ...april,
      dateOfBirth: new Date(Date.UTC(1967, 1, 20)),
    });

    expect(r.tds.toString()).toBe('0');
    expect(r.taxComputation).toBeNull();
  });

  it('passes the Chapter VI-A ceilings and marginal relief flag to the calculator, and records them in the working', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(statutoryConfig());
    prisma.incomeTaxConfig.findUnique.mockResolvedValue({
      ...generalTaxConfig,
      section80CLimit: new Decimal(200000),
      section80DLimit: new Decimal(30000),
      section80CCD1BLimit: new Decimal(60000),
      marginalReliefEnabled: false,
    });
    // Declares more under 80C than the 200,000 ceiling allows.
    prisma.employeeTaxDeclaration.findUnique.mockResolvedValue({
      regime: 'OLD',
      section80C: new Decimal(250000),
      section80D: new Decimal(10000),
      section80CCD1B: new Decimal(0),
      section80CCD2: new Decimal(0),
      hraExemption: new Decimal(0),
      homeLoanInterest: new Decimal(0),
      otherDeductions: new Decimal(0),
      otherIncome: new Decimal(0),
      previousEmployerTds: new Decimal(0),
    });

    const spy = jest.spyOn(calculators, 'calculateIncomeTax');

    const r = await service.compute(april);

    // The service does not cap the figure itself — the calculator does —
    // but it must hand the ceiling and the declared figure to the calculator.
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limits: {
          section80C: expect.objectContaining({ toString: expect.any(Function) }),
          section80D: expect.anything(),
          section80CCD1B: expect.anything(),
        },
        marginalReliefEnabled: false,
      }),
      expect.anything(),
      expect.anything(),
    );
    const passedLimits = (spy.mock.calls[0][1] as any).limits;
    expect(passedLimits.section80C.toString()).toBe('200000');
    expect(passedLimits.section80D.toString()).toBe('30000');
    expect(passedLimits.section80CCD1B.toString()).toBe('60000');

    const working = r.taxComputation as any;
    expect(working.deductionLimits.section80C).toBe('200000.00');
    expect(working.deductionLimits.section80D).toBe('30000.00');
    expect(working.deductionLimits.section80CCD1B).toBe('60000.00');
    // Declared 250,000 under 80C against a 200,000 ceiling: the calculator
    // capped it, and the working reports back exactly what it allowed.
    expect(working.chapterVIACaps['80C'].declared).toBe('250000.00');
    expect(working.chapterVIACaps['80C'].limit).toBe('200000.00');
    expect(working.chapterVIACaps['80C'].allowed).toBe('200000.00');
    expect(working.chapterVIACaps['80C'].disallowed).toBe('50000.00');
    expect(working.chapterVIACaps['80D'].allowed).toBe('10000.00');
    expect(working.chapterVIACaps['80D'].disallowed).toBe('0.00');
    expect(working.marginalReliefEnabled).toBe(false);

    spy.mockRestore();
  });

  it('defaults the ceilings to the statutory figures when a config row predates the column', async () => {
    // A row seeded before the ceiling columns existed; the mock simply omits
    // them, the way an old fixture or a partially-migrated row would.
    prisma.statutoryConfig.findUnique.mockResolvedValue(statutoryConfig());
    const { section80CLimit, section80DLimit, section80CCD1BLimit, marginalReliefEnabled, ...bareConfig } =
      generalTaxConfig;
    prisma.incomeTaxConfig.findUnique.mockResolvedValue(bareConfig);

    const r = await service.compute(april);

    const working = r.taxComputation as any;
    expect(working.deductionLimits.section80C).toBe('150000.00');
    expect(working.deductionLimits.section80D).toBe('25000.00');
    expect(working.deductionLimits.section80CCD1B).toBe('50000.00');
    expect(working.marginalReliefEnabled).toBe(true);
    // Nothing declared, nothing seeded new: the figure is exactly what an
    // installation with no age-band or ceiling configuration produces today.
    expect(r.tds.toString()).toBe(GENERAL_TDS);
  });
});

describe('StatutoryService.compute — professional tax collection months', () => {
  let service: StatutoryService;
  let prisma: any;

  const input = {
    tenantId: 'tenant-1',
    employeeId: 'emp-1',
    month: 4,
    year: 2026,
    pfWages: new Decimal(0),
    grossPay: new Decimal(30000),
    pfOptOut: true,
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

    prisma.professionalTaxSlab.findMany.mockResolvedValue([
      { fromAmount: new Decimal(25000), toAmount: null, amount: new Decimal(200), februaryAmount: null, gender: null },
    ]);
  });

  function statutoryConfig(overrides: Record<string, unknown> = {}) {
    return {
      pfEnabled: false,
      pfEmployeeRate: new Decimal(12), pfEmployerRate: new Decimal(12),
      epsRate: new Decimal(8.33), pfWageCeiling: new Decimal(15000),
      applyPfCeiling: true, edliRate: new Decimal(0.5), pfAdminRate: new Decimal(0.5),
      esiEnabled: false, esiEmployeeRate: new Decimal(0.75),
      esiEmployerRate: new Decimal(3.25), esiWageLimit: new Decimal(21000),
      ptEnabled: true, ptState: 'Tamil Nadu',
      lwfEnabled: false, lwfEmployeeAmount: new Decimal(0),
      lwfEmployerAmount: new Decimal(0), lwfMonths: [],
      tdsEnabled: false,
      ...overrides,
    };
  }

  it('collects only in the configured months for a half-yearly state', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      statutoryConfig({ ptMonths: [3, 9] }),
    );

    const outsideCollectionMonth = await service.compute(input); // April
    expect(outsideCollectionMonth.professionalTax.toString()).toBe('0');

    const collectionMonth = await service.compute({ ...input, month: 9 });
    expect(collectionMonth.professionalTax.toString()).toBe('200');
  });

  it('still collects every month when ptMonths is empty, exactly as before the column existed', async () => {
    prisma.statutoryConfig.findUnique.mockResolvedValue(
      statutoryConfig({ ptMonths: [] }),
    );

    const r = await service.compute(input);

    expect(r.professionalTax.toString()).toBe('200');
  });

  it('still collects every month when ptMonths is not set at all, matching a pre-migration row', async () => {
    const config = statutoryConfig();
    delete (config as any).ptMonths;
    prisma.statutoryConfig.findUnique.mockResolvedValue(config);

    const r = await service.compute(input);

    expect(r.professionalTax.toString()).toBe('200');
  });
});
