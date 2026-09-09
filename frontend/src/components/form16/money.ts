/**
 * Money formatting for Form 16 Part B.
 *
 * Every rupee figure arrives from the API as a decimal string, because the
 * backend holds it as a Prisma `Decimal`. A figure that has been through a
 * JavaScript float is no longer the figure that was computed, so nothing here
 * parses one. `Intl.NumberFormat` accepts the decimal string directly and
 * formats it without going near a float.
 */

/**
 * `Intl.NumberFormat.format` takes a numeric string at runtime (ECMA-402
 * NumberFormat v3), but the ambient TypeScript signature only admits
 * `number | bigint | StringNumericLiteral`. Narrowing the formatter to the
 * one call we make keeps the string path honest instead of parsing it.
 */
type DecimalStringFormatter = { format(value: string): string };

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}) as unknown as DecimalStringFormatter;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Formats a decimal string as Indian rupees. Nulls render as an em dash. */
export function formatINR(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const trimmed = value.trim();
  if (trimmed === '') return '—';
  // Anything that is not a plain decimal is shown as it arrived rather than
  // silently turned into zero.
  if (!DECIMAL_STRING.test(trimmed)) return trimmed;
  return inrFormatter.format(trimmed);
}

/**
 * True when the figure is genuinely below zero — income from house property is
 * negative whenever home loan interest is claimed, and must read as negative.
 */
export function isNegativeAmount(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.startsWith('-') && /[1-9]/.test(trimmed);
}

/** True when the figure is zero, so a nil line can be shown quietly. */
export function isZeroAmount(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim();
  return DECIMAL_STRING.test(trimmed) && !/[1-9]/.test(trimmed);
}
