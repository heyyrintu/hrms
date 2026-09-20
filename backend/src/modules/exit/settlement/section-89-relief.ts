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
 * receipt included. Evenly, because nothing records how much of a leave
 * balance accrued in which year, and any other split would be a fabrication
 * dressed as arithmetic.
 *
 * TWO THINGS GATE ALL OF THAT, and both of them refuse rather than assume:
 *
 *  - **Form 10E.** Section 192(2A) lets an employer compute this relief only
 *    on the particulars the employee furnishes in Form 10E. Without the form
 *    the relief is nil, with that as the stated reason. The employee is
 *    entitled to it on assessment either way; what the employer may not do is
 *    assume it. See the gate itself for why that is the safe direction.
 *  - **Gratuity is not relieved here at all.** Rule 21A(2), which is what this
 *    file implements, is not the method rule 21A(3) prescribes for gratuity,
 *    and 21A(3) needs each preceding year's own total income. The gratuity is
 *    therefore kept out of the relief base — while staying in the income, so
 *    it is taxed in full — and the reason is recorded. Where the taxable
 *    gratuity relates to service of less than five years the refusal is the
 *    rule's own: no relief is admissible on it at all. See
 *    `decideGratuityRelief`.
 *
 * What is left in the relief base for a settlement is the taxable balance of
 * leave encashment.
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

/** No Form 10E, so section 192(2A) leaves the employer nothing to compute on. */
export const SECTION_89_FORM_10E_NOT_FURNISHED = 'SECTION_89_FORM_10E_NOT_FURNISHED';

/** Rule 21A(3) admits no relief on gratuity for under five years of service. */
export const SECTION_89_GRATUITY_UNDER_FIVE_YEARS =
  'SECTION_89_GRATUITY_SERVICE_UNDER_FIVE_YEARS';

/** Rule 21A(3) needs each preceding year's income, and none is on record. */
export const SECTION_89_GRATUITY_EARLIER_YEARS_UNKNOWN =
  'SECTION_89_GRATUITY_EARLIER_YEAR_INCOMES_UNKNOWN';

/** How long the service was is not known, so which limb applies is not either. */
export const SECTION_89_GRATUITY_SERVICE_UNKNOWN =
  'SECTION_89_GRATUITY_SERVICE_YEARS_UNKNOWN';

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
  /**
   * Whether the employee has furnished Form 10E for the year of receipt.
   *
   * Section 192(2A) lets the employer compute relief only on the particulars
   * the employee furnishes in that form. Required rather than defaulted: the
   * defect this closes was relief granted on an assumption nobody made
   * deliberately, and a field that has to be supplied cannot be assumed.
   */
  form10EFurnished: boolean;
  /**
   * The part of `arrears` that is gratuity, and the service it relates to.
   *
   * Absent means the bunched amount contains no gratuity. Present, it is
   * decided separately under rule 21A(3) — see `decideGratuityRelief`.
   */
  gratuity?: { taxable: Decimal; serviceYears: number };
}

/** What rule 21A(3) allows on the gratuity, and why. */
export interface Section89GratuityWorking {
  /** The taxable balance of gratuity inside the bunched amount. */
  taxable: string;
  /** How much of it is in the relief base. Nil today: see the file header. */
  relievable: string;
  /** How much of it was kept out of the relief base. */
  excluded: string;
  /** Why it was kept out, or null where there was no gratuity to decide on. */
  reason: string | null;
  /** Completed years of service, which is what rule 21A(3) measures. */
  serviceYears: number;
  note: string;
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
  /** Everything the settlement bunched, gratuity included. */
  arrears: string;
  /** The part of it rule 21A(2) was actually applied to. */
  relievableArrears: string;
  /** What was done about the gratuity inside `arrears`, and why. */
  gratuity: Section89GratuityWorking;
  /** Whether the employee furnished Form 10E. Nothing is relieved without it. */
  form10EFurnished: boolean;
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

/**
 * What rule 21A(3) allows on the gratuity inside the bunched amount.
 *
 * Rule 21A(3) does not use the spread-back method of 21A(2) at all. It works
 * on **average rates of tax**: one-third of the taxable gratuity added to the
 * total income of each of the **three** preceding years where the past service
 * is fifteen years or more, or one-half added to each of **two** preceding
 * years where it is five years or more but under fifteen. And where the
 * taxable gratuity relates to service of **less than five years**, no relief
 * is admissible at all.
 *
 * Both limbs need each preceding year's own total income, and nothing in this
 * system records what a leaver earned in a year it did not run payroll for.
 * The stand-in used for 21A(2) will not do here: 21A(2) compares one income
 * against itself plus a slice, so a stand-in that is too high merely
 * understates the relief, where 21A(3) divides tax by income to get a rate,
 * and a stand-in income produces a stand-in rate with no such guarantee.
 *
 * So the gratuity is kept out of the relief base entirely and the reason is
 * recorded. It stays in the income and is taxed in full, which under-relieves;
 * that is the safe direction, and the employee recovers the balance on
 * assessment through the Form 10E they file themselves. What is refused here
 * is only the employer's own computation of it.
 *
 * The under-five-year bar is enforced separately from that, and stated
 * separately, because the two are different answers: one says the Act allows
 * nothing, the other that this system cannot work out what it allows.
 */
function decideGratuityRelief(
  gratuity: { taxable: Decimal; serviceYears: number } | undefined,
): { excluded: Decimal; working: Section89GratuityWorking } {
  const taxable = gratuity?.taxable ?? ZERO;
  const serviceYears = gratuity?.serviceYears ?? 0;

  const decided = (
    excluded: Decimal,
    reason: string | null,
    note: string,
  ): { excluded: Decimal; working: Section89GratuityWorking } => ({
    excluded,
    working: {
      taxable: money(taxable).toFixed(2),
      relievable: money(taxable.sub(excluded)).toFixed(2),
      excluded: money(excluded).toFixed(2),
      reason,
      serviceYears,
      note,
    },
  });

  if (taxable.lte(0)) {
    return decided(
      ZERO,
      null,
      'This settlement pays no taxable gratuity, so rule 21A(3) has nothing ' +
        'to decide about and the whole of the bunched amount is relieved ' +
        'under rule 21A(2).',
    );
  }

  if (!Number.isInteger(serviceYears) || serviceYears < 1) {
    return decided(
      taxable,
      SECTION_89_GRATUITY_SERVICE_UNKNOWN,
      `The taxable gratuity of ${money(taxable).toFixed(2)} has been left out ` +
        'of the relief base because the length of service it relates to is ' +
        'not known, and rule 21A(3) turns on exactly that: no relief at all ' +
        'under five years, and a different computation above and below ' +
        'fifteen. It is still taxed in full. The employee may claim relief ' +
        'on it in their own Form 10E.',
    );
  }

  if (serviceYears < 5) {
    return decided(
      taxable,
      SECTION_89_GRATUITY_UNDER_FIVE_YEARS,
      `The taxable gratuity of ${money(taxable).toFixed(2)} relates to ` +
        `${serviceYears} completed year(s) of service. Rule 21A(3) admits no ` +
        'relief where the taxable gratuity relates to service of less than ' +
        'five years, so none has been given on it and it is taxed in full. ' +
        'This is a refusal by the rule, not a limitation of this system: ' +
        'there is nothing to claim on Form 10E either.',
    );
  }

  const limb =
    serviceYears >= 15
      ? 'one-third of it added to the total income of each of the three ' +
        'preceding years'
      : 'one-half of it added to the total income of each of the two ' +
        'preceding years';

  return decided(
    taxable,
    SECTION_89_GRATUITY_EARLIER_YEARS_UNKNOWN,
    `The taxable gratuity of ${money(taxable).toFixed(2)} relates to ` +
      `${serviceYears} completed years of service, so relief on it would be ` +
      `computed under rule 21A(3) at the average rates of tax, with ${limb}. ` +
      'Those years\' total incomes are not on record here, so the employer ' +
      'has not computed relief on the gratuity and it has been taxed in full; ' +
      'it is left out of the rule 21A(2) spread below, which is not the method ' +
      'the rule prescribes for it. The employee may claim the relief in their ' +
      'own Form 10E, and recover it on assessment.',
  );
}

/** A refusal: no relief, the reason, and enough working to see why. */
function refuse(
  reason: string,
  note: string,
  partial: {
    taxWithArrears?: Decimal;
    taxWithoutArrears?: Decimal;
    input: Section89ReliefInput;
    yearsWithoutConfiguration?: number[];
    relievableArrears?: string;
    gratuity?: Section89GratuityWorking;
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
      relievableArrears: partial.relievableArrears ?? '0.00',
      gratuity: partial.gratuity ?? decideGratuityRelief(partial.input.gratuity).working,
      form10EFurnished: partial.input.form10EFurnished,
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

  // Rule 21A(3) takes the gratuity out of the 21A(2) spread. What is left is
  // the leave encashment, which the spread-back method does fit. The gratuity
  // stays in `totalIncomeWithArrears` throughout: it is not relieved, but it
  // is certainly taxed.
  const gratuity = decideGratuityRelief(input.gratuity);
  const relievableArrears = money(arrears.sub(gratuity.excluded));
  const gratuityWorking = gratuity.working;

  if (relievableArrears.lte(0)) {
    return refuse(
      // Non-null whenever anything was excluded, which is the only way to get
      // here with a positive `arrears`.
      gratuityWorking.reason ?? SECTION_89_NO_ARREARS,
      gratuityWorking.note +
        ' Nothing else in this settlement is bunched, so no relief under ' +
        'section 89 has been given at all.',
      { input, gratuity: gratuityWorking, relievableArrears: '0.00' },
    );
  }

  // Section 192(2A) lets an employer compute this relief only on the
  // particulars the employee furnishes in Form 10E. Without the form the
  // employer has no basis for reducing the deduction, so it does not.
  //
  // This is the safe direction and deliberately so: too much deducted comes
  // back to the employee on assessment, where too little is tax the employer
  // failed to deduct and owes interest on under section 201(1A). The employee
  // is entitled to the relief on assessment either way; what the employer may
  // not do is assume it.
  if (!input.form10EFurnished) {
    return refuse(
      SECTION_89_FORM_10E_NOT_FURNISHED,
      'The employee has not furnished Form 10E for this year. Section ' +
        '192(2A) lets the employer compute relief under section 89 only on ' +
        'the particulars furnished in that form, so no relief has been given ' +
        'and the whole of the bunched amount has been taxed in this year. ' +
        'This does not take the relief away: the employee claims it on ' +
        'assessment by filing Form 10E themselves. Furnish the form and ' +
        'recompute the settlement to have it allowed here instead.',
      {
        input,
        gratuity: gratuityWorking,
        relievableArrears: relievableArrears.toFixed(2),
      },
    );
  }

  if (!Number.isInteger(yearsEarnedOver) || yearsEarnedOver < 1) {
    return refuse(
      SECTION_89_YEARS_UNKNOWN,
      'The number of years this amount was earned over is not known, so it ' +
        'cannot be spread back and no relief under section 89 has been given. ' +
        'The employee may still claim it on Form 10E.',
      {
        input,
        gratuity: gratuityWorking,
        relievableArrears: relievableArrears.toFixed(2),
      },
    );
  }

  if (spreadYears.length < yearsEarnedOver) {
    return refuse(
      SECTION_89_YEARS_UNKNOWN,
      `The amount was earned over ${yearsEarnedOver} years but only ` +
        `${spreadYears.length} of them could be identified, so it cannot be ` +
        'spread back and no relief under section 89 has been given. The ' +
        'employee may still claim it on Form 10E.',
      {
        input,
        gratuity: gratuityWorking,
        relievableArrears: relievableArrears.toFixed(2),
      },
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
      {
        input,
        yearsWithoutConfiguration: missing,
        gratuity: gratuityWorking,
        relievableArrears: relievableArrears.toFixed(2),
      },
    );
  }

  // Safe past the guard above: every config in play is non-null.
  const receiptConfig = receiptYear.config as IncomeTaxConfigInput;

  // The income the year of receipt is compared against: everything, less only
  // the part actually being spread back. Derived rather than taken from
  // `totalIncomeWithoutArrears`, which is net of the gratuity too — and the
  // gratuity is not being relieved, so taking it out here would compare the
  // year against an income it never had.
  const incomeWithoutRelievable = money(
    input.totalIncomeWithArrears.sub(relievableArrears),
  );

  const taxWithArrears = calculateIncomeTax(
    input.totalIncomeWithArrears,
    receiptConfig,
    input.declaration,
    input.professionalTaxPaid,
  ).totalTax;
  const taxWithoutArrears = calculateIncomeTax(
    incomeWithoutRelievable,
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
        assumedYearlyIncome: incomeWithoutRelievable.toFixed(2),
        arrears: arrears.toFixed(2),
        relievableArrears: relievableArrears.toFixed(2),
        gratuity: gratuityWorking,
        form10EFurnished: input.form10EFurnished,
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
  const base = incomeWithoutRelievable;
  const slices = sliceArrears(relievableArrears, yearsEarnedOver);

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
      relievableArrears: relievableArrears.toFixed(2),
      gratuity: gratuityWorking,
      form10EFurnished: input.form10EFurnished,
      yearsEarnedOver,
      years: yearWorking,
      costOfBunching: money(costOfBunching).toFixed(2),
      taxIfSpread: money(taxIfSpread).toFixed(2),
      reliefBeforeFloor: reliefBeforeFloor.toFixed(2),
      yearsWithoutConfiguration: [],
      note:
        (relief.gt(0)
          ? `Bunching ${relievableArrears.toFixed(2)} of leave encashment ` +
            `earned over ${yearsEarnedOver} years into one year cost ` +
            `${money(costOfBunching).toFixed(2)} in tax, against ` +
            `${money(taxIfSpread).toFixed(2)} had it been received across ` +
            'those years; the difference is relieved under section 89. ' +
            `${ASSUMPTION_NOTE}`
          : 'Spreading the bunched amount back over the years it was earned ' +
            'was no cheaper than taxing it all at once, so no relief under ' +
            'section 89 arises. Relief cannot be negative, so it is nil ' +
            `rather than ${reliefBeforeFloor.toFixed(2)}. ${ASSUMPTION_NOTE}`) +
        // The gratuity's own outcome belongs beside the figure, not only in
        // its own block: a leaver reading why the relief is what it is needs
        // to see what was left out of it.
        (gratuityWorking.reason ? ` ${gratuityWorking.note}` : ''),
    },
  };
}
