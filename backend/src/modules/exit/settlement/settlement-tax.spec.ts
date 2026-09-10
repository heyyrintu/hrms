import { Decimal } from '@prisma/client/runtime/library';
import { TaxAgeBand } from '@prisma/client';
import {
  computeSettlementTax,
  toIncomeTaxConfigInput,
  toTaxDeclarationInput,
  NO_TAX_CONFIGURATION,
} from './settlement-tax';
import type { IncomeTaxConfigInput } from '../../payroll/statutory/statutory.calculators';

/**
 * Every figure below is worked out in the comment beside it, so a payroll
 * professional can check the arithmetic without running anything.
 *
 * The slabs are the new regime's for FY 2024-25 and the old regime's as it
 * stood before the standard deduction moved, because both are familiar and
 * both are easy to walk by hand.
 */

const NEW_REGIME: IncomeTaxConfigInput = {
  regime: 'NEW',
  standardDeduction: new Decimal(75000),
  rebateIncomeLimit: new Decimal(700000),
  rebateMaxAmount: new Decimal(25000),
  cessRate: new Decimal(4),
  surchargeSlabs: [],
  ageBand: TaxAgeBand.GENERAL,
  slabs: [
    { fromAmount: new Decimal(0), toAmount: new Decimal(300000), rate: new Decimal(0) },
    {
      fromAmount: new Decimal(300000),
      toAmount: new Decimal(700000),
      rate: new Decimal(5),
    },
    {
      fromAmount: new Decimal(700000),
      toAmount: new Decimal(1000000),
      rate: new Decimal(10),
    },
    {
      fromAmount: new Decimal(1000000),
      toAmount: new Decimal(1200000),
      rate: new Decimal(15),
    },
    {
      fromAmount: new Decimal(1200000),
      toAmount: new Decimal(1500000),
      rate: new Decimal(20),
    },
    { fromAmount: new Decimal(1500000), toAmount: null, rate: new Decimal(30) },
  ],
};

const OLD_REGIME: IncomeTaxConfigInput = {
  regime: 'OLD',
  standardDeduction: new Decimal(50000),
  rebateIncomeLimit: new Decimal(500000),
  rebateMaxAmount: new Decimal(12500),
  cessRate: new Decimal(4),
  surchargeSlabs: [],
  ageBand: TaxAgeBand.GENERAL,
  limits: {
    section80C: new Decimal(150000),
    section80D: new Decimal(25000),
    section80CCD1B: new Decimal(50000),
  },
  slabs: [
    { fromAmount: new Decimal(0), toAmount: new Decimal(250000), rate: new Decimal(0) },
    {
      fromAmount: new Decimal(250000),
      toAmount: new Decimal(500000),
      rate: new Decimal(5),
    },
    {
      fromAmount: new Decimal(500000),
      toAmount: new Decimal(1000000),
      rate: new Decimal(20),
    },
    { fromAmount: new Decimal(1000000), toAmount: null, rate: new Decimal(30) },
  ],
};

/**
 * The settlement's own taxable parts.
 *
 *   pro-rata salary                        1,00,000
 *   taxable balance of gratuity               50,000
 *   taxable balance of leave encashment    1,50,000
 *   other earnings                                 0
 *   ------------------------------------------------
 *   taxable from the settlement            3,00,000
 */
function makeParts(overrides: Partial<Record<string, Decimal>> = {}) {
  return {
    proRataSalary: new Decimal(100000),
    gratuityTaxable: new Decimal(50000),
    leaveEncashmentTaxable: new Decimal(150000),
    otherEarnings: new Decimal(0),
    ...overrides,
  };
}

/** Ten months on the payroll before the exit. */
function makeYearToDate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    grossPaid: new Decimal(900000),
    tdsDeducted: new Decimal(40000),
    professionalTaxPaid: new Decimal(2400),
    payslips: 10,
    ...overrides,
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    financialYear: 2024,
    regime: 'NEW' as const,
    config: NEW_REGIME,
    declaration: toTaxDeclarationInput(null),
    declarationFound: true,
    ageBandUsed: TaxAgeBand.GENERAL,
    ageBandRequested: TaxAgeBand.GENERAL,
    ageBandFallback: false,
    parts: makeParts(),
    yearToDate: makeYearToDate(),
    ...overrides,
  };
}

describe('computeSettlementTax', () => {
  describe('the balance still owing for the year', () => {
    it('credits the tax already deducted through the year', () => {
      const result = computeSettlementTax(makeInput() as never);

      // Annual gross  = 9,00,000 already paid + 3,00,000 from the settlement
      //               = 12,00,000
      // less standard deduction                  75,000
      // taxable income                       11,25,000
      //
      //     0 -  3,00,000 @  0%          =            0
      // 3,00,000 -  7,00,000 @  5% on 4,00,000 =   20,000
      // 7,00,000 - 10,00,000 @ 10% on 3,00,000 =   30,000
      // 10,00,000 - 11,25,000 @ 15% on 1,25,000 =  18,750
      //                                  tax      68,750
      // cess at 4%                                 2,750
      //                            annual tax     71,500
      // less deducted in the ten months paid      40,000
      //                    settlement TDS         31,500
      expect(result.working.projectedAnnualGross).toBe('1200000.00');
      expect(result.working.taxableIncome).toBe('1125000.00');
      expect(result.working.taxBeforeRebate).toBe('68750.00');
      expect(result.working.cess).toBe('2750.00');
      expect(result.working.annualTax).toBe('71500.00');
      expect(result.working.alreadyDeducted).toBe('40000.00');
      expect(result.tds.toFixed(2)).toBe('31500.00');
    });

    it('credits tax a previous employer deducted as well', () => {
      const result = computeSettlementTax(
        makeInput({
          declaration: {
            ...toTaxDeclarationInput(null),
            previousEmployerTds: new Decimal(10000),
          },
          declarationFound: true,
        }) as never,
      );

      // 71,500 annual tax - 40,000 deducted here - 10,000 by the previous
      // employer = 21,500
      expect(result.working.alreadyDeducted).toBe('50000.00');
      expect(result.tds.toFixed(2)).toBe('21500.00');
    });

    it('never deducts a negative when too much was already taken', () => {
      const result = computeSettlementTax(
        makeInput({
          yearToDate: makeYearToDate({ tdsDeducted: new Decimal(200000) }),
        }) as never,
      );

      // 71,500 owing against 2,00,000 already deducted. The excess comes back
      // on assessment; a settlement does not refund tax.
      expect(result.tds.toFixed(2)).toBe('0.00');
      expect(result.working.annualTax).toBe('71500.00');
      expect(result.working.alreadyDeducted).toBe('200000.00');
    });
  });

  describe('what the settlement contributes to the year', () => {
    it('taxes the taxable balances of gratuity and encashment, not the whole payment', () => {
      const result = computeSettlementTax(makeInput() as never);

      // The exempt parts of gratuity and encashment never reach here: the
      // caller passes the taxable balance of each. 1,00,000 + 50,000 +
      // 1,50,000 = 3,00,000, on top of the 9,00,000 already paid.
      expect(result.working.settlementTaxable).toEqual({
        proRataSalary: '100000.00',
        gratuityTaxable: '50000.00',
        leaveEncashmentTaxable: '150000.00',
        otherEarnings: '0.00',
        total: '300000.00',
      });
      expect(result.working.projectedAnnualGross).toBe('1200000.00');
    });

    it('drops out of the higher slab when gratuity and encashment are wholly exempt', () => {
      const result = computeSettlementTax(
        makeInput({
          parts: makeParts({
            gratuityTaxable: new Decimal(0),
            leaveEncashmentTaxable: new Decimal(0),
          }),
        }) as never,
      );

      // Annual gross  = 9,00,000 + 1,00,000 pro-rata = 10,00,000
      // less standard deduction                          75,000
      // taxable income                                 9,25,000
      //
      // 3,00,000 - 7,00,000 @ 5% on 4,00,000  =  20,000
      // 7,00,000 - 9,25,000 @ 10% on 2,25,000 =  22,500
      //                                   tax    42,500
      // cess at 4%                                1,700
      //                            annual tax    44,200
      // less already deducted                    40,000
      //                    settlement TDS         4,200
      expect(result.working.projectedAnnualGross).toBe('1000000.00');
      expect(result.working.annualTax).toBe('44200.00');
      expect(result.tds.toFixed(2)).toBe('4200.00');
    });

    it('includes other earnings entered on the settlement', () => {
      const result = computeSettlementTax(
        makeInput({
          parts: makeParts({ otherEarnings: new Decimal(50000) }),
        }) as never,
      );

      // 12,00,000 + 50,000 = 12,50,000 gross, taxable 11,75,000.
      // The extra 50,000 sits in the 15% band: 50,000 x 15% = 7,500 more tax,
      // plus 4% cess on that = 300. 71,500 + 7,800 = 79,300 annual tax,
      // less 40,000 already deducted = 39,300.
      expect(result.working.projectedAnnualGross).toBe('1250000.00');
      expect(result.working.annualTax).toBe('79300.00');
      expect(result.tds.toFixed(2)).toBe('39300.00');
    });
  });

  describe('the old regime', () => {
    it('allows the declaration, caps it, and deducts the professional tax paid', () => {
      const result = computeSettlementTax(
        makeInput({
          regime: 'OLD' as const,
          config: OLD_REGIME,
          declarationFound: true,
          declaration: {
            ...toTaxDeclarationInput(null),
            // Over the ceiling on purpose: the calculator must trim it.
            section80C: new Decimal(200000),
            section80D: new Decimal(25000),
          },
        }) as never,
      );

      // Annual gross                          12,00,000
      // less standard deduction                  50,000
      // less 80C, capped at                    1,50,000
      // less 80D                                 25,000
      // less professional tax paid (s.16(iii))    2,400
      // total deductions                       2,27,400
      // taxable income                         9,72,600
      //
      //       0 - 2,50,000 @  0%                       0
      // 2,50,000 - 5,00,000 @  5% on 2,50,000 =    12,500
      // 5,00,000 - 9,72,600 @ 20% on 4,72,600 =    94,520
      //                                   tax     107,020
      // cess at 4% = 4,280.80, to the rupee          4,281
      //                            annual tax     1,11,301
      // less already deducted                       40,000
      //                    settlement TDS           71,301
      expect(result.working.totalDeductions).toBe('227400.00');
      expect(result.working.taxableIncome).toBe('972600.00');
      expect(result.working.taxBeforeRebate).toBe('107020.00');
      expect(result.working.cess).toBe('4281.00');
      expect(result.working.annualTax).toBe('111301.00');
      expect(result.tds.toFixed(2)).toBe('71301.00');

      // The trim is shown, not silently applied.
      expect(result.working.chapterVIACaps['80C']).toEqual({
        declared: '200000.00',
        limit: '150000.00',
        allowed: '150000.00',
        disallowed: '50000.00',
      });
    });

    it('allows the section 10 exemptions the leaver declared', () => {
      const result = computeSettlementTax(
        makeInput({
          regime: 'OLD' as const,
          config: OLD_REGIME,
          declarationFound: true,
          declaration: {
            ...toTaxDeclarationInput(null),
            section80C: new Decimal(200000),
            section80D: new Decimal(25000),
            // Section 10(5): leave travel actually spent.
            ltaExemption: new Decimal(40000),
          },
        }) as never,
      );

      // As the case above, plus 40,000 of leave travel concession:
      // total deductions   2,27,400 + 40,000 = 2,67,400
      // taxable income                       9,32,600
      // 2,50,000 - 5,00,000 @  5% on 2,50,000 =  12,500
      // 5,00,000 - 9,32,600 @ 20% on 4,32,600 =  86,520
      //                                   tax    99,020
      // cess at 4% = 3,960.80, to the rupee       3,961
      //                            annual tax  1,02,981
      // less already deducted                    40,000
      //                    settlement TDS         62,981
      expect(result.working.totalDeductions).toBe('267400.00');
      expect(result.working.taxableIncome).toBe('932600.00');
      expect(result.tds.toFixed(2)).toBe('62981.00');
    });

    it('ignores the professional tax under the new regime', () => {
      const result = computeSettlementTax(makeInput() as never);

      // Section 16(iii) is not available under the new regime, so the 2,400
      // paid does not reduce the taxable income of 11,25,000.
      expect(result.working.totalDeductions).toBe('75000.00');
      expect(result.working.yearToDate.professionalTaxPaid).toBe('2400.00');
    });
  });

  describe('when the computation cannot be made', () => {
    it('deducts nothing, and says why, when the year has no tax configuration', () => {
      const result = computeSettlementTax(
        makeInput({ config: null }) as never,
      );

      expect(result.tds.toFixed(2)).toBe('0.00');
      expect(result.working.computed).toBe(false);
      expect(result.working.reason).toBe(NO_TAX_CONFIGURATION);
      expect(result.working.note).toMatch(/no income tax configuration/i);
      // The reader still gets the figures that went in, so they can see what a
      // seeded year would have been taxed on.
      expect(result.working.settlementTaxable.total).toBe('300000.00');
      expect(result.working.projectedAnnualGross).toBe('1200000.00');
      expect(result.working.annualTax).toBeNull();
    });

    it('still computes when the employee has no declaration, and records that', () => {
      const result = computeSettlementTax(
        makeInput({
          declaration: toTaxDeclarationInput(null),
          declarationFound: false,
        }) as never,
      );

      // A missing declaration is not a reason to deduct nothing: it means no
      // deduction is claimed, so the whole income is taxed. Same figures as
      // the first case, because the new regime allows none of it anyway.
      expect(result.working.declarationFound).toBe(false);
      expect(result.working.computed).toBe(true);
      expect(result.tds.toFixed(2)).toBe('31500.00');
      expect(result.working.note).toMatch(/no tax declaration/i);
    });
  });

  describe('the working', () => {
    it('records the inputs the figure was reached from', () => {
      const result = computeSettlementTax(makeInput() as never);

      expect(result.working.financialYear).toBe(2024);
      expect(result.working.regime).toBe('NEW');
      expect(result.working.ageBand).toBe(TaxAgeBand.GENERAL);
      expect(result.working.ageBandRequested).toBe(TaxAgeBand.GENERAL);
      expect(result.working.ageBandFallbackApplied).toBe(false);
      expect(result.working.yearToDate).toEqual({
        grossPaid: '900000.00',
        tdsDeducted: '40000.00',
        professionalTaxPaid: '2400.00',
        payslips: 10,
      });
      expect(result.working.previousEmployerTds).toBe('0.00');
      expect(result.working.computedTds).toBe('31500.00');
    });

    it('is JSON-serialisable, so it can be stored in the breakdown', () => {
      const result = computeSettlementTax(makeInput() as never);

      expect(() => JSON.stringify(result.working)).not.toThrow();
      const round = JSON.parse(JSON.stringify(result.working));
      expect(round.annualTax).toBe('71500.00');
    });

    it('records a fallback to the general slabs', () => {
      const result = computeSettlementTax(
        makeInput({
          ageBandUsed: TaxAgeBand.GENERAL,
          ageBandRequested: TaxAgeBand.SENIOR,
          ageBandFallback: true,
        }) as never,
      );

      expect(result.working.ageBandRequested).toBe(TaxAgeBand.SENIOR);
      expect(result.working.ageBandFallbackApplied).toBe(true);
    });
  });
});

describe('toTaxDeclarationInput', () => {
  it('reads every head off a stored declaration', () => {
    const input = toTaxDeclarationInput({
      section80C: new Decimal(150000),
      section80D: new Decimal(25000),
      section80CCD1B: new Decimal(50000),
      section80CCD2: new Decimal(60000),
      hraExemption: new Decimal(120000),
      homeLoanInterest: new Decimal(200000),
      otherDeductions: new Decimal(5000),
      otherIncome: new Decimal(30000),
      previousEmployerTds: new Decimal(12000),
      ltaExemption: new Decimal(40000),
      childrenEducationAllowance: new Decimal(2400),
      hostelAllowance: new Decimal(7200),
      childrenCount: 2,
    });

    expect(input.section80C.toFixed(2)).toBe('150000.00');
    expect(input.section80CCD2.toFixed(2)).toBe('60000.00');
    expect(input.previousEmployerTds.toFixed(2)).toBe('12000.00');
    // The section 10 heads reach the calculator too, so a leaver is taxed on
    // the same declaration their monthly payroll was computed from.
    expect(input.ltaExemption?.toFixed(2)).toBe('40000.00');
    expect(input.childrenEducationAllowance?.toFixed(2)).toBe('2400.00');
    expect(input.hostelAllowance?.toFixed(2)).toBe('7200.00');
    expect(input.childrenCount).toBe(2);
  });

  it('reads a missing declaration as nothing claimed', () => {
    const input = toTaxDeclarationInput(null);

    expect(input.section80C.toFixed(2)).toBe('0.00');
    expect(input.otherIncome.toFixed(2)).toBe('0.00');
    expect(input.previousEmployerTds.toFixed(2)).toBe('0.00');
    expect(input.ltaExemption?.toFixed(2)).toBe('0.00');
    expect(input.childrenCount).toBe(0);
  });
});

describe('toIncomeTaxConfigInput', () => {
  it('carries the tenant row, its ceilings and its slabs into the calculator shape', () => {
    const config = toIncomeTaxConfigInput(
      {
        standardDeduction: new Decimal(75000),
        rebateIncomeLimit: new Decimal(700000),
        rebateMaxAmount: new Decimal(25000),
        cessRate: new Decimal(4),
        surchargeSlabs: [{ threshold: 5000000, rate: 10 }],
        section80CLimit: new Decimal(150000),
        section80DLimit: new Decimal(25000),
        section80CCD1BLimit: new Decimal(50000),
        childrenEducationMonthlyLimit: new Decimal(100),
        hostelAllowanceMonthlyLimit: new Decimal(300),
        childrenAllowanceMaxChildren: 2,
        marginalReliefEnabled: true,
        slabs: [
          {
            fromAmount: new Decimal(0),
            toAmount: new Decimal(300000),
            rate: new Decimal(0),
          },
          { fromAmount: new Decimal(300000), toAmount: null, rate: new Decimal(5) },
        ],
      },
      'NEW',
      TaxAgeBand.GENERAL,
    );

    expect(config.regime).toBe('NEW');
    expect(config.standardDeduction.toFixed(2)).toBe('75000.00');
    expect(config.slabs).toHaveLength(2);
    expect(config.slabs[1].toAmount).toBeNull();
    expect(config.surchargeSlabs).toEqual([{ threshold: 5000000, rate: 10 }]);
    expect(config.limits?.section80C.toFixed(2)).toBe('150000.00');
    expect(config.ageBand).toBe(TaxAgeBand.GENERAL);
    // The year's section 10(14) ceilings, so the calculator caps a leaver's
    // children's allowances exactly as it caps a serving employee's.
    expect(config.section10Limits?.childrenEducationMonthlyLimit.toFixed(2)).toBe(
      '100.00',
    );
    expect(config.section10Limits?.hostelAllowanceMonthlyLimit.toFixed(2)).toBe('300.00');
    expect(config.section10Limits?.maxChildren).toBe(2);
  });
});
