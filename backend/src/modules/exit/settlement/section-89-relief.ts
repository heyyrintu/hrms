import { Decimal } from '@prisma/client/runtime/library';
import {
  calculateIncomeTax,
  IncomeTaxConfigInput,
  TaxDeclarationInput,
} from '../../payroll/statutory/statutory.calculators';
import type {
  Section89Input,
  Section89Result,
} from '../../payroll/statutory/completion.types';

/**
 * Relief under section 89 on a settlement, read with rule 21A.
 *
 * The rule the relief encodes lives in `completion.types.ts` and is not
 * restated here. What this file decides is narrower: how the four tax figures
 * that rule asks for are obtained from the data a settlement actually has.
 *
 * Every tax figure comes from `calculateIncomeTax`. There is one income tax
 * engine in this codebase and this is emphatically not a second one: slabs,
 * rebate, surcharge, marginal relief and cess are its business, and this only
 * decides which incomes to hand it and which year's configuration to hand it
 * with each.
 *
 * THE BASIS OF THE TWO INCOME FIGURES. `totalIncomeWithArrears` and
 * `totalIncomeWithoutArrears` are gross salary income for the year, on the
 * same basis the settlement's own annual figure is, because that is the figure
 * `calculateIncomeTax` takes. The standard deduction, the declaration and the
 * professional tax paid are applied by the calculator to every one of the four
 * figures alike. Handing it an income already net of deductions would deduct
 * them twice, and applying them to only two of the four figures would make the
 * two sides of the comparison different calculations.
 *
 * WHAT IS ASSUMED, AND WHY IT ERRS THE WAY IT DOES. Rule 21A wants each
 * earlier year's own total income. Nothing in this system records what a
 * leaver earned in a year it did not run payroll for, so each earlier year is
 * taxed on the income of the year of receipt excluding the bunched amount.
 * That stand-in is almost always too high — salaries rise — so each slice is
 * taxed at a higher marginal rate than it truly attracted, the spread tax
 * comes out larger, and the relief comes out **smaller** than the true figure.
 * That is the safe direction: too little relief is too much tax deducted,
 * which the employee recovers on assessment, where too much relief is tax the
 * employer failed to deduct and owes interest on. The assumption is recorded
 * in the working rather than buried here, because a leaver comparing this with
 * their own Form 10E is entitled to know which figures it used.
 *
 * The amount is spread evenly across the years it was earned over, the year of
 * receipt included. Evenly, because nothing records how much of a gratuity
 * accrued in which year, and any other split would be a fabrication dressed as
 * arithmetic.
 *
 * This is not a substitute for review by a qualified payroll professional, and
 * it is not Form 10E: the employee still files that themselves.
 */

/** Nothing was bunched, so there is nothing for the section to relieve. */
export const SECTION_89_NO_ARREARS = 'SECTION_89_NO_ARREARS';

/** The years the amount was earned over are not known, or were not supplied. */
export const SECTION_89_YEARS_UNKNOWN = 'SECTION_89_YEARS_EARNED_OVER_UNKNOWN';

/** One of the years to be taxed has no seeded slabs. */
export const SECTION_89_MISSING_CONFIGURATION = 'SECTION_89_NO_TAX_CONFIGURATION';

/** One year, so nothing is bunched and the two sides of the comparison agree. */
export const SECTION_89_SINGLE_YEAR = 'SECTION_89_EARNED_IN_ONE_YEAR';

/** Spreading the amount back was no cheaper, so the relief floors at zero. */
export const SECTION_89_NOT_BENEFICIAL = 'SECTION_89_SPREADING_BACK_IS_NOT_CHEAPER';

const ZERO = new Decimal(0);

/** Round to paise, half up, as every other money figure on a settlement is. */
function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** A year the bunched amount is spread back over, and its slabs. */
export interface Section89YearBasis {
  financialYear: number;
  /** Null where the tenant has seeded no configuration for that year. */
  config: IncomeTaxConfigInput | null;
}

export interface Section89ReliefInput extends Section89Input {
  /** The year of receipt, whose configuration taxes both of the income figures. */
  receiptYear: Section89YearBasis;
  /**
   * One entry per year the amount is spread back over, the year of receipt
   * included, each with that year's own slabs. Fewer entries than
   * `yearsEarnedOver` means the spread cannot be worked out.
   */
  spreadYears: Section89YearBasis[];
  /** Applied to every year taxed, for the reason given at the head of the file. */
  declaration: TaxDeclarationInput;
  professionalTaxPaid: Decimal;
}

/** One year of the spread, as the working records it. */
export interface Section89YearWorking {
  financialYear: number;
  /** The part of the bunched amount attributed to this year. */
  arrearsSlice: string;
  /** The year's tax on the stand-in income without the slice. */
  taxWithoutSlice: string;
  /** And with it. */
  taxWithSlice: string;
  /** The difference: what the slice cost in that year. */
  taxOnSlice: string;
}

export interface Section89Working {
  /** The stand-in income each spread year was taxed on. See the file header. */
  assumedYearlyIncome: string;
  arrears: string;
  yearsEarnedOver: number;
  years: Section89YearWorking[];
  /** Tax the bunching added to the year of receipt. */
  costOfBunching: string;
  /** What the same amount would have cost spread back. */
  taxIfSpread: string;
  /** The difference before the floor, which is what shows a floored figure. */
  reliefBeforeFloor: string;
  /** Years that had to be taxed but had no seeded slabs. */
  yearsWithoutConfiguration: number[];
  note: string;
}

export interface Section89ReliefOutcome extends Section89Result {
  working: Section89Working;
}

const ASSUMPTION_NOTE =
  "Each earlier year was taxed on the year of receipt's own income excluding " +
  'the bunched amount, because nothing records what the employee earned in a ' +
  'year this system did not run payroll for. That stand-in is usually higher ' +
  'than the real figure, so the relief below is if anything understated; the ' +
  'balance is recovered on assessment when the employee files Form 10E.';

/** A refusal: no relief, the reason, and enough working to see why. */
function refuse(
  reason: string,
  note: string,
  partial: {
    taxWithArrears?: Decimal;
    taxWithoutArrears?: Decimal;
    input: Section89ReliefInput;
    yearsWithoutConfiguration?: number[];
  },
): Section89ReliefOutcome {
  return {
    relief: ZERO,
    taxWithArrears: partial.taxWithArrears ?? ZERO,
    taxWithoutArrears: partial.taxWithoutArrears ?? ZERO,
    taxIfSpread: ZERO,
    ineligibleReason: reason,
    working: {
      assumedYearlyIncome: partial.input.totalIncomeWithoutArrears.toFixed(2),
      arrears: partial.input.arrears.toFixed(2),
      yearsEarnedOver: Number.isFinite(partial.input.yearsEarnedOver)
        ? partial.input.yearsEarnedOver
        : 0,
      years: [],
      costOfBunching: '0.00',
      taxIfSpread: '0.00',
      reliefBeforeFloor: '0.00',
      yearsWithoutConfiguration: partial.yearsWithoutConfiguration ?? [],
      note,
    },
  };
}

/**
 * Split the bunched amount into one slice per year, to the paisa.
 *
 * The last year takes the remainder, so the slices add back to exactly what
 * was bunched. A settlement whose parts do not sum to the whole is the kind of
 * thing somebody finds two years later in an assessment.
 */
function sliceArrears(arrears: Decimal, years: number): Decimal[] {
  const each = money(arrears.div(years));
  const slices = Array.from({ length: years }, () => each);
  slices[years - 1] = money(arrears.sub(each.mul(years - 1)));
  return slices;
}

/**
 * Relief under section 89 on the bunched part of a settlement.
 *
 * Returns zero with a reason wherever it cannot be computed. Zero relief and
 * no reason would leave a leaver asking why they got nothing, and "the
 * calculation produced zero" is not an answer anybody can act on.
 */
export function calculateSection89Relief(
  input: Section89ReliefInput,
): Section89ReliefOutcome {
  const { arrears, yearsEarnedOver, receiptYear, spreadYears } = input;

  if (arrears.lte(0)) {
    return refuse(
      SECTION_89_NO_ARREARS,
      'Nothing in this settlement is taxable arrears of an earlier year, so ' +
        'no relief under section 89 arises.',
      { input },
    );
  }

  if (!Number.isInteger(yearsEarnedOver) || yearsEarnedOver < 1) {
    return refuse(
      SECTION_89_YEARS_UNKNOWN,
      'The number of years this amount was earned over is not known, so it ' +
        'cannot be spread back and no relief under section 89 has been given. ' +
        'The employee may still claim it on Form 10E.',
      { input },
    );
  }

  if (spreadYears.length < yearsEarnedOver) {
    return refuse(
      SECTION_89_YEARS_UNKNOWN,
      `The amount was earned over ${yearsEarnedOver} years but only ` +
        `${spreadYears.length} of them could be identified, so it cannot be ` +
        'spread back and no relief under section 89 has been given. The ' +
        'employee may still claim it on Form 10E.',
      { input },
    );
  }

  const years = spreadYears.slice(0, yearsEarnedOver);

  // Every year that has to be taxed, the year of receipt included. A missing
  // configuration anywhere makes the comparison meaningless rather than
  // merely approximate, so it refuses instead of quietly dropping that year.
  const missing = [
    ...(receiptYear.config ? [] : [receiptYear.financialYear]),
    ...years.filter((y) => !y.config).map((y) => y.financialYear),
  ];
  if (missing.length > 0) {
    return refuse(
      SECTION_89_MISSING_CONFIGURATION,
      `There are no income tax slabs seeded for ${missing.join(', ')}, so the ` +
        'bunched amount cannot be taxed as if it had been received in those ' +
        "years and no relief under section 89 has been given. Seed those years' " +
        'slabs and recompute, or enter the tax as an override.',
      { input, yearsWithoutConfiguration: missing },
    );
  }

  // Safe past the guard above: every config in play is non-null.
  const receiptConfig = receiptYear.config as IncomeTaxConfigInput;

  const taxWithArrears = calculateIncomeTax(
    input.totalIncomeWithArrears,
    receiptConfig,
    input.declaration,
    input.professionalTaxPaid,
  ).totalTax;
  const taxWithoutArrears = calculateIncomeTax(
    input.totalIncomeWithoutArrears,
    receiptConfig,
    input.declaration,
    input.professionalTaxPaid,
  ).totalTax;

  if (yearsEarnedOver === 1) {
    return {
      relief: ZERO,
      taxWithArrears: money(taxWithArrears),
      taxWithoutArrears: money(taxWithoutArrears),
      taxIfSpread: money(taxWithArrears.sub(taxWithoutArrears)),
      ineligibleReason: SECTION_89_SINGLE_YEAR,
      working: {
        assumedYearlyIncome: input.totalIncomeWithoutArrears.toFixed(2),
        arrears: arrears.toFixed(2),
        yearsEarnedOver,
        years: [],
        costOfBunching: money(taxWithArrears.sub(taxWithoutArrears)).toFixed(2),
        taxIfSpread: money(taxWithArrears.sub(taxWithoutArrears)).toFixed(2),
        reliefBeforeFloor: '0.00',
        yearsWithoutConfiguration: [],
        note:
          'The amount was earned in the year it was received, so nothing has ' +
          'been bunched and section 89 has nothing to relieve.',
      },
    };
  }

  // The stand-in income every spread year is taxed on. See the file header for
  // what this assumes and which way it errs.
  const base = input.totalIncomeWithoutArrears;
  const slices = sliceArrears(arrears, yearsEarnedOver);

  const yearWorking: Section89YearWorking[] = [];
  let taxIfSpread = ZERO;

  for (let i = 0; i < yearsEarnedOver; i += 1) {
    const config = years[i].config as IncomeTaxConfigInput;
    const slice = slices[i];

    const withoutSlice = calculateIncomeTax(
      base,
      config,
      input.declaration,
      input.professionalTaxPaid,
    ).totalTax;
    const withSlice = calculateIncomeTax(
      base.add(slice),
      config,
      input.declaration,
      input.professionalTaxPaid,
    ).totalTax;

    // Floored per year for the same reason the whole relief is: a year in
    // which adding income lowered the tax is a configuration error, not a
    // credit to hand back through the years around it.
    const cost = Decimal.max(withSlice.sub(withoutSlice), ZERO);
    taxIfSpread = taxIfSpread.add(cost);

    yearWorking.push({
      financialYear: years[i].financialYear,
      arrearsSlice: slice.toFixed(2),
      taxWithoutSlice: money(withoutSlice).toFixed(2),
      taxWithSlice: money(withSlice).toFixed(2),
      taxOnSlice: money(cost).toFixed(2),
    });
  }

  const costOfBunching = taxWithArrears.sub(taxWithoutArrears);
  const reliefBeforeFloor = money(costOfBunching.sub(taxIfSpread));
  const relief = Decimal.max(reliefBeforeFloor, ZERO);

  return {
    relief,
    taxWithArrears: money(taxWithArrears),
    taxWithoutArrears: money(taxWithoutArrears),
    taxIfSpread: money(taxIfSpread),
    ineligibleReason: relief.gt(0) ? null : SECTION_89_NOT_BENEFICIAL,
    working: {
      assumedYearlyIncome: base.toFixed(2),
      arrears: arrears.toFixed(2),
      yearsEarnedOver,
      years: yearWorking,
      costOfBunching: money(costOfBunching).toFixed(2),
      taxIfSpread: money(taxIfSpread).toFixed(2),
      reliefBeforeFloor: reliefBeforeFloor.toFixed(2),
      yearsWithoutConfiguration: [],
      note: relief.gt(0)
        ? `Bunching ${arrears.toFixed(2)} of gratuity and leave earned over ` +
          `${yearsEarnedOver} years into one year cost ` +
          `${money(costOfBunching).toFixed(2)} in tax, against ` +
          `${money(taxIfSpread).toFixed(2)} had it been received across those ` +
          `years; the difference is relieved under section 89. ${ASSUMPTION_NOTE}`
        : 'Spreading the bunched amount back over the years it was earned was ' +
          'no cheaper than taxing it all at once, so no relief under section 89 ' +
          `arises. Relief cannot be negative, so it is nil rather than ` +
          `${reliefBeforeFloor.toFixed(2)}. ${ASSUMPTION_NOTE}`,
    },
  };
}
