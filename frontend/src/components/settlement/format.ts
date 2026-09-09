/**
 * Display helpers for settlement figures.
 *
 * Money arrives from the API as a decimal string: the backend holds it as a
 * Prisma `Decimal`, and a rupee figure that has been through a JavaScript float
 * is no longer the figure that was computed. `Intl.NumberFormat` formats a
 * numeric *string* exactly, so nothing here parses one into a `number`.
 */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
});

/**
 * `Intl.NumberFormat` (V3) formats a numeric *string* exactly, without turning
 * it into a float first. TypeScript only types that overload for string
 * literals, so the runtime capability is reached through this alias.
 */
const formatExact = inr.format as unknown as (value: string) => string;

/** Format a decimal string as rupees, without going through a float. */
export function formatMoney(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (raw === '') return formatExact('0');
  try {
    return formatExact(raw);
  } catch {
    // An unparseable figure is shown as it arrived rather than as a wrong number.
    return raw;
  }
}

/** Day counts are credited in halves; show them as the server sent them. */
export function formatDays(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  return String(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The number a `number`-typed update payload should carry for a field the user
 * left as a decimal string. The payload DTO validates numbers, so this
 * conversion happens only on the way out, never on a figure we display.
 */
export function toPayloadNumber(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
