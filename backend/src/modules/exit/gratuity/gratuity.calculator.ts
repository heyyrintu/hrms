import { Decimal } from '@prisma/client/runtime/library';
import type {
  GratuityConfig,
  GratuityInput,
  GratuityResult,
} from './gratuity.types';

/**
 * Pure calculation of gratuity under the Payment of Gratuity Act, 1972, and of
 * the exemption available on it under section 10(10) of the Income-tax Act.
 *
 * Like the statutory payroll calculators, everything here is a function of its
 * arguments: no database, no clock, no environment. The rates that the Act
 * fixes at 15 and 26 arrive as configuration because an employer is free to be
 * more generous than the Act, and the exemption ceiling has been raised several
 * times; the caller loads them from the tenant's configuration rows.
 *
 * Money is Decimal throughout and the payable amount is rounded to the nearest
 * rupee, half away from zero.
 *
 * NOT IMPLEMENTED, and material in several real cases:
 *
 *  - Coverage. Every employee reaching here is assumed to work in an
 *    establishment the Act covers. Section 1(3) covers factories, mines,
 *    oilfields, plantations, ports, railways, shops and establishments with ten
 *    or more employees, and the government may notify others. Employees outside
 *    that scope are not entitled under the Act at all, and their exemption is
 *    computed differently (half a month's average wages of the last ten months
 *    for each completed year, on a 30-day month, with the six-month rounding
 *    not applying). Nothing here detects or handles that case.
 *
 *  - Seasonal establishments. Section 4(2) gives them seven days' wages for
 *    each season worked rather than fifteen days for each year. Passing seven
 *    as `gratuityDaysPerYear` does not reproduce that rule, because the count
 *    here is of years rather than of seasons.
 *
 *  - Continuous service. The span from `joinDate` to `lastWorkingDate` is taken
 *    whole. Section 2A's arithmetic for interrupted service is not applied, so
 *    unpaid breaks, unauthorised absence, long leave without pay, strikes and
 *    lay-offs all count as served. Where an employee has such breaks, adjust
 *    the dates before calling, or the figure will be too high.
 *
 *  - Forfeiture. Section 4(6) permits gratuity to be forfeited, wholly or in
 *    part, where the termination was for wilful damage, riotous conduct or an
 *    offence involving moral turpitude. That is a decision for the employer to
 *    record, not something inferable from dates, so it is not modelled;
 *    a forfeited case should not be sent here.
 *
 *  - The statutory ceiling on the amount payable. Section 4(3) caps the
 *    employer's liability under the Act (twenty lakh at the time of writing).
 *    Only the tax exemption is capped here, because an employer may lawfully
 *    pay more than the Act requires, and this calculator does not know whether
 *    a given figure is a statutory entitlement or a contractual one.
 *
 *  - Interest under section 8 on gratuity paid late.
 *
 *  - The lifetime nature of the exemption ceiling. Section 10(10) caps the
 *    exemption across an employee's whole working life, so gratuity exempted by
 *    a previous employer eats into the ceiling available here. This calculator
 *    sees one employment and applies the full cap to it.
 *
 * This implements the common case. It is not a substitute for review by a
 * qualified payroll professional.
 */

/** Round to the nearest rupee, half away from zero. */
function toRupees(value: Decimal): Decimal {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

const ZERO = new Decimal(0);

/** The figures section 4(2) fixes, used for the section 10(10) exemption. */
const STATUTORY_DAYS_PER_YEAR = new Decimal(15);
const STATUTORY_MONTH_DAYS = new Decimal(26);

interface ServiceSpan {
  /** Whole calendar years served. */
  years: number;
  /** Whole calendar months beyond those years. */
  months: number;
  /** Whole days beyond those months. */
  days: number;
  /** Completed months in total, for the unrounded figure shown to the leaver. */
  totalMonths: number;
}

const NO_SERVICE: ServiceSpan = { years: 0, months: 0, days: 0, totalMonths: 0 };

/**
 * The calendar span from joining to leaving, inclusive of both days.
 *
 * The last working day is a day served, so someone who joins on 1 April 2019
 * and last works on 31 March 2024 has completed five years, not four years
 * eleven months and thirty days. That is arranged by measuring to the day after
 * the last working day.
 *
 * Dates are read in UTC. Prisma hands back date-only columns as UTC midnight,
 * and reading them in the server's local zone would move a leaver who left on
 * the first of a month back into the previous one.
 */
function measureService(joinDate: Date, lastWorkingDate: Date): ServiceSpan {
  const startY = joinDate.getUTCFullYear();
  const startM = joinDate.getUTCMonth();
  const startD = joinDate.getUTCDate();

  // The exclusive end of the period: the day after the last day served.
  const end = new Date(
    Date.UTC(
      lastWorkingDate.getUTCFullYear(),
      lastWorkingDate.getUTCMonth(),
      lastWorkingDate.getUTCDate() + 1,
    ),
  );
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();
  const endD = end.getUTCDate();

  let totalMonths = (endY - startY) * 12 + (endM - startM);
  let days = endD - startD;

  if (days < 0) {
    // The day of the month has not come round yet, so the last month is not
    // complete. Borrow the length of the month that precedes the end.
    totalMonths -= 1;
    days += new Date(Date.UTC(endY, endM, 0)).getUTCDate();
  }

  if (totalMonths < 0 || (totalMonths === 0 && days <= 0)) {
    return { ...NO_SERVICE };
  }

  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
    days,
    totalMonths,
  };
}

/** "4 years and 11 months", for the reason shown to whoever reads the refusal. */
function describeService(span: ServiceSpan): string {
  const years = `${span.years} ${span.years === 1 ? 'year' : 'years'}`;
  const months = `${span.months} ${span.months === 1 ? 'month' : 'months'}`;
  return `${years} and ${months}`;
}

/**
 * Years counted for the formula.
 *
 * Section 4(2): a part-year "in excess of six months" is treated as a full
 * year, and anything up to and including six months is dropped. Five years and
 * seven months counts as six; five years and six months counts as five; five
 * years, six months and a day counts as six.
 */
function countYears(span: ServiceSpan): number {
  const roundsUp = span.months > 6 || (span.months === 6 && span.days > 0);
  return span.years + (roundsUp ? 1 : 0);
}

function refuse(
  reason: string,
  serviceYears: Decimal = ZERO,
): GratuityResult {
  return {
    eligible: false,
    ineligibleReason: reason,
    serviceYears,
    countedYears: ZERO,
    amount: ZERO,
    exemptAmount: ZERO,
    taxableAmount: ZERO,
  };
}

/**
 * Gratuity payable on exit, and how much of it escapes tax.
 *
 * Ineligibility is a result, never an exception: a leaver who does not qualify
 * gets `eligible: false`, a reason fit to show a human, and zero amounts, so
 * that a settlement can be assembled without branching on thrown errors.
 */
export function calculateGratuity(
  input: GratuityInput,
  config: GratuityConfig,
): GratuityResult {
  if (!config.gratuityEnabled) {
    return refuse('Gratuity is not enabled for this establishment.');
  }

  const span = measureService(input.joinDate, input.lastWorkingDate);
  if (span.totalMonths === 0 && span.days === 0) {
    return refuse(
      'The last working date is not on or after the join date, so no service is recorded.',
    );
  }

  // Completed months expressed in years. Residual days are not carried into
  // this figure; they matter only to the six-month test in countYears.
  const serviceYears = new Decimal(span.totalMonths)
    .div(12)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

  if (input.lastDrawnWages.lte(0)) {
    return refuse(
      'No last drawn wages (basic plus dearness allowance) are recorded.',
      serviceYears,
    );
  }

  // The qualifying period is tested on completed years, not on the rounded
  // count: four years and eleven months is four completed years and does not
  // qualify, however close the rounding makes it look.
  const waived = input.waiveMinimumService === true;
  if (!waived && new Decimal(span.years).lt(config.gratuityMinYears)) {
    return refuse(
      `Service of ${describeService(span)} is short of the ` +
        `${config.gratuityMinYears.toString()} completed years required. ` +
        'The qualifying period is waived only on death or permanent disablement.',
      serviceYears,
    );
  }

  const countedYears = new Decimal(countYears(span));
  if (countedYears.lte(0)) {
    return refuse(
      `Service of ${describeService(span)} does not amount to a single countable year.`,
      serviceYears,
    );
  }

  // Last drawn wages x days per year / days treated as a month x counted years.
  // With the statutory figures that is the familiar 15/26.
  const amount = toRupees(
    input.lastDrawnWages
      .mul(config.gratuityDaysPerYear)
      .div(config.gratuityMonthDays)
      .mul(countedYears),
  );

  // Section 10(10) exempts the least of three figures: what was actually paid,
  // the lifetime ceiling, and what the statutory 15/26 formula would have given
  // on the same wages and service. The third matters when the employer is more
  // generous than the Act: the extra is paid, but it is taxable.
  const statutoryFormulaAmount = toRupees(
    input.lastDrawnWages
      .mul(STATUTORY_DAYS_PER_YEAR)
      .div(STATUTORY_MONTH_DAYS)
      .mul(countedYears),
  );

  const exemptAmount = Decimal.min(
    amount,
    config.gratuityExemptionCap,
    statutoryFormulaAmount,
  );

  return {
    eligible: true,
    ineligibleReason: null,
    serviceYears,
    countedYears,
    amount,
    exemptAmount,
    // Whatever the exemption does not cover is taxable as salary.
    taxableAmount: Decimal.max(amount.sub(exemptAmount), ZERO),
  };
}
