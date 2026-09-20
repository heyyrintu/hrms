import { Decimal } from '@prisma/client/runtime/library';
import { TaxAgeBand } from '@prisma/client';
import {
  calculateSection89Relief,
  SECTION_89_FORM_10E_NOT_FURNISHED,
  SECTION_89_GRATUITY_EARLIER_YEARS_UNKNOWN,
  SECTION_89_GRATUITY_SERVICE_UNKNOWN,
  SECTION_89_GRATUITY_UNDER_FIVE_YEARS,
  SECTION_89_MISSING_CONFIGURATION,
  SECTION_89_NOT_BENEFICIAL,
  SECTION_89_NO_ARREARS,
  SECTION_89_SINGLE_YEAR,
  SECTION_89_YEARS_UNKNOWN,
} from './section-89-relief';
import { toTaxDeclarationInput } from './settlement-tax';
import type { IncomeTaxConfigInput } from '../../payroll/statutory/statutory.calculators';

/**
 * The new regime's slabs for FY 2024-25, which are easy to walk by hand:
 *
 *   standard deduction    75,000
 *   0 - 3,00,000             nil
 *   3,00,000 - 7,00,000       5%
 *   7,00,000 - 10,00,000     10%
 *   10,00,000 - 12,00,000    15%
 *   12,00,000 - 15,00,000    20%
 *   above 15,00,000          30%
 *   cess                      4%
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
    { fromAmount: new Decimal(300000), toAmount: new Decimal(700000), rate: new Decimal(5) },
    { fromAmount: new Decimal(700000), toAmount: new Decimal(1000000), rate: new Decimal(10) },
    { fromAmount: new Decimal(1000000), toAmount: new Decimal(1200000), rate: new Decimal(15) },
    { fromAmount: new Decimal(1200000), toAmount: new Decimal(1500000), rate: new Decimal(20) },
    { fromAmount: new Decimal(1500000), toAmount: null, rate: new Decimal(30) },
  ],
};

/** A deliberately punitive year, for the case where spreading back costs more. */
const FLAT_THIRTY: IncomeTaxConfigInput = {
  ...NEW_REGIME,
  standardDeduction: new Decimal(0),
  rebateIncomeLimit: new Decimal(0),
  rebateMaxAmount: new Decimal(0),
  slabs: [{ fromAmount: new Decimal(0), toAmount: null, rate: new Decimal(30) }],
};

const NO_DECLARATION = toTaxDeclarationInput(null);

function year(financialYear: number, config: IncomeTaxConfigInput | null) {
  return { financialYear, config };
}

describe('calculateSection89Relief', () => {
  /**
   * Base salary income for the year, without the settlement's lump:
   *
   *   gross                                       12,00,000
   *   less standard deduction                        75,000
   *   taxable                                     11,25,000
   *     3,00,000 - 7,00,000 at 5%                    20,000
   *     7,00,000 - 10,00,000 at 10%                  30,000
   *     10,00,000 - 11,25,000 at 15%                 18,750
   *   tax                                            68,750
   *   cess at 4%                                      2,750
   *   ------------------------------------------------------
   *   tax without arrears                            71,500
   *
   * With three years of gratuity and leave bunched in, 9,00,000:
   *
   *   gross                                       21,00,000
   *   taxable                                     20,25,000
   *     3,00,000 - 7,00,000 at 5%                    20,000
   *     7,00,000 - 10,00,000 at 10%                  30,000
   *     10,00,000 - 12,00,000 at 15%                 30,000
   *     12,00,000 - 15,00,000 at 20%                 60,000
   *     above 15,00,000 at 30% on 5,25,000         1,57,500
   *   tax                                          2,97,500
   *   cess at 4%                                     11,900
   *   ------------------------------------------------------
   *   tax with arrears                             3,09,400
   *
   *   cost of bunching = 3,09,400 - 71,500       = 2,37,900
   *
   * Spread back over three years, 3,00,000 a year on the same base:
   *
   *   gross                                       15,00,000
   *   taxable                                     14,25,000
   *     3,00,000 - 7,00,000 at 5%                    20,000
   *     7,00,000 - 10,00,000 at 10%                  30,000
   *     10,00,000 - 12,00,000 at 15%                 30,000
   *     12,00,000 - 14,25,000 at 20%                 45,000
   *   tax                                          1,25,000
   *   cess at 4%                                      5,000
   *   ------------------------------------------------------
   *                                                1,30,000
   *   less the year's own tax                        71,500
   *   the slice costs                                58,500
   *   three of them                                1,75,500
   *
   *   relief = 2,37,900 - 1,75,500                =   62,400
   */
  it('relieves the extra tax that bunching three years into one created', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [year(2024, NEW_REGIME), year(2023, NEW_REGIME), year(2022, NEW_REGIME)],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.taxWithoutArrears.toFixed(2)).toBe('71500.00');
    expect(result.taxWithArrears.toFixed(2)).toBe('309400.00');
    expect(result.taxIfSpread.toFixed(2)).toBe('175500.00');
    expect(result.relief.toFixed(2)).toBe('62400.00');
    expect(result.ineligibleReason).toBeNull();
  });

  it('shows each year it spread the amount back over, and the slice', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [year(2024, NEW_REGIME), year(2023, NEW_REGIME), year(2022, NEW_REGIME)],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.working.years).toHaveLength(3);
    expect(result.working.years.map((y) => y.financialYear)).toEqual([2024, 2023, 2022]);
    for (const y of result.working.years) {
      expect(y.arrearsSlice).toBe('300000.00');
      expect(y.taxOnSlice).toBe('58500.00');
    }
  });

  /**
   * The slices must add back to the amount bunched, to the paisa. 1,00,000
   * over three years is 33,333.33, 33,333.33 and 33,333.34.
   */
  it('gives the last year the rounding remainder so the slices sum to the arrears', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(1300000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(100000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [year(2024, NEW_REGIME), year(2023, NEW_REGIME), year(2022, NEW_REGIME)],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    const slices = result.working.years.map((y) => y.arrearsSlice);
    expect(slices).toEqual(['33333.33', '33333.33', '33333.34']);
    const sum = slices.reduce((acc, s) => acc.add(new Decimal(s)), new Decimal(0));
    expect(sum.toFixed(2)).toBe('100000.00');
  });

  /**
   * Spreading back into years taxed at a flat 30% from the first rupee costs
   * more than taking the lump in a year with slabs. Bunching cannot cost the
   * taxpayer less than spreading, so a negative result means the calculation
   * is wrong, not the taxpayer: it is floored, and the reason says so.
   *
   *   cost of bunching                             2,37,900 (as above)
   *   a 3,00,000 slice at 30% plus 4% cess            93,600
   *   three of them                                2,80,800
   *   the difference would be                       -42,900
   */
  it('floors relief at zero, with the reason, when spreading back costs more', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [
        year(2024, FLAT_THIRTY),
        year(2023, FLAT_THIRTY),
        year(2022, FLAT_THIRTY),
      ],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.relief.toFixed(2)).toBe('0.00');
    expect(result.ineligibleReason).toBe(SECTION_89_NOT_BENEFICIAL);
    expect(result.working.reliefBeforeFloor).toBe('-42900.00');
  });

  it('refuses, with a reason, when an earlier year has no tax configuration', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [year(2024, NEW_REGIME), year(2023, null), year(2022, NEW_REGIME)],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.relief.toFixed(2)).toBe('0.00');
    expect(result.ineligibleReason).toBe(SECTION_89_MISSING_CONFIGURATION);
    expect(result.working.yearsWithoutConfiguration).toEqual([2023]);
    expect(result.working.note).toContain('2023');
  });

  it('refuses, with a reason, when the year of receipt has no tax configuration', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, null),
      spreadYears: [year(2024, NEW_REGIME), year(2023, NEW_REGIME), year(2022, NEW_REGIME)],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.relief.toFixed(2)).toBe('0.00');
    expect(result.ineligibleReason).toBe(SECTION_89_MISSING_CONFIGURATION);
    expect(result.working.yearsWithoutConfiguration).toEqual([2024]);
  });

  it.each([0, -3, 1.5, Number.NaN])(
    'refuses, with a reason, when the years earned over is %p',
    (years) => {
      const result = calculateSection89Relief({
        totalIncomeWithArrears: new Decimal(2100000),
        totalIncomeWithoutArrears: new Decimal(1200000),
        arrears: new Decimal(900000),
        yearsEarnedOver: years,
        receiptYear: year(2024, NEW_REGIME),
        spreadYears: [],
        declaration: NO_DECLARATION,
        form10EFurnished: true,
        professionalTaxPaid: new Decimal(0),
      });

      expect(result.relief.toFixed(2)).toBe('0.00');
      expect(result.ineligibleReason).toBe(SECTION_89_YEARS_UNKNOWN);
    },
  );

  it('refuses, with a reason, when one year is earned over so nothing is bunched', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 1,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [year(2024, NEW_REGIME)],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.relief.toFixed(2)).toBe('0.00');
    expect(result.ineligibleReason).toBe(SECTION_89_SINGLE_YEAR);
  });

  it('refuses, with a reason, when there is nothing bunched to relieve', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(1200000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(0),
      yearsEarnedOver: 5,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.relief.toFixed(2)).toBe('0.00');
    expect(result.ineligibleReason).toBe(SECTION_89_NO_ARREARS);
  });

  it('refuses when fewer years were supplied than the amount was earned over', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [year(2024, NEW_REGIME), year(2023, NEW_REGIME)],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.relief.toFixed(2)).toBe('0.00');
    expect(result.ineligibleReason).toBe(SECTION_89_YEARS_UNKNOWN);
  });

  /**
   * Professional tax and the declaration reach every one of the four tax
   * figures, not only the two for the year of receipt. Computing the spread
   * years on a bare income while the receipt year got the deductions would
   * make the two sides of the comparison different calculations.
   */
  it('applies the declaration and professional tax to every year it taxes', () => {
    const OLD_REGIME: IncomeTaxConfigInput = {
      ...NEW_REGIME,
      regime: 'OLD',
      standardDeduction: new Decimal(50000),
      limits: {
        section80C: new Decimal(150000),
        section80D: new Decimal(25000),
        section80CCD1B: new Decimal(50000),
      },
    };
    const declared = toTaxDeclarationInput({ section80C: new Decimal(150000) });

    const withDeduction = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, OLD_REGIME),
      spreadYears: [year(2024, OLD_REGIME), year(2023, OLD_REGIME), year(2022, OLD_REGIME)],
      declaration: declared,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(2400),
    });

    const without = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, OLD_REGIME),
      spreadYears: [year(2024, OLD_REGIME), year(2023, OLD_REGIME), year(2022, OLD_REGIME)],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    // 1,52,400 off every year's income moves all four figures, not two.
    expect(withDeduction.taxWithoutArrears.lt(without.taxWithoutArrears)).toBe(true);
    expect(withDeduction.taxWithArrears.lt(without.taxWithArrears)).toBe(true);
    expect(withDeduction.taxIfSpread.lt(without.taxIfSpread)).toBe(true);
  });

  it('never returns a negative relief whatever the years cost', () => {
    const result = calculateSection89Relief({
      totalIncomeWithArrears: new Decimal(800000),
      totalIncomeWithoutArrears: new Decimal(700000),
      arrears: new Decimal(100000),
      yearsEarnedOver: 4,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [
        year(2024, FLAT_THIRTY),
        year(2023, FLAT_THIRTY),
        year(2022, FLAT_THIRTY),
        year(2021, FLAT_THIRTY),
      ],
      declaration: NO_DECLARATION,
      form10EFurnished: true,
      professionalTaxPaid: new Decimal(0),
    });

    expect(result.relief.isNegative()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Section 192(2A): relief only on particulars furnished in Form 10E
  // -------------------------------------------------------------------------

  describe('Form 10E', () => {
    /** The same 9,00,000 over three years the first case works out in full. */
    const bunched = {
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [
        year(2024, NEW_REGIME),
        year(2023, NEW_REGIME),
        year(2022, NEW_REGIME),
      ],
      declaration: NO_DECLARATION,
      professionalTaxPaid: new Decimal(0),
    };

    it('refuses relief, with a reason, when no Form 10E has been furnished', () => {
      const result = calculateSection89Relief({
        ...bunched,
        form10EFurnished: false,
      });

      expect(result.relief.toFixed(2)).toBe('0.00');
      expect(result.ineligibleReason).toBe(SECTION_89_FORM_10E_NOT_FURNISHED);
      expect(result.working.note).toMatch(/Form 10E/);
      expect(result.working.note).toMatch(/192\(2A\)/);
      expect(result.working.form10EFurnished).toBe(false);
    });

    /** Furnishing it restores exactly the relief the first case computes. */
    it('gives the relief once Form 10E has been furnished', () => {
      const result = calculateSection89Relief({
        ...bunched,
        form10EFurnished: true,
      });

      expect(result.relief.toFixed(2)).toBe('62400.00');
      expect(result.ineligibleReason).toBeNull();
      expect(result.working.form10EFurnished).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 21A(3): gratuity is not relieved by the salary-arrears method
  // -------------------------------------------------------------------------

  describe('gratuity', () => {
    /**
     * The settlement bunches 9,00,000, of which 3,00,000 is the taxable
     * balance of gratuity and 6,00,000 of leave encashment. Only the leave is
     * relieved under rule 21A(2); the gratuity is left out of the relief base
     * but stays in the income, so it is still taxed in full.
     *
     *   total income with the bunched amount           21,00,000
     *   less the relievable part (leave only)           6,00,000
     *   ------------------------------------------------------
     *   income without the relievable arrears          15,00,000
     *
     *   tax on 21,00,000 (taxable 20,25,000)            3,09,400
     *   tax on 15,00,000 (taxable 14,25,000):
     *      3,00,000 -  7,00,000 at  5%                    20,000
     *      7,00,000 - 10,00,000 at 10%                    30,000
     *     10,00,000 - 12,00,000 at 15%                    30,000
     *     12,00,000 - 14,25,000 at 20% on 2,25,000        45,000
     *                                          tax      1,25,000
     *     cess at 4%                                       5,000
     *                                                   1,30,000
     *   cost of bunching = 3,09,400 - 1,30,000          1,79,400
     *
     *   6,00,000 over three years is 2,00,000 a year:
     *   tax on 17,00,000 (taxable 16,25,000):
     *      3,00,000 -  7,00,000 at  5%                    20,000
     *      7,00,000 - 10,00,000 at 10%                    30,000
     *     10,00,000 - 12,00,000 at 15%                    30,000
     *     12,00,000 - 15,00,000 at 20%                    60,000
     *     above 15,00,000 at 30% on 1,25,000              37,500
     *                                          tax      1,77,500
     *     cess at 4%                                       7,100
     *                                                   1,84,600
     *   each slice costs 1,84,600 - 1,30,000              54,600
     *   three of them                                   1,63,800
     *
     *   relief = 1,79,400 - 1,63,800                      15,600
     */
    const mixed = {
      totalIncomeWithArrears: new Decimal(2100000),
      totalIncomeWithoutArrears: new Decimal(1200000),
      arrears: new Decimal(900000),
      yearsEarnedOver: 3,
      receiptYear: year(2024, NEW_REGIME),
      spreadYears: [
        year(2024, NEW_REGIME),
        year(2023, NEW_REGIME),
        year(2022, NEW_REGIME),
      ],
      declaration: NO_DECLARATION,
      professionalTaxPaid: new Decimal(0),
      form10EFurnished: true,
    };

    /**
     * Three completed years, so the gratuity — paid here only because the
     * minimum service was waived — relates to service of under five years and
     * no relief on it is admissible at all under the proviso to rule 21A(3).
     */
    it('admits no relief on gratuity for service of under five years', () => {
      const result = calculateSection89Relief({
        ...mixed,
        gratuity: { taxable: new Decimal(300000), serviceYears: 3 },
      });

      expect(result.working.gratuity.excluded).toBe('300000.00');
      expect(result.working.gratuity.relievable).toBe('0.00');
      expect(result.working.gratuity.reason).toBe(
        SECTION_89_GRATUITY_UNDER_FIVE_YEARS,
      );
      expect(result.working.gratuity.note).toMatch(/less than five years/i);
      expect(result.working.relievableArrears).toBe('600000.00');
      expect(result.relief.toFixed(2)).toBe('15600.00');
    });

    /**
     * Five years or more, so relief would be admissible — but only by the
     * average-rate method of rule 21A(3), which needs each preceding year's
     * own total income, and nothing in this system records it.
     */
    it('refuses relief on gratuity for five years or more, saying why', () => {
      const result = calculateSection89Relief({
        ...mixed,
        gratuity: { taxable: new Decimal(300000), serviceYears: 8 },
      });

      expect(result.working.gratuity.excluded).toBe('300000.00');
      expect(result.working.gratuity.reason).toBe(
        SECTION_89_GRATUITY_EARLIER_YEARS_UNKNOWN,
      );
      // Five but under fifteen: one half added to each of two preceding years.
      expect(result.working.gratuity.note).toMatch(/one-half/i);
      expect(result.working.gratuity.note).toMatch(/two preceding/i);
      expect(result.working.relievableArrears).toBe('600000.00');
      expect(result.relief.toFixed(2)).toBe('15600.00');
    });

    /** Fifteen years or more takes the other limb: a third across three years. */
    it('names the three-year limb where past service is fifteen years or more', () => {
      const result = calculateSection89Relief({
        ...mixed,
        gratuity: { taxable: new Decimal(300000), serviceYears: 16 },
      });

      expect(result.working.gratuity.reason).toBe(
        SECTION_89_GRATUITY_EARLIER_YEARS_UNKNOWN,
      );
      expect(result.working.gratuity.note).toMatch(/one-third/i);
      expect(result.working.gratuity.note).toMatch(/three preceding/i);
    });

    /**
     * Everything bunched is gratuity, so once it is out of the relief base
     * there is nothing left to spread. The refusal carries the gratuity's own
     * reason, not a bare "nothing was bunched".
     */
    it('refuses with the gratuity reason when the bunched amount is all gratuity', () => {
      const result = calculateSection89Relief({
        ...mixed,
        totalIncomeWithArrears: new Decimal(1500000),
        totalIncomeWithoutArrears: new Decimal(1200000),
        arrears: new Decimal(300000),
        gratuity: { taxable: new Decimal(300000), serviceYears: 8 },
      });

      expect(result.relief.toFixed(2)).toBe('0.00');
      expect(result.ineligibleReason).toBe(
        SECTION_89_GRATUITY_EARLIER_YEARS_UNKNOWN,
      );
      expect(result.working.relievableArrears).toBe('0.00');
    });

    /** Nothing says how long the service was, so nothing is assumed about it. */
    it('refuses relief on gratuity when the years of service are not known', () => {
      const result = calculateSection89Relief({
        ...mixed,
        gratuity: { taxable: new Decimal(300000), serviceYears: 0 },
      });

      expect(result.working.gratuity.reason).toBe(
        SECTION_89_GRATUITY_SERVICE_UNKNOWN,
      );
      expect(result.working.gratuity.excluded).toBe('300000.00');
    });

    /** No gratuity in the settlement at all: the whole bunched amount stands. */
    it('leaves the relief base alone when the settlement pays no gratuity', () => {
      const result = calculateSection89Relief({
        ...mixed,
        gratuity: { taxable: new Decimal(0), serviceYears: 8 },
      });

      expect(result.working.gratuity.excluded).toBe('0.00');
      expect(result.working.gratuity.reason).toBeNull();
      expect(result.working.relievableArrears).toBe('900000.00');
      expect(result.relief.toFixed(2)).toBe('62400.00');
    });
  });
});
