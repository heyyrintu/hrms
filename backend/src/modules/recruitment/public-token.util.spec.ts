import { createHash } from 'crypto';
import {
  generatePublicToken,
  hashPublicToken,
  isWellFormedPublicToken,
} from './public-token.util';

describe('public-token.util', () => {
  it('generates 32 random bytes as 64 hex characters', () => {
    const { raw } = generatePublicToken();
    expect(raw).toMatch(/^[a-f0-9]{64}$/);
  });

  it('stores only the SHA-256 of the raw token', () => {
    const { raw, hash } = generatePublicToken();
    expect(hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hash).not.toBe(raw);
    expect(hashPublicToken(raw)).toBe(hash);
  });

  it('does not repeat tokens', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePublicToken().raw));
    expect(seen.size).toBe(50);
  });

  it('accepts only well-formed tokens', () => {
    expect(isWellFormedPublicToken(generatePublicToken().raw)).toBe(true);
    expect(isWellFormedPublicToken('abc')).toBe(false);
    expect(isWellFormedPublicToken('Z'.repeat(64))).toBe(false);
    expect(isWellFormedPublicToken('A'.repeat(64))).toBe(false);
    expect(isWellFormedPublicToken(undefined)).toBe(false);
    expect(isWellFormedPublicToken(`${'a'.repeat(64)}' OR 1=1`)).toBe(false);
  });
});
