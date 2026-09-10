/**
 * Leave day arithmetic.
 *
 * `LeaveBalance` holds its day counts as Prisma `Decimal(5, 2)`, which
 * serializes to a decimal string, and neither `getBalances` nor
 * `getAllBalances` converts them on the way out. Adding two of those with `+`
 * concatenates rather than adds -- "12.00" + "3.00" is "12.003.00" -- and the
 * subtraction that follows then yields `NaN`, so a page computing an available
 * balance in the obvious way offers an employee NaN days of leave.
 *
 * Everything here works on the digits of the string. Nothing is parsed into a
 * float, for the same reason money is not: a half day is a real entitlement.
 *
 * TODO once #7 lands: `sumMoney` in `salaryCalculations.ts` is the same exact
 * decimal addition under a money-shaped name. Both should be reimplemented on
 * one shared primitive. They are kept separate here so this PR, #7 and #8 stay
 * independently mergeable.
 */

/** A plain decimal. Anything else cannot be added and is not guessed at. */
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

const SCALE = 2;

function toHundredths(value: string | number | null | undefined): bigint {
  const raw = String(value ?? '').trim();
  if (raw === '' || !DECIMAL_STRING.test(raw)) return BigInt(0);
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  // Truncating below hundredths rather than rounding: a Decimal(5, 2) column
  // never carries more, so anything extra came from somewhere unreliable.
  const units = BigInt(whole + fraction.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -units : units;
}

function fromHundredths(total: bigint): string {
  const zero = BigInt(0);
  const digits = (total < zero ? -total : total).toString().padStart(SCALE + 1, '0');
  const sign = total < zero ? '-' : '';
  return `${sign}${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`;
}

/** The day counts an available balance is worked out from. */
export interface LeaveBalanceDays {
  totalDays: string | number;
  carriedOver?: string | number | null;
  usedDays?: string | number | null;
  pendingDays?: string | number | null;
}

/**
 * Days still available: granted plus carried over, less taken and less
 * awaiting approval. Returned as a decimal string, so it can be added to
 * another without going through a float.
 *
 * A negative result is returned as it falls out. An employee who has been
 * allowed to overdraw should be shown that, not a floor of zero.
 */
export function availableDays(balance: LeaveBalanceDays): string {
  return fromHundredths(
    toHundredths(balance.totalDays) +
      toHundredths(balance.carriedOver) -
      toHundredths(balance.usedDays) -
      toHundredths(balance.pendingDays),
  );
}

/** Granted plus carried over: the figure an available balance is measured against. */
export function entitledDays(balance: LeaveBalanceDays): string {
  return fromHundredths(toHundredths(balance.totalDays) + toHundredths(balance.carriedOver));
}

/**
 * A day count for display, without its trailing zeros: "11.50" reads as 11.5
 * and "12.00" as 12. A figure that is not a plain decimal is shown as it
 * arrived rather than as "NaN".
 */
export function formatDays(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (raw === '') return '0';
  if (!DECIMAL_STRING.test(raw)) return raw;
  if (!raw.includes('.')) return raw;
  const trimmed = raw.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' || trimmed === '-0' ? '0' : trimmed;
}

/** Whether a day count is greater than zero, without parsing it into a float. */
export function hasDays(value: string | number | null | undefined): boolean {
  const raw = String(value ?? '').trim();
  if (raw.startsWith('-')) return false;
  return /[1-9]/.test(raw);
}
