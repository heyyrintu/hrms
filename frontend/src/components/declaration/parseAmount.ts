/**
 * Reading a rupee figure a person typed.
 *
 * The point of this file is what it refuses. An entry that cannot be read is
 * not quietly turned into zero: zero is a figure nobody typed, and writing it
 * into the basis for someone's tax is worse than refusing the save and saying
 * which field is wrong. The same goes for a negative amount, which no
 * deduction, exemption or previous-employer TDS figure can be.
 *
 * A blank field is different. It is not unreadable, it says nothing is claimed,
 * so it is sent as zero — that is also how a figure already on record is
 * cleared.
 */

export type ParsedAmount =
  | { ok: true; value: number }
  | { ok: false; message: string };

/** Digits, with an optional decimal part. Grouping commas are stripped first. */
const PLAIN_AMOUNT = /^\d+(\.\d+)?$/;
const SIGNED_AMOUNT = /^-\d+(\.\d+)?$/;

/**
 * Parses one entry.
 *
 * `label` is the field's own label and appears verbatim in any refusal, so the
 * message names the field rather than leaving the person to hunt for it.
 */
export function parseDeclaredAmount(raw: string, label: string): ParsedAmount {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { ok: true, value: 0 };

  // People paste figures with rupee signs and grouping commas. Those are
  // notation, not ambiguity, so they are removed before the entry is judged.
  const cleaned = trimmed.replace(/[,\s₹]/g, '');

  if (SIGNED_AMOUNT.test(cleaned)) {
    return { ok: false, message: `${label} cannot be negative.` };
  }
  if (!PLAIN_AMOUNT.test(cleaned)) {
    return {
      ok: false,
      message: `${label} must be an amount in rupees. "${trimmed}" is not one, so nothing was sent.`,
    };
  }

  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      message: `${label} must be an amount in rupees. "${trimmed}" is not one, so nothing was sent.`,
    };
  }
  return { ok: true, value };
}

/**
 * The figure as a number when it is readable, for comparing against a ceiling.
 *
 * Only ever used to decide whether to show a warning. The figure that is
 * displayed comes from the stored string, and the figure that is sent comes
 * from `parseDeclaredAmount` at save time.
 */
export function readableAmount(raw: string): number | null {
  const parsed = parseDeclaredAmount(raw, 'Amount');
  return parsed.ok ? parsed.value : null;
}
