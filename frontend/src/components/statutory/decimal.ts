/**
 * Decimal-string arithmetic and formatting for statutory rates and amounts.
 *
 * Rates and money arrive from the API as decimal strings, because the backend
 * holds them as Prisma `Decimal`. A rate that has been through a float is no
 * longer the rate that was stored, so nothing here parses a value into a
 * `number`: comparison, subtraction and formatting all work on the digits.
 *
 * The single conversion to `number` happens in the update payload, where the
 * DTO validates numbers, and it happens there only.
 */

/** A readable decimal: digits, optionally a single fractional part. */
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function isReadableDecimal(raw: string): boolean {
    return DECIMAL_PATTERN.test(raw.trim());
}

/** `'12.00'` becomes `'12'`; `'1500.50'` becomes `'1500.5'`. */
export function trimTrailingZeros(value: string): string {
    if (!value.includes('.')) return value;
    const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
    if (trimmed === '' || trimmed === '-') return '0';
    return trimmed;
}

function fractionLength(value: string): number {
    const dot = value.indexOf('.');
    return dot === -1 ? 0 : value.length - dot - 1;
}

/** `('8.33', 2)` becomes `'833'`. */
function scaleToInteger(value: string, decimals: number): string {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole, fraction = ''] = unsigned.split('.');
    const padded = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
    const digits = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
    return `${negative ? '-' : ''}${digits}`;
}

/** `('367', 2)` becomes `'3.67'`. */
function fromScaledInteger(digits: string, decimals: number): string {
    if (decimals === 0) return digits;
    const negative = digits.startsWith('-');
    const unsigned = (negative ? digits.slice(1) : digits).padStart(decimals + 1, '0');
    const whole = unsigned.slice(0, unsigned.length - decimals);
    const fraction = unsigned.slice(unsigned.length - decimals);
    return `${negative ? '-' : ''}${trimTrailingZeros(`${whole}.${fraction}`)}`;
}

/**
 * `a - b`, exactly. Both are scaled to integers and subtracted as `BigInt`, so
 * no intermediate value is ever a float.
 */
export function subtractDecimals(a: string, b: string): string {
    const decimals = Math.max(fractionLength(a), fractionLength(b));
    const difference =
        BigInt(scaleToInteger(a, decimals)) - BigInt(scaleToInteger(b, decimals));
    return fromScaledInteger(difference.toString(), decimals);
}

/** -1, 0 or 1, without going through a float. */
export function compareDecimals(a: string, b: string): number {
    const difference = subtractDecimals(a, b);
    if (difference.startsWith('-')) return -1;
    return trimTrailingZeros(difference) === '0' ? 0 : 1;
}

/** `'12.00'` becomes `'12%'`. */
export function formatPercent(value: string): string {
    if (!isReadableDecimal(value)) return value;
    return `${trimTrailingZeros(value.trim())}%`;
}

/** `'2000000.00'` becomes `'₹20,00,000'`, grouped the Indian way. */
export function formatMoney(value: string): string {
    if (!isReadableDecimal(value)) return value;
    const trimmed = trimTrailingZeros(value.trim());
    const negative = trimmed.startsWith('-');
    const unsigned = negative ? trimmed.slice(1) : trimmed;
    const [whole, fraction] = unsigned.split('.');

    const last3 = whole.length > 3 ? whole.slice(-3) : whole;
    const rest = whole.length > 3 ? whole.slice(0, -3) : '';
    const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;

    return `${negative ? '-' : ''}₹${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** What a rate or amount is measured in, which decides what is out of range. */
export type NumericKind = 'percent' | 'amount' | 'count';

/**
 * The message to show, or null when the entry is fine.
 *
 * The server validates too and would reject with a 400, but a message naming
 * the field beats a generic failure. Crucially, an unreadable entry is refused
 * rather than coerced: writing a rate nobody typed into payroll configuration
 * is the worst thing this page could do.
 */
export function validateNumeric(
    raw: string,
    label: string,
    kind: NumericKind,
): string | null {
    const value = raw.trim();

    if (value === '') {
        return `${label} is empty. Enter a figure — an empty box is not read as zero.`;
    }
    if (!isReadableDecimal(value)) {
        return `${label} is not a number. Enter a figure such as 12.5.`;
    }
    if (value.startsWith('-')) {
        return `${label} cannot be negative.`;
    }
    if (kind === 'percent' && compareDecimals(value, '100') > 0) {
        return `${label} must be a percentage between 0 and 100.`;
    }
    return null;
}

/** `2026` becomes `'FY 2026-27'`. */
export function financialYearLabel(year: number): string {
    const next = `${(year + 1) % 100}`.padStart(2, '0');
    return `FY ${year}-${next}`;
}
