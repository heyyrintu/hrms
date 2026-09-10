import { Decimal } from '@prisma/client/runtime/library';
import { TaxAgeBand } from '@prisma/client';

/**
 * Shared contract for the tax-correctness work.
 *
 * Declared separately from the calculators and the service so both can be
 * written against it at once, and so the two move together if a shape changes.
 * Nothing here computes tax; it fixes the vocabulary.
 */

// ---------------------------------------------------------------------------
// Age
// ---------------------------------------------------------------------------

/**
 * The band an individual falls in for the old regime's basic exemption.
 *
 * Age is taken **as at 31 March**, the last day of the financial year. Somebody
 * who turns 60 in February is a senior citizen for that whole year, and reading
 * their age on the payroll date instead would under-exempt them for eleven
 * months and then jump.
 *
 * A missing date of birth returns GENERAL. That is the safe direction: it
 * withholds the higher exemption rather than granting one the employee may not
 * be entitled to, and the shortfall comes back on assessment.
 */
export function ageBandOn31March(
  dateOfBirth: Date | null | undefined,
  financialYear: number,
): TaxAgeBand {
  if (!dateOfBirth) return TaxAgeBand.GENERAL;

  // 31 March of the year the financial year closes in.
  const lastDay = new Date(Date.UTC(financialYear + 1, 2, 31));
  const age = completedYearsBetween(dateOfBirth, lastDay);

  if (age >= 80) return TaxAgeBand.SUPER_SENIOR;
  if (age >= 60) return TaxAgeBand.SENIOR;
  return TaxAgeBand.GENERAL;
}

/** Completed years, not rounded: a birthday one day away has not happened. */
export function completedYearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())) {
    years -= 1;
  }
  return years;
}

// ---------------------------------------------------------------------------
// Chapter VI-A ceilings
// ---------------------------------------------------------------------------

/**
 * The statutory maxima for the year and regime.
 *
 * These cap a figure whatever its provenance. A declared amount above the
 * ceiling does not reduce tax, and neither does an approved one: a reviewer
 * accepting evidence for ₹2,00,000 under section 80C has confirmed the
 * investment, not raised the limit.
 */
export interface DeductionLimits {
  section80C: Decimal;
  section80D: Decimal;
  section80CCD1B: Decimal;
}

// ---------------------------------------------------------------------------
// Surcharge and marginal relief
// ---------------------------------------------------------------------------

/**
 * Marginal relief on surcharge.
 *
 * Surcharge starts at a threshold, so crossing it by one rupee can add far more
 * tax than the rupee earned. The relief caps the extra tax-plus-surcharge at
 * the extra income above the threshold. Without it the liability just above a
 * threshold is overstated, which is the defect this closes.
 *
 * Relief is computed against the *nearest lower threshold that was crossed*,
 * comparing total tax at the actual income with total tax at that threshold
 * plus the income in between.
 */
export interface SurchargeResult {
  /** Surcharge after relief. */
  surcharge: Decimal;
  /** What surcharge would have been without relief, for the working. */
  surchargeBeforeRelief: Decimal;
  /** The reduction. Zero when no threshold was crossed or relief did not bite. */
  marginalRelief: Decimal;
  /** The threshold relief was measured against, or null when none applied. */
  reliefThreshold: Decimal | null;
}

// ---------------------------------------------------------------------------
// Professional tax collection months
// ---------------------------------------------------------------------------

/**
 * Whether professional tax is collected in this calendar month.
 *
 * An empty list means every month, which is what most states do and what the
 * calculation did before the column existed. Tamil Nadu and others collect
 * half-yearly, and deducting their half-yearly slab amount twelve times over
 * would take six times too much.
 */
export function collectsProfessionalTaxIn(
  month: number,
  ptMonths: number[] | null | undefined,
): boolean {
  if (!ptMonths || ptMonths.length === 0) return true;
  return ptMonths.includes(month);
}

// ---------------------------------------------------------------------------
// Section 10(10AA): leave encashment on exit
// ---------------------------------------------------------------------------

export interface EncashmentExemptionConfig {
  /** Lifetime ceiling for a non-government employee. */
  exemptionCap: Decimal;
  /** Days per completed year the section recognises. The Act says 30. */
  exemptDaysPerYear: Decimal;
  /** Months of average salary the exemption is capped at. The Act says 10. */
  exemptMonths: Decimal;
  /** Encashment paid by a government employer is exempt in full. */
  governmentEmployer: boolean;
}

export interface EncashmentExemptionInput {
  /** What is actually being paid for the unavailed leave. */
  amountPaid: Decimal;
  /** Average monthly salary, basic plus dearness allowance. */
  averageMonthlySalary: Decimal;
  /** Completed years of service. */
  completedYears: Decimal;
  /** Days of leave actually being encashed. */
  daysEncashed: Decimal;
  /**
   * Exemption already used at earlier employers. The cap is a lifetime one, so
   * an employee who has used part of it elsewhere gets only the balance.
   */
  exemptionAlreadyUsed: Decimal;
}

/**
 * The four limbs of the section, kept separate so the working can be shown.
 *
 * The exemption is the least of them, and an employee asking why they were
 * taxed on part of their encashment is owed the figure that bound.
 */
export interface EncashmentExemptionResult {
  exempt: Decimal;
  taxable: Decimal;
  /** Which limb produced the answer, for the explanation. */
  limitedBy:
    | 'AMOUNT_PAID'
    | 'STATUTORY_CAP'
    | 'AVERAGE_SALARY_MONTHS'
    | 'LEAVE_DAYS_PER_YEAR'
    | 'GOVERNMENT_EMPLOYER';
  limbs: {
    amountPaid: Decimal;
    statutoryCapRemaining: Decimal;
    averageSalaryMonths: Decimal;
    leaveDaysPerYear: Decimal;
  };
}
