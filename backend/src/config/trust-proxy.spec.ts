import 'reflect-metadata';
import { parseTrustProxy } from './trust-proxy';
import { validate } from './env.validation';

describe('parseTrustProxy', () => {
  it('is off when unset, empty, false or 0', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('reads a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('reads true as trust-all', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('TRUE')).toBe(true);
  });

  it('passes an address / subnet / named-range list through to Express', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback,10.0.0.0/8');
    expect(parseTrustProxy('::1')).toBe('::1');
  });

  it('throws on anything else', () => {
    expect(() => parseTrustProxy('yes please')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('-1')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('10.0.0.0/8; rm')).toThrow(/TRUST_PROXY/);
  });
});

describe('env validation: TRUST_PROXY', () => {
  const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'x'.repeat(32) };

  it('is optional', () => {
    expect(() => validate(base)).not.toThrow();
  });

  it.each(['1', 'true', 'false', 'loopback,10.0.0.0/8'])('accepts %s', (value) => {
    expect(() => validate({ ...base, TRUST_PROXY: value })).not.toThrow();
  });

  it('rejects a malformed value at startup', () => {
    expect(() => validate({ ...base, TRUST_PROXY: 'yes please' })).toThrow(/TRUST_PROXY/);
  });
});
