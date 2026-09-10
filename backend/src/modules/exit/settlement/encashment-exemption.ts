import { Decimal } from '@prisma/client/runtime/library';
import type {
  EncashmentExemptionConfig,
  EncashmentExemptionInput,
  EncashmentExemptionResult,
} from '../../payroll/statutory/tax-correctness.types';

/**
 * Pure calculation of the exemption available on leave encashment paid on
 * retirement or resignation, under section 10(10AA) of the Income-tax Act.
 *
 * Like the gratuity calculator, everything here is a function of its arguments:
 * no database, no clock, no environment. The figures the section fixes at 30
 * days and 10 months arrive as configuration, and so does the ceiling, because
 * the ceiling has been raised more than once — it stood at ₹3,00,000 for two
 * decades and became ₹25,00,000 with effect from FY 2023-24 — and a calculator
 * that hard-codes a figure the Board can revise by notification is a calculator
 * that will quietly be wrong one April.
 *
 * The section works by exempting the **least of four** amounts:
 *
 *   1. the amount actually received;
 *   2. the ceiling, less any exemption the employee has already had from an
 *      earlier employer, because the ceiling is a lifetime one;
 *   3. ten months' average salary;
 *   4. the cash equivalent of the leave standing to the employee's credit,
 *      counting no more than 30 days for each completed year of service,
 *      whatever the employer's own leave rules allow.
 *
 * Encashment paid by a government employer — Central or State — is exempt in
 * full and none of the four limbs applies.
 *
 * All four limbs are returned, along with which one bound. That is not
 * decoration: an employee taxed on part of their encashment is owed the figure
 * that limited it, and cannot check the arithmetic without seeing the others.
 *
 * Money is `Decimal` throughout and every limb is rounded to paise, half up,
 * matching the settlement this feeds.
 *
 * NOT IMPLEMENTED, and material in several real cases:
 *
 *  - **"Average salary" is taken as given.** Rule 2BB and the section read it
 *    as the average of the salary drawn in the ten months immediately preceding
 *    retirement — basic, dearness allowance to the extent it enters retirement
 *    benefits, and commission at a fixed percentage of turnover. The caller
 *    supplies one monthly figure. A settlement that passes last drawn basic
 *    plus DA will overstate the third and fourth limbs for anyone whose pay rose
 *    during those ten months, and understate them for anyone whose pay fell.
 *
 *  - **The exemption is denied altogether while in service.** Section 10(10AA)
 *    exempts encashment *on retirement*, whether on superannuation or
 *    otherwise. Leave encashed by a serving employee is fully taxable. Nothing
 *    here checks that the payment is on separation; the caller must only reach
 *    this for a leaver.
 *
 *  - **Death.** Encashment paid to the legal heirs of an employee who died in
 *    service is not taxable in their hands at all. That is a different rule from
 *    the one below and is not modelled.
 *
 *  - **Relief under section 89.** Where the exemption leaves a taxable balance
 *    that bunches several years' leave into one year's income, relief may be
 *    available on an application in Form 10E. That is not computed anywhere in
 *    this codebase.
 *
 *  - **`exemptionAlreadyUsed` is trusted.** There is no register of exemptions
 *    granted by previous employers; the figure is whatever the employee
 *    declared. A leaver who does not disclose an earlier exemption will be
 *    over-exempted here and will have to settle it on assessment.
 *
 * This implements the common case. It is not a substitute for review by a
 * qualified payroll professional.
 */

const ZERO = new Decimal(0);

/** Round to paise, half up, which is the convention the settlement uses. */
function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Negatives are never a meaningful limb; a bad input floors at nothing. */
function atLeastZero(value: Decimal): Decimal {
  return value.gt(ZERO) ? value : ZERO;
}

/**
 * How much of an encashment escapes tax, and which limb of the section decided.
 *
 * The result always satisfies `exempt === min(limbs)`, in the government case
 * as well: there the three limbs that bind only a non-government employee are
 * reported at the amount paid, since none of them applies. Reporting what they
 * would have been would leave a reader of the working asking why the exemption
 * exceeds a limit shown beside it.
 *
 * Where two limbs tie at the minimum, the one named is the first of
 * amount paid, ceiling, ten months, 30 days a year. Amount paid leads because a
 * tie with it means nothing is taxable, and "the whole encashment is exempt" is
 * a better answer than naming a limit the employee never reached.
 */
export function calculateEncashmentExemption(
  input: EncashmentExemptionInput,
  config: EncashmentExemptionConfig,
): EncashmentExemptionResult {
  const amountPaid = money(atLeastZero(input.amountPaid));

  // Government service: exempt in full, and no limb bites.
  if (config.governmentEmployer) {
    return {
      exempt: amountPaid,
      taxable: ZERO,
      limitedBy: 'GOVERNMENT_EMPLOYER',
      limbs: {
        amountPaid,
        statutoryCapRemaining: amountPaid,
        averageSalaryMonths: amountPaid,
        leaveDaysPerYear: amountPaid,
      },
    };
  }

  const averageMonthlySalary = atLeastZero(input.averageMonthlySalary);
  const completedYears = atLeastZero(input.completedYears);
  const daysEncashed = atLeastZero(input.daysEncashed);

  // Limb 2. The ceiling is a lifetime one, so what an earlier employer already
  // exempted is gone. Floored at zero: an employee who has used it up gets
  // nothing here, not a negative that would drag the minimum below zero.
  const statutoryCapRemaining = money(
    atLeastZero(config.exemptionCap.sub(atLeastZero(input.exemptionAlreadyUsed))),
  );

  // Limb 3. Ten months of average salary.
  const averageSalaryMonths = money(
    averageMonthlySalary.mul(atLeastZero(config.exemptMonths)),
  );

  // Limb 4. The cash equivalent of the leave at credit, counting at most
  // 30 days for each completed year however many days the employer credited,
  // and valuing them at average monthly salary for each 30 of them. The day
  // count and the divisor are the same figure because the section's "30 days"
  // is one month's leave for each year served; a tenant holding a different
  // figure gets that figure used consistently in both places.
  const exemptDaysPerYear = atLeastZero(config.exemptDaysPerYear);
  const permittedDays = exemptDaysPerYear.mul(completedYears);
  const qualifyingDays = Decimal.min(daysEncashed, permittedDays);
  const leaveDaysPerYear = exemptDaysPerYear.gt(ZERO)
    ? money(qualifyingDays.div(exemptDaysPerYear).mul(averageMonthlySalary))
    : ZERO;

  const limbs = {
    amountPaid,
    statutoryCapRemaining,
    averageSalaryMonths,
    leaveDaysPerYear,
  };

  // Least of the four. The order of this list is the tie-break order.
  const ordered: [EncashmentExemptionResult['limitedBy'], Decimal][] = [
    ['AMOUNT_PAID', limbs.amountPaid],
    ['STATUTORY_CAP', limbs.statutoryCapRemaining],
    ['AVERAGE_SALARY_MONTHS', limbs.averageSalaryMonths],
    ['LEAVE_DAYS_PER_YEAR', limbs.leaveDaysPerYear],
  ];

  let limitedBy = ordered[0][0];
  let exempt = ordered[0][1];
  for (const [name, value] of ordered.slice(1)) {
    if (value.lt(exempt)) {
      limitedBy = name;
      exempt = value;
    }
  }

  return {
    exempt,
    // Whatever the exemption does not cover is taxable as salary. It can never
    // be negative: the exemption is capped by the amount paid.
    taxable: money(atLeastZero(amountPaid.sub(exempt))),
    limitedBy,
    limbs,
  };
}
