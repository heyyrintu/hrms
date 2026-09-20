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
    // Furnished by default so the relief cases below have something to
    // compute; the gate on it has a test of its own.
    form10EFurnished: true,
    // Comfortably more than any tax below, so the cap does not bite unless a
    // test is about the cap.
    payableBeforeTax: new Decimal(5000000),
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

  // -------------------------------------------------------------------------
  // Tax capped at what is actually payable
  // -------------------------------------------------------------------------

  describe('the cap at what is actually payable', () => {
    /**
     * The year's tax comes to 31,500 as above, but this settlement only pays
     * 20,000 after notice recovery. An employer cannot deduct from a payment
     * that does not exist, so 20,000 comes off and the remaining 11,500 is the
     * leaver's own liability on assessment.
     */
    it('deducts no more than the settlement pays, and records the balance', () => {
      const result = computeSettlementTax(
        makeInput({ payableBeforeTax: new Decimal(20000) }) as never,
      );

      expect(result.working.annualTax).toBe('71500.00');
      expect(result.working.taxBeforeCap).toBe('31500.00');
      expect(result.tds.toFixed(2)).toBe('20000.00');
      expect(result.working.uncollectedTax).toBe('11500.00');
      expect(result.working.payableBeforeTax).toBe('20000.00');
      expect(result.working.computedTds).toBe('20000.00');
      expect(result.working.note).toMatch(/11500\.00/);
    });

    it('deducts nothing from a settlement that pays nothing', () => {
      const result = computeSettlementTax(
        makeInput({ payableBeforeTax: new Decimal(0) }) as never,
      );

      expect(result.tds.toFixed(2)).toBe('0.00');
      expect(result.working.taxBeforeCap).toBe('31500.00');
      expect(result.working.uncollectedTax).toBe('31500.00');
    });

    /**
     * Notice recovery can legitimately drive the net negative: the employer is
     * owed that money either way. There is still nothing to deduct tax from.
     */
    it('deducts nothing when notice recovery has already taken the payment away', () => {
      const result = computeSettlementTax(
        makeInput({ payableBeforeTax: new Decimal(-45000) }) as never,
      );

      expect(result.tds.toFixed(2)).toBe('0.00');
      expect(result.working.uncollectedTax).toBe('31500.00');
    });

    it('leaves the tax alone when the settlement covers it', () => {
      const result = computeSettlementTax(
        makeInput({ payableBeforeTax: new Decimal(31500) }) as never,
      );

      expect(result.tds.toFixed(2)).toBe('31500.00');
      expect(result.working.uncollectedTax).toBe('0.00');
    });
  });

  // -------------------------------------------------------------------------
  // The month of exit
  // -------------------------------------------------------------------------

  describe('the month of exit', () => {
    /**
     * Payroll has already run March 2025 and the settlement also pays
     * pro-rata salary for the same month. Both are paid, so both are taxed:
     *
     *   year to date, the March payslip included          9,00,000
     *   the settlement in full, pro-rata included         3,00,000
     *   ------------------------------------------------------
     *   annual gross                                     12,00,000
     *   less standard deduction                             75,000
     *   taxable                                          11,25,000
     *     3,00,000 -  7,00,000 at  5%                       20,000
     *     7,00,000 - 10,00,000 at 10%                       30,000
     *    10,00,000 - 11,25,000 at 15%                       18,750
     *   tax                                                 68,750
     *   cess at 4%                                           2,750
     *   ------------------------------------------------------
     *   annual tax                                          71,500
     *   less already deducted                               40,000
     *   ------------------------------------------------------
     *   to deduct                                           31,500
     */
    const overlapping = {
      yearToDate: makeYearToDate({
        exitMonthPayslips: {
          count: 1,
          grossPaid: new Decimal(90000),
          year: 2025,
          month: 3,
        },
      }),
    };

    it('taxes the settlement pro-rata even where the exit month is on a payslip', () => {
      const result = computeSettlementTax(makeInput(overlapping) as never);

      expect(result.working.settlementTaxable.proRataSalary).toBe('100000.00');
      expect(result.working.settlementTaxable.total).toBe('300000.00');
      expect(result.working.projectedAnnualGross).toBe('1200000.00');
      expect(result.working.annualTax).toBe('71500.00');
      expect(result.tds.toFixed(2)).toBe('31500.00');
    });

    /**
     * The duplication, if it is one, is in what is *paid*. So it is named on
     * both sides and flagged, and nothing is quietly netted off.
     */
    it('records the overlap, names both figures, and flags it for a person', () => {
      const result = computeSettlementTax(makeInput(overlapping) as never);

      expect(result.working.exitMonth).toEqual({
        year: 2025,
        month: 3,
        payslipsAlreadyRun: 1,
        payslipGross: '90000.00',
        settlementProRata: '100000.00',
        requiresReview: true,
        note: expect.stringMatching(/NEEDS REVIEW/),
      });
      // Both figures appear in the note, and the month they collide in.
      expect(result.working.exitMonth?.note).toMatch(/90000\.00/);
      expect(result.working.exitMonth?.note).toMatch(/100000\.00/);
      expect(result.working.exitMonth?.note).toMatch(/03\/2025/);
      // And it says where the fix belongs: in the payment, not in the tax.
      expect(result.working.exitMonth?.note).toMatch(/not in the tax/i);
      expect(result.working.note).toMatch(/NEEDS REVIEW/);
    });

    /** No run for that month, so there is no overlap to report. */
    it('reports no overlap when payroll has not run the exit month', () => {
      const result = computeSettlementTax(
        makeInput({
          yearToDate: makeYearToDate({
            exitMonthPayslips: {
              count: 0,
              grossPaid: new Decimal(0),
              year: 2025,
              month: 3,
            },
          }),
        }) as never,
      );

      expect(result.working.settlementTaxable.total).toBe('300000.00');
      expect(result.working.exitMonth).toBeNull();
      expect(result.tds.toFixed(2)).toBe('31500.00');
    });

    /**
     * A settlement that pays no pro-rata salary cannot be overlapping one,
     * whatever payroll has already run.
     */
    it('reports no overlap when the settlement pays no pro-rata salary', () => {
      const result = computeSettlementTax(
        makeInput({
          parts: makeParts({ proRataSalary: new Decimal(0) }),
          ...overlapping,
        }) as never,
      );

      expect(result.working.settlementTaxable.total).toBe('200000.00');
      expect(result.working.exitMonth).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Section 89
  // -------------------------------------------------------------------------

  describe('relief under section 89', () => {
    /**
     * Ten months of salary at 9,00,000, then a settlement that bunches six
     * years of gratuity and leave into the same year:
     *
     *   pro-rata salary                                1,00,000
     *   taxable gratuity                               3,00,000
     *   taxable leave encashment                       6,00,000
     *   ------------------------------------------------------
     *   settlement                                    10,00,000
     *   annual gross                                  19,00,000
     *
     * The gratuity is not relieved here at all — rule 21A(3) prescribes a
     * different method and this system has no earlier-year incomes for it —
     * so only the 6,00,000 of leave encashment is spread back:
     *
     *   annual gross less the relievable part         13,00,000
     *
     *   tax on 19,00,000 (taxable 18,25,000)           2,47,000
     *   tax on 13,00,000 (taxable 12,25,000)             88,400
     *   the bunching cost                              1,58,600
     *
     *   a 1,00,000 slice on 13,00,000, so tax on
     *   14,00,000 (taxable 13,25,000)                  1,09,200
     *   less the year's own tax                          88,400
     *   the slice costs                                  20,800
     *   six of them                                    1,24,800
     *
     *   relief = 1,58,600 - 1,24,800                     33,800
     *   annual tax 2,47,000 - 33,800                   2,13,200
     *   less already deducted                             40,000
     *   ------------------------------------------------------
     *   to deduct                                      1,73,200
     */
    const bunched = {
      parts: makeParts({
        proRataSalary: new Decimal(100000),
        gratuityTaxable: new Decimal(300000),
        leaveEncashmentTaxable: new Decimal(600000),
      }),
      section89: {
        yearsEarnedOver: 6,
        receiptYear: { financialYear: 2024, config: NEW_REGIME },
        spreadYears: [
          { financialYear: 2024, config: NEW_REGIME },
          { financialYear: 2023, config: NEW_REGIME },
          { financialYear: 2022, config: NEW_REGIME },
          { financialYear: 2021, config: NEW_REGIME },
          { financialYear: 2020, config: NEW_REGIME },
          { financialYear: 2019, config: NEW_REGIME },
        ],
      },
    };

    it('reduces the tax by the relief the bunching earned', () => {
      const result = computeSettlementTax(makeInput(bunched) as never);

      expect(result.working.projectedAnnualGross).toBe('1900000.00');
      expect(result.working.annualTaxBeforeRelief).toBe('247000.00');
      expect(result.working.section89.relief).toBe('33800.00');
      expect(result.working.annualTax).toBe('213200.00');
      expect(result.tds.toFixed(2)).toBe('173200.00');
    });

    it('keeps the working of the relief, year by year', () => {
      const result = computeSettlementTax(makeInput(bunched) as never);

      expect(result.working.section89.arrears).toBe('900000.00');
      expect(result.working.section89.relievableArrears).toBe('600000.00');
      expect(result.working.section89.yearsEarnedOver).toBe(6);
      expect(result.working.section89.taxIfSpread).toBe('124800.00');
      expect(result.working.section89.years).toHaveLength(6);
      expect(result.working.section89.ineligibleReason).toBeNull();
    });

    /**
     * The arrears are the bunched heads only. Pro-rata salary and other
     * earnings are this year's own income, not an earlier year's caught up.
     * Of those heads, only the leave encashment is relieved.
     */
    it('relieves the leave encashment and leaves the gratuity out of the base', () => {
      const result = computeSettlementTax(makeInput(bunched) as never);

      expect(result.working.section89.arrears).toBe('900000.00');
      expect(result.working.section89.incomeWithoutArrears).toBe('1300000.00');
      expect(result.working.section89.gratuity).toEqual({
        taxable: '300000.00',
        relievable: '0.00',
        excluded: '300000.00',
        reason: 'SECTION_89_GRATUITY_EARLIER_YEAR_INCOMES_UNKNOWN',
        serviceYears: 6,
        note: expect.stringMatching(/21A\(3\)/),
      });
      // Excluded from the relief, not from the income: it is still taxed.
      expect(result.working.settlementTaxable.gratuityTaxable).toBe('300000.00');
      expect(result.working.settlementTaxable.total).toBe('1000000.00');
    });

    /**
     * Gratuity paid for under five years of service — here because the
     * minimum was waived — gets no relief at all under rule 21A(3), and the
     * reason says so rather than pointing at missing data.
     */
    it('admits no relief on gratuity for service of under five years', () => {
      const result = computeSettlementTax(
        makeInput({
          ...bunched,
          section89: {
            ...bunched.section89,
            yearsEarnedOver: 3,
            spreadYears: bunched.section89.spreadYears.slice(0, 3),
          },
        }) as never,
      );

      expect(result.working.section89.gratuity.reason).toBe(
        'SECTION_89_GRATUITY_SERVICE_UNDER_FIVE_YEARS',
      );
      expect(result.working.section89.gratuity.excluded).toBe('300000.00');
      expect(result.working.section89.relievableArrears).toBe('600000.00');
    });

    /**
     * Section 192(2A): without Form 10E the employer has no basis for
     * reducing the deduction, so the whole 2,47,000 stands.
     */
    it('gives no relief, with a reason, when no Form 10E has been furnished', () => {
      const result = computeSettlementTax(
        makeInput({ ...bunched, form10EFurnished: false }) as never,
      );

      expect(result.working.section89.form10EFurnished).toBe(false);
      expect(result.working.section89.relief).toBe('0.00');
      expect(result.working.section89.ineligibleReason).toBe(
        'SECTION_89_FORM_10E_NOT_FURNISHED',
      );
      expect(result.working.annualTax).toBe('247000.00');
      expect(result.tds.toFixed(2)).toBe('207000.00');
      expect(result.working.note).toMatch(/192\(2A\)/);
    });

    it('gives no relief, with a reason, when an earlier year has no slabs', () => {
      const result = computeSettlementTax(
        makeInput({
          ...bunched,
          section89: {
            ...bunched.section89,
            spreadYears: [
              { financialYear: 2024, config: NEW_REGIME },
              { financialYear: 2023, config: null },
              { financialYear: 2022, config: null },
              { financialYear: 2021, config: null },
              { financialYear: 2020, config: null },
              { financialYear: 2019, config: null },
            ],
          },
        }) as never,
      );

      expect(result.working.section89.relief).toBe('0.00');
      expect(result.working.section89.ineligibleReason).toBe(
        'SECTION_89_NO_TAX_CONFIGURATION',
      );
      expect(result.working.annualTax).toBe('247000.00');
      expect(result.tds.toFixed(2)).toBe('207000.00');
    });

    it('gives no relief, with a reason, when nothing says how many years', () => {
      const result = computeSettlementTax(makeInput({ parts: bunched.parts }) as never);

      expect(result.working.section89.relief).toBe('0.00');
      // Nothing is known about the service either, so the gratuity is out on
      // that ground and the leave encashment is out for want of years.
      expect(result.working.section89.gratuity.reason).toBe(
        'SECTION_89_GRATUITY_SERVICE_YEARS_UNKNOWN',
      );
      expect(result.working.section89.ineligibleReason).toBe(
        'SECTION_89_YEARS_EARNED_OVER_UNKNOWN',
      );
      expect(result.working.section89.note).toMatch(/Form 10E/);
    });

    it('never lets the relief make the year\'s tax negative', () => {
      const result = computeSettlementTax(
        makeInput({
          ...bunched,
          yearToDate: makeYearToDate({ grossPaid: new Decimal(0), tdsDeducted: new Decimal(0) }),
        }) as never,
      );

      expect(new Decimal(result.working.annualTax as string).isNegative()).toBe(false);
      expect(result.tds.isNegative()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Approved proofs
  // -------------------------------------------------------------------------

  describe('approved proofs', () => {
    it('records that verified figures replaced declared ones, and both sets', () => {
      const result = computeSettlementTax(
        makeInput({
          regime: 'OLD',
          config: OLD_REGIME,
          declaration: toTaxDeclarationInput({ section80C: new Decimal(0) }),
          proofs: {
            applied: true,
            cutoffMonth: 1,
            verified: { section80C: '40000.00', hraExemption: '0.00' },
            declared: { section80C: '150000.00', hraExemption: '60000.00' },
          },
        }) as never,
      );

      expect(result.working.proofs).toEqual({
        applied: true,
        cutoffMonth: 1,
        verified: { section80C: '40000.00', hraExemption: '0.00' },
        declared: { section80C: '150000.00', hraExemption: '60000.00' },
      });
      expect(result.working.note).toMatch(/approved proof/i);
    });

    it('records that the declaration stood where verification was not in force', () => {
      const result = computeSettlementTax(makeInput() as never);

      expect(result.working.proofs).toEqual({
        applied: false,
        cutoffMonth: null,
        verified: null,
        declared: null,
      });
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
