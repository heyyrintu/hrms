import { createHash, randomBytes } from 'crypto';

/**
 * Tokens for the public offer and pre-onboarding links (Keka wave D).
 *
 * 32 random bytes as 64 hex characters. Only the SHA-256 hex of the token is
 * stored (`tokenHash` columns, unique), the same scheme as password reset
 * tokens: a leaked table cannot be replayed. The raw token exists only in the
 * email / the create response.
 */
export const PUBLIC_TOKEN_BYTES = 32;

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export interface PublicToken {
  /** Goes into the link. Never stored. */
  raw: string;
  /** Stored. */
  hash: string;
}

export function hashPublicToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generatePublicToken(): PublicToken {
  const raw = randomBytes(PUBLIC_TOKEN_BYTES).toString('hex');
  return { raw, hash: hashPublicToken(raw) };
}

/**
 * Cheap shape check before any query: anything that is not 64 lower-case hex
 * characters cannot be a token we issued, so callers answer 404 without
 * touching the database.
 */
export function isWellFormedPublicToken(raw: unknown): raw is string {
  return typeof raw === 'string' && TOKEN_PATTERN.test(raw);
}
