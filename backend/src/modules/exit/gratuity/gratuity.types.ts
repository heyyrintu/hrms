import { Decimal } from '@prisma/client/runtime/library';

/**
 * Shared contract for the gratuity calculation.
 *
 * Declared separately from the implementation so the settlement service can be
 * written against it without waiting on the calculator, and so both sides move
 * together if the shape changes.
 */

export interface GratuityConfig {
  gratuityEnabled: boolean;
  /** Days of wages per completed year. The Act says 15. */
  gratuityDaysPerYear: Decimal;
  /** Days treated as a month's wages. The Act says 26 for covered establishments. */
  gratuityMonthDays: Decimal;
  /** Completed years of service before any gratuity is payable. */
  gratuityMinYears: Decimal;
  /** Lifetime exemption ceiling under section 10(10). */
  gratuityExemptionCap: Decimal;
}

export interface GratuityInput {
  /** Last drawn basic plus dearness allowance, per month. */
  lastDrawnWages: Decimal;
  joinDate: Date;
  lastWorkingDate: Date;
  /**
   * Death and permanent disablement waive the five-year qualifying period.
   * Everything else, including resignation and dismissal, does not.
   */
  waiveMinimumService?: boolean;
}

export interface GratuityResult {
  eligible: boolean;
  /** Why it is not payable, when it is not. Null when it is. */
  ineligibleReason: string | null;
  /** Calendar years of service, unrounded, for the working shown to the leaver. */
  serviceYears: Decimal;
  /**
   * Years counted for the formula. A part-year over six months rounds up to a
   * full year; six months or less is dropped.
   */
  countedYears: Decimal;
  /** The amount payable. */
  amount: Decimal;
  /** The part exempt from tax under section 10(10). */
  exemptAmount: Decimal;
  /** The balance, which is taxable as salary. */
  taxableAmount: Decimal;
}
