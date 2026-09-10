/**
 * Reading the server's refusal of an income tax ladder.
 *
 * A ladder is saved whole, and the server is the authority on whether it is
 * one: it refuses a gap, an overlap, a ladder that does not start at zero, and
 * more than one open-ended top band. Whatever it says names the band at
 * fault when the refusal is about one band in particular, and this is what
 * reads that name back out, so the message can sit against the offending row
 * instead of floating in a toast the reader has to match up by hand.
 *
 * The server names a band by the amount it starts at, not by a number: "the
 * band starting at 400000.00 ...". That is the more useful thing to say to a
 * person, so this maps the amount back to the row on screen rather than asking
 * the server to count for it.
 */

export interface ParsedLadderError {
  /** Zero-based index of the band the message names, or null when it names none. */
  bandIndex: number | null;
  /** The message itself, unchanged either way. */
  message: string;
}

/** "the band starting at 400000.00", and "its lowest band starts at 250000.00". */
const BAND_BY_LOWER_BOUND = /band\s+start(?:s|ing)\s+at\s+([\d.]+)/i;

/** A band the message could be about, in the order they sit on screen. */
export interface LadderBandRef {
  fromAmount: string;
}

export function parseLadderError(
  message: string,
  bands: LadderBandRef[] = [],
): ParsedLadderError {
  const match = message.match(BAND_BY_LOWER_BOUND);
  if (!match) return { bandIndex: null, message };

  // Compare numerically: the server writes 400000.00 where the row holds "400000".
  const named = Number(match[1]);
  if (!Number.isFinite(named)) return { bandIndex: null, message };

  const index = bands.findIndex((band) => Number(band.fromAmount) === named);
  // A band the message names but the ladder on screen does not hold is not one
  // this reader can point at, so the message stands on its own.
  return { bandIndex: index === -1 ? null : index, message };
}

/** The message from an Axios-style error, or a generic fallback. */
export function extractErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data
    ?.message;
  if (typeof message === 'string' && message.trim() !== '') return message;
  if (Array.isArray(message) && message.length > 0 && typeof message[0] === 'string') {
    return message[0];
  }
  return fallback;
}
