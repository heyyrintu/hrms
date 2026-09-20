import { Decimal } from '@prisma/client/runtime/library';

/**
 * Shared contract for the final tranche of statutory work.
 *
 * Declared separately from the calculators, the statutory service and the
 * settlement so all three can be written against it at once. Nothing here
 * computes tax; it fixes the vocabulary and the few rules that more than one
 * of them has to agree on.
 */

// ---------------------------------------------------------------------------
// Section 10(5): the leave travel block
// ---------------------------------------------------------------------------

/**
 * Leave travel concession runs in fixed blocks of four calendar years, not
 * financial ones, and the Act allows two journeys per block. The blocks are
 * statutory and absolute: 2018-2021, 2022-2025, 2026-2029, and so on.
 *
 * A financial year straddles two calendar years, so the block is decided by
 * the calendar year the travel falls in. Taking the financial year's opening
 * calendar year is the convention here, and it is stated rather than hidden
 * because a journey in, say, January 2026 belongs to the 2026 block while the
 * financial year opened in 2025.
 */
export const LTA_BLOCK_LENGTH_YEARS = 4;
export const LTA_BLOCK_ANCHOR_YEAR = 2018;
export const LTA_JOURNEYS_PER_BLOCK = 2;

/** The first calendar year of the block a given year falls in. */
export function ltaBlockStartYear(calendarYear: number): number {
  const offset = calendarYear - LTA_BLOCK_ANCHOR_YEAR;
  const blocksElapsed = Math.floor(offset / LTA_BLOCK_LENGTH_YEARS);
  return LTA_BLOCK_ANCHOR_YEAR + blocksElapsed * LTA_BLOCK_LENGTH_YEARS;
}

/** "2026-2029", for telling an employee which block they are in. */
export function ltaBlockLabel(calendarYear: number): string {
  const start = ltaBlockStartYear(calendarYear);
  return `${start}-${start + LTA_BLOCK_LENGTH_YEARS - 1}`;
}

/**
 * Whether a further leave travel journey may be exempted this year.
 *
 * The Act allows two in a block. An employee who has already used both gets
 * nothing more until the block turns over, however much they declare and
 * whatever the tickets show, because the limit is on journeys rather than on
 * money.
 */
export function ltaJourneysRemaining(journeysUsedInBlock: number): number {
  const used = Number.isFinite(journeysUsedInBlock) ? journeysUsedInBlock : 0;
  return Math.max(0, LTA_JOURNEYS_PER_BLOCK - Math.max(0, used));
}

// ---------------------------------------------------------------------------
// What the employer actually paid
// ---------------------------------------------------------------------------

/**
 * Section 10 exempts an *allowance received*. Where the employer pays no
 * leave travel, children's education or hostel allowance at all, there is
 * nothing to exempt, however much the employee declares and whatever evidence
 * they file: the exemption reduces a receipt, it does not create one.
 *
 * These are the amounts actually paid through payroll for the year, summed
 * from salary components marked with the matching head. A head absent from the
 * map means the employer pays no such allowance.
 */
export interface Section10AllowancesPaid {
  lta?: Decimal;
  childrenEducation?: Decimal;
  hostel?: Decimal;
}

/**
 * The value on a salary component that marks it as one of these allowances.
 *
 * Salary structures already carry `pfApplicable` the same way, so this follows
 * a convention the codebase has rather than inventing a second one.
 */
export type Section10ComponentHead = 'LTA' | 'CHILDREN_EDUCATION' | 'HOSTEL_ALLOWANCE';

// ---------------------------------------------------------------------------
// Section 89 relief on a settlement
// ---------------------------------------------------------------------------

/**
 * Relief where a payment bunches several years into one.
 *
 * A settlement pays gratuity and leave encashment earned over many years in a
 * single year, which can push a leaver into a band they never belonged in.
 * Section 89 read with rule 21A relieves the difference: the tax on the
 * arrears spread back over the years they were earned, against the tax on
 * receiving them all at once.
 *
 * The relief is the second minus the first, and never negative — bunching can
 * only ever cost the taxpayer, so relief that came out negative would mean the
 * calculation, not the taxpayer, was wrong.
 */
export interface Section89Input {
  /** Total income of the year of receipt, including the bunched amount. */
  totalIncomeWithArrears: Decimal;
  /** The same year without it. */
  totalIncomeWithoutArrears: Decimal;
  /**
   * The relievable part of the bunched amount, and the years it was earned
   * over. Gratuity is deliberately not part of this; see `taxWithoutArrears`.
   */
  arrears: Decimal;
  yearsEarnedOver: number;
}

export interface Section89Result {
  relief: Decimal;
  /** Tax on the year of receipt including the relievable amount. */
  taxWithArrears: Decimal;
  /**
   * Tax on that year without the **relievable** amount.
   *
   * Not the same as the year without the whole bunched payment. Gratuity is
   * taxed in full but is excluded from the relief base, because rule 21A(3)
   * prescribes an average-rate method this module cannot compute without
   * earlier years' incomes. So a settlement's gratuity sits inside both of
   * these figures and cancels out, while the leave encashment does not.
   */
  taxWithoutArrears: Decimal;
  /** Tax on the arrears spread back, in total across those years. */
  taxIfSpread: Decimal;
  /**
   * Why relief was not given, when it was not. Null when it was.
   *
   * An employee whose relief is nil is owed the reason, and "the calculation
   * produced zero" is not one.
   */
  ineligibleReason: string | null;
}

/**
 * Tax on a settlement is capped at what is actually payable.
 *
 * A large tax against a small settlement would otherwise drive the net
 * negative. Notice recovery can already do that legitimately, because the
 * employer is owed the money either way. Tax cannot: the employer cannot
 * deduct from a payment that does not exist, and the balance is the leaver's
 * own liability to settle on assessment.
 */
export function capTaxAtPayable(tax: Decimal, payableBeforeTax: Decimal): {
  deducted: Decimal;
  uncollected: Decimal;
} {
  if (payableBeforeTax.lte(0)) {
    return { deducted: new Decimal(0), uncollected: tax };
  }
  if (tax.lte(payableBeforeTax)) {
    return { deducted: tax, uncollected: new Decimal(0) };
  }
  return { deducted: payableBeforeTax, uncollected: tax.minus(payableBeforeTax) };
}
