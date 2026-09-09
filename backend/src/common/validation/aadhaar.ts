import { BadRequestException } from '@nestjs/common';

/** An Aadhaar number is exactly 12 digits; spaces are allowed as grouping. */
export const AADHAAR_PATTERN = /^\d{12}$/;

/**
 * Reject anything that is not a plain 12-digit Aadhaar number.
 *
 * The important case is the masked display form ("XXXX XXXX 1234"): read paths
 * only ever return the mask, so a client that prefills an edit form from a
 * profile response and posts it back would otherwise encrypt the mask over the
 * real number and destroy it irrecoverably.
 */
export function assertValidAadhaar(value: string): string {
  const normalised = value.replace(/\s+/g, '');
  if (!AADHAAR_PATTERN.test(normalised)) {
    throw new BadRequestException(
      'Aadhaar number must be exactly 12 digits. Masked values such as "XXXX XXXX 1234" are not accepted.',
    );
  }
  return normalised;
}
