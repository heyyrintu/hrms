import { isIpAllowed, validateIpRange } from './ip-allowlist';

describe('isIpAllowed', () => {
  const ranges = ['10.0.0.0/8', '203.0.113.7', '2001:db8::/32'];
  it.each([
    ['10.1.2.3', true],
    ['::ffff:10.1.2.3', true], // IPv4-mapped IPv6 from Node sockets
    ['203.0.113.7', true],
    ['203.0.113.8', false],
    ['2001:db8:1::5', true],
    ['2001:db9::1', false],
    ['', false],
    ['not-an-ip', false],
  ])('%s -> %s', (ip, expected) => expect(isIpAllowed(ip, ranges)).toBe(expected));
  it('fails closed on undefined', () => expect(isIpAllowed(undefined, ranges)).toBe(false));
  it('empty list allows nothing', () => expect(isIpAllowed('10.1.2.3', [])).toBe(false));
});

describe('validateIpRange', () => {
  it.each(['10.0.0.0/8', '192.168.1.10', '2001:db8::/32', '::1'])('%s ok', (r) =>
    expect(validateIpRange(r)).toBeNull());
  it.each(['10.0.0.0/33', '300.1.1.1', 'abc', '2001:db8::/129', ''])('%s invalid', (r) =>
    expect(validateIpRange(r)).toMatch(/invalid/i));
});
