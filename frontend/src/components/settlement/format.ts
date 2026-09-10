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

/**
 * A plain decimal, which is the only thing the formatter can be trusted with.
 *
 * `Intl.NumberFormat.format` turns anything else into `NaN` rather than
 * throwing, so a try/catch around it never fires and the reader gets "₹NaN".
 */
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Format a decimal string as rupees, without going through a float. */
export function formatMoney(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (raw === '') return formatExact('0');
  // An unreadable figure is shown as it arrived. That at least says what the
  // server sent, where "₹NaN" says nothing and reads as a broken page.
  if (!DECIMAL_STRING.test(raw)) return raw;
  return formatExact(raw);
}

/** Day counts are credited in halves; show them as the server sent them. */
export function formatDays(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  return String(value);
}

/**
 * A date is rendered in Indian time.
 *
 * The API sends a last working date as midnight UTC. Formatted in a zone behind
 * UTC that renders as the day before, and a last working date off by one is not
 * a cosmetic error on a document that decides what somebody is paid.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * The number a `number`-typed update payload should carry for a field the user
 * typed as a decimal string, or `null` when the field cannot be sent.
 *
 * `null` means the entry cannot be read and must not be sent. Returning `0`
 * instead would write a wrong figure to a settlement somebody is about to be
 * paid from, and a typo in the TDS box would look like a saved zero rather
 * than a rejected entry. Negatives are refused here too, since the DTO refuses
 * them anyway and a message at the field beats one from the server.
 */
export function toPayloadNumber(value: string): number | null {
  const trimmed = value.trim();
  // An empty box means nothing under this head, and the form is prefilled, so a
  // cleared field is a deliberate zero rather than "leave it as it was".
  if (trimmed === '') return 0;
  // `Number` rather than the display pattern, because the field is a number
  // input and a browser will hand back forms the pattern does not cover, such
  // as "1e5". What must never pass is NaN or a negative.
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}
