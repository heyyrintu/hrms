/**
 * What is checked before anything leaves the browser.
 *
 * The uploads endpoint applies the same limits and would refuse the same file,
 * but only after it has been sent. An employee with a 40MB scan of a rent
 * agreement should learn that in the moment they choose it, not after a minute
 * of waiting, so the size and the type are judged here first against the very
 * constants the endpoint uses.
 */

import { PROOF_ACCEPTED_MIME_TYPES, PROOF_MAX_FILE_BYTES } from '@/lib/api';
import { parseDeclaredAmount } from '@/components/declaration/parseAmount';

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** The label the amount field carries, so a refusal can name it. */
export const CLAIMED_AMOUNT_LABEL = 'Amount claimed';

const MEGABYTE = 1024 * 1024;

/** "10 MB", "1.5 MB", "412 KB" — enough for a person to compare two figures. */
export function describeBytes(bytes: number): string {
  if (bytes >= MEGABYTE) {
    const megabytes = bytes / MEGABYTE;
    // Whole megabytes read as whole megabytes; this is prose, not an amount of
    // money, so a rounded figure here misleads nobody.
    return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The size limit, for saying it out loud on the form as well as in a refusal. */
export const MAX_FILE_LABEL = describeBytes(PROOF_MAX_FILE_BYTES);

/** What the accepted types amount to in front of a person. */
export const ACCEPTED_FILE_LABEL = 'a PDF or an image';

/** The `accept` attribute, so the file picker offers the right things first. */
export const ACCEPTED_FILE_ATTRIBUTE = PROOF_ACCEPTED_MIME_TYPES.join(',');

/**
 * Judges the chosen file. Nothing is uploaded until this says so.
 */
export function checkProofFile(file: File | null | undefined): Checked<File> {
  if (!file) {
    return {
      ok: false,
      message: 'Choose the document that supports this claim. Nothing was uploaded.',
    };
  }

  const accepted = PROOF_ACCEPTED_MIME_TYPES as readonly string[];
  if (!accepted.includes(file.type)) {
    return {
      ok: false,
      message: `The document must be ${ACCEPTED_FILE_LABEL}. "${file.name}" is not one, so nothing was uploaded.`,
    };
  }

  if (file.size > PROOF_MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `The document must be ${MAX_FILE_LABEL} or smaller. "${file.name}" is ${describeBytes(file.size)}, so nothing was uploaded.`,
    };
  }

  return { ok: true, value: file };
}

/**
 * Reads the amount the employee says the document supports.
 *
 * `parseDeclaredAmount` already refuses a negative or unreadable entry by name
 * rather than turning it into zero, which is the behaviour wanted here too. The
 * two differences are at the ends: a blank field is not a nil claim, and a
 * document supporting nothing is not a claim either, so both are refused.
 */
export function checkClaimedAmount(raw: string): Checked<number> {
  if ((raw ?? '').trim() === '') {
    return {
      ok: false,
      message: `${CLAIMED_AMOUNT_LABEL} is needed before a document can be uploaded.`,
    };
  }

  const parsed = parseDeclaredAmount(raw, CLAIMED_AMOUNT_LABEL);
  if (!parsed.ok) return parsed;

  if (parsed.value <= 0) {
    return {
      ok: false,
      message: `${CLAIMED_AMOUNT_LABEL} must be more than nil. A document supporting nothing has nothing to review.`,
    };
  }

  return { ok: true, value: parsed.value };
}
