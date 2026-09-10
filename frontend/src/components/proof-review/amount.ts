/**
 * Checking an accepted amount without putting a rupee figure through a float.
 *
 * The claimed figure arrives as a decimal string, because the backend holds it
 * as a Prisma `Decimal`. Comparing it with what the reviewer typed by parsing
 * both to `number` would decide a rupee question on a binary approximation, so
 * the comparison here runs on the digits. The conversion to `number` happens
 * once, at the edge, where the payload demands one.
 */

import { formatINR } from '@/components/form16/money';

/** Digits, optionally a decimal point and up to two more digits. */
const RUPEES = /^\d+(\.\d{1,2})?$/;

/** Splits a plain non-negative decimal string into its two halves. */
function halves(value: string): { whole: string; fraction: string } {
  const [whole, fraction = ''] = value.split('.');
  return { whole: whole.replace(/^0+(?=\d)/, ''), fraction };
}

/**
 * Compares two plain non-negative decimal strings.
 *
 * Negative for a < b, zero for equal, positive for a > b. Both arguments must
 * already be plain decimals; anything else is the caller's mistake to catch.
 */
export function compareRupees(a: string, b: string): number {
  const left = halves(a.trim());
  const right = halves(b.trim());

  if (left.whole.length !== right.whole.length) {
    return left.whole.length - right.whole.length;
  }
  if (left.whole !== right.whole) return left.whole < right.whole ? -1 : 1;

  const width = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(width, '0');
  const rightFraction = right.fraction.padEnd(width, '0');
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

/**
 * What the reviewer typed, checked against the claim.
 *
 * The server refuses an amount above the claim, because accepting more than
 * was claimed means inventing a figure. Refusing it here as well means the
 * reviewer is told the limit rather than being told "no" after a round trip.
 */
export function checkAcceptedAmount(
  entered: string,
  claimedAmount: string,
): { error: string } | { value: string } {
  const trimmed = entered.trim();

  if (trimmed === '') {
    return { error: 'Enter the amount you are accepting.' };
  }
  if (!RUPEES.test(trimmed)) {
    return {
      error: 'Enter an amount in rupees: digits only, with at most two decimal places.',
    };
  }
  if (!RUPEES.test(claimedAmount.trim())) {
    // The claim itself is unreadable, so no limit can be checked against it.
    return { error: 'The claimed amount could not be read, so no decision can be recorded.' };
  }
  if (compareRupees(trimmed, claimedAmount) > 0) {
    return {
      error: `The accepted amount cannot be more than the claimed ${formatINR(claimedAmount)}. It may be lower.`,
    };
  }
  return { value: trimmed };
}

/**
 * The one place a rupee figure becomes a number, because the payload takes one.
 *
 * Called with a string already checked by `checkAcceptedAmount`, and never on
 * the display path.
 */
export function toPayloadAmount(checked: string): number {
  return Number(checked);
}

/** A rejection needs a reason; whitespace is not one. */
export function checkReviewNote(entered: string): { error: string } | { value: string } {
  const trimmed = entered.trim();
  if (trimmed === '') {
    return {
      error:
        'A rejection needs a reason. The employee is told why their evidence was refused, so an empty note is not enough.',
    };
  }
  return { value: trimmed };
}
