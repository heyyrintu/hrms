import { SalaryComponent, SalaryBreakdown } from '@/types';

/**
 * Calculates salary breakdown from base pay and components
 * @param basePay - Monthly base pay amount
 * @param components - Array of salary components from structure
 * @returns Breakdown with earnings, deductions, gross, net
 */
export function calculateSalaryBreakdown(
  basePay: number,
  components: SalaryComponent[]
): SalaryBreakdown {
  const earnings: Array<{ name: string; amount: number }> = [
    { name: 'Base Pay', amount: basePay },
  ];

  const deductions: Array<{ name: string; amount: number }> = [];

  components.forEach((comp) => {
    const amount =
      comp.calcType === 'fixed'
        ? comp.value
        : Math.round((basePay * comp.value) / 100);

    if (comp.type === 'earning') {
      earnings.push({ name: comp.name, amount });
    } else {
      deductions.push({ name: comp.name, amount });
    }
  });

  const grossPay = earnings.reduce((sum, e) => sum + e.amount, 0);
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  const netPay = grossPay - totalDeductions;

  return { basePay, earnings, deductions, grossPay, totalDeductions, netPay };
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/**
 * `Intl.NumberFormat` (V3) formats a numeric *string* exactly, without turning
 * it into a float first. TypeScript only types that overload for string
 * literals, so the runtime capability is reached through this alias.
 */
const formatExact = inr.format as unknown as (value: string | number) => string;

/** A plain decimal, which is the only string the formatter can be trusted with. */
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Formats a rupee figure for display.
 *
 * Payroll money arrives from the API as a decimal string, because the backend
 * holds those columns as Prisma `Decimal`. The string is handed to
 * `Intl.NumberFormat` as it arrived: a rupee figure that has been through a
 * JavaScript float is no longer the figure that was computed.
 *
 * @param amount - A decimal string from the API, or a number computed in the browser
 * @returns Formatted currency string (e.g., "₹1,00,000")
 */
export function formatCurrency(amount: string | number): string {
  return formatExact(amount);
}

/**
 * Whether a figure is greater than zero.
 *
 * A decimal string is read as digits, so nothing is parsed into a float to
 * answer what is only a question about sign. `"0.00"`, `"0"` and `"-0.00"`
 * are all zero; anything with a non-zero digit and no leading `-` is positive.
 */
export function isPositiveMoney(value: string | number): boolean {
  const raw = String(value).trim();
  if (raw.startsWith('-')) return false;
  return /[1-9]/.test(raw);
}

/**
 * Adds decimal strings exactly, returning a decimal string.
 *
 * Money must not be summed with `+` after `Number()`. Three plausible monthly
 * run totals -- 448631.64, 6898878.10 and 600648.76 -- come to 7948158.50
 * exactly, but 7948158.499999999 as floats, which displays as a rupee less
 * than was actually paid out. Working in whole paise with `BigInt` avoids it.
 *
 * @param values - Decimal strings from the API, or numbers computed in the browser
 * @returns The exact total, as a decimal string
 * @throws If a value is not a plain decimal. Treating it as zero would quietly
 *   understate a figure somebody is paid from; a loud failure is the lesser evil.
 */
export function sumMoney(values: Array<string | number>): string {
  const figures = values.map((value) => {
    const raw = String(value).trim();
    if (!DECIMAL_STRING.test(raw)) {
      throw new Error(`sumMoney: "${raw}" is not a decimal figure`);
    }
    return raw;
  });

  // Paise for money, but a wider column (or a number) may carry more places,
  // and dropping them here would be the silent rounding this exists to avoid.
  const scale = Math.max(2, ...figures.map((raw) => (raw.split('.')[1] ?? '').length));

  // `BigInt(0)` rather than `0n`: the build targets ES2017, which has the
  // runtime but rejects the literal syntax.
  const zero = BigInt(0);
  const total = figures.reduce((sum, raw) => {
    const negative = raw.startsWith('-');
    const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
    const units = BigInt(whole + fraction.padEnd(scale, '0'));
    return negative ? sum - units : sum + units;
  }, zero);

  const digits = (total < zero ? zero - total : total).toString().padStart(scale + 1, '0');
  const sign = total < zero ? '-' : '';
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * Formats a date string in Indian locale
 * @param dateStr - ISO date string
 * @returns Formatted date (e.g., "15 Jan, 2026")
 */
export function formatSalaryDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Calculates annual CTC from monthly breakdown
 * @param breakdown - Monthly salary breakdown
 * @returns Annual CTC
 */
export function calculateAnnualCTC(breakdown: SalaryBreakdown): number {
  return breakdown.grossPay * 12;
}
