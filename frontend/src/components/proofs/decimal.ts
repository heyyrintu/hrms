/**
 * Exact arithmetic on the rupee strings the API returns.
 *
 * A gap between what was declared and what was approved, or between what was
 * claimed and what was accepted, is itself a rupee figure someone will read and
 * act on. Computing it with `Number` would put two stored decimals through a
 * float and hand back a third figure that is nobody's. These helpers work on
 * scaled `BigInt` paise instead, so the difference of two exact figures is
 * exact, and anything that is not a plain decimal is refused rather than
 * guessed at.
 */

/** Paise: two decimal places, which is as fine as rupee amounts get here. */
const SCALE = 2;
const DECIMAL_STRING = /^(-?)(\d+)(?:\.(\d+))?$/;

/** `0n` as a literal needs a newer target than this project compiles to. */
const ZERO = BigInt(0);

/** The figure in paise, or null when the string is not a plain decimal. */
function toPaise(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const match = DECIMAL_STRING.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  // Padded then cut, so both "1.5" and "1.505" land on two places. Cutting
  // rather than rounding: a stored figure with more places than paise is not
  // something this page should be quietly adjusting.
  const paise = BigInt(whole + (fraction + '0'.repeat(SCALE)).slice(0, SCALE));
  return sign === '-' ? -paise : paise;
}

/** Back to the decimal string shape the formatter takes. */
function fromPaise(paise: bigint): string {
  const negative = paise < ZERO;
  const digits = (negative ? -paise : paise).toString().padStart(SCALE + 1, '0');
  const whole = digits.slice(0, digits.length - SCALE);
  const fraction = digits.slice(digits.length - SCALE);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * `minuend - subtrahend`, or null when either side is not a plain decimal.
 *
 * A null result means the difference is unknown, which callers must show as
 * unknown. It never means zero.
 */
export function subtractAmounts(
  minuend: string | null | undefined,
  subtrahend: string | null | undefined,
): string | null {
  const left = toPaise(minuend);
  const right = toPaise(subtrahend);
  if (left === null || right === null) return null;
  return fromPaise(left - right);
}

/** True when `left` is strictly greater than `right`. False if either is unreadable. */
export function isGreaterThan(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = toPaise(left);
  const b = toPaise(right);
  if (a === null || b === null) return false;
  return a > b;
}

/** True when the figure is a readable decimal above zero. */
export function isPositiveAmount(value: string | null | undefined): boolean {
  const paise = toPaise(value);
  return paise !== null && paise > ZERO;
}
