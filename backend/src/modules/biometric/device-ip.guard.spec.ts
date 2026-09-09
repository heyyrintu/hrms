import { ForbiddenException, Logger } from '@nestjs/common';
import { DeviceIpGuard } from './device-ip.guard';

function ctxWithIp(ip: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  } as any;
}

function guardWith(allowed?: string) {
  return new DeviceIpGuard({ get: () => allowed } as any);
}

describe('DeviceIpGuard', () => {
  it('denies every source when BIOMETRIC_ALLOWED_IPS is not configured', () => {
    expect(() => guardWith(undefined).canActivate(ctxWithIp('203.0.113.9'))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when the value is present but empty', () => {
    expect(() => guardWith('   ').canActivate(ctxWithIp('203.0.113.9'))).toThrow(
      ForbiddenException,
    );
  });

  it('allows any source only when the operator explicitly opts out with "*"', () => {
    expect(guardWith('*').canActivate(ctxWithIp('203.0.113.9'))).toBe(true);
  });

  it('still applies the allowlist when "*" appears alongside real entries', () => {
    // "*" is an all-or-nothing opt-out, not an entry that can be mixed in.
    const guard = guardWith('*, 10.0.0.5');
    expect(guard.canActivate(ctxWithIp('10.0.0.5'))).toBe(true);
    expect(() => guard.canActivate(ctxWithIp('203.0.113.9'))).toThrow(ForbiddenException);
  });

  it('allows an IP that is on the list', () => {
    expect(guardWith('10.0.0.5, 10.0.0.6').canActivate(ctxWithIp('10.0.0.6'))).toBe(true);
  });

  it('rejects an IP that is not on the list', () => {
    expect(() => guardWith('10.0.0.5').canActivate(ctxWithIp('203.0.113.9'))).toThrow(
      ForbiddenException,
    );
  });

  it('warns about an allowlist entry it cannot parse, instead of failing silently', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      guardWith('10.0.5.0/33');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('10.0.5.0/33'));
    } finally {
      warn.mockRestore();
    }
  });

  it('matches IPv4 CIDR ranges', () => {
    const guard = guardWith('192.168.10.0/24');
    expect(guard.canActivate(ctxWithIp('192.168.10.77'))).toBe(true);
    expect(() => guard.canActivate(ctxWithIp('192.168.11.1'))).toThrow(ForbiddenException);
  });

  it('normalises IPv4-mapped IPv6 addresses before matching', () => {
    expect(guardWith('10.0.0.5').canActivate(ctxWithIp('::ffff:10.0.0.5'))).toBe(true);
  });
});
