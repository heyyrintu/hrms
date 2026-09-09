import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Source-IP allowlist for the unauthenticated ICLOCK device endpoints.
 *
 * ZKTeco/ESSL devices cannot send credentials, so restricting where pushes may
 * come from is the only control available at this layer. Configure
 * BIOMETRIC_ALLOWED_IPS as a comma-separated list of IPv4 addresses and/or
 * CIDR ranges (e.g. "10.0.5.20, 192.168.1.0/24").
 *
 * This guard FAILS CLOSED: with nothing configured, every push is rejected.
 * An access control that defaults to "off" is not a control, and forged
 * punches flow straight into overtime and payroll. A deployment that genuinely
 * cannot pin source IPs must opt out deliberately by setting the value to "*",
 * which is loud in config review and logged as a warning at startup.
 *
 * If the API sits behind a proxy, set `app.set('trust proxy', ...)` so req.ip
 * reflects the real client rather than the proxy.
 */
@Injectable()
export class DeviceIpGuard implements CanActivate {
  private readonly logger = new Logger(DeviceIpGuard.name);
  private readonly rules: Array<{ base: number; mask: number } | string>;
  /** Explicit operator opt-out: accept pushes from any source. */
  private readonly allowAll: boolean;

  constructor(config: ConfigService) {
    const entries = (config.get<string>('BIOMETRIC_ALLOWED_IPS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // "*" is an all-or-nothing opt-out, honoured only when it is the sole entry.
    this.allowAll = entries.length === 1 && entries[0] === '*';
    this.rules = this.allowAll
      ? []
      : entries.filter((e) => e !== '*').map((entry) => this.parseRule(entry));

    if (this.allowAll) {
      this.logger.warn(
        'BIOMETRIC_ALLOWED_IPS="*": /iclock accepts device pushes from ANY source IP',
      );
    } else if (this.rules.length === 0) {
      this.logger.error(
        'BIOMETRIC_ALLOWED_IPS is not configured: all /iclock device pushes will be rejected. ' +
          'Set it to your devices\' IPs or CIDR ranges, or to "*" to deliberately accept any source.',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.allowAll) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = this.normalise(req.ip ?? '');

    if (this.rules.length === 0) {
      this.logger.error(
        `Rejected /iclock request from ${ip}: BIOMETRIC_ALLOWED_IPS is not configured`,
      );
      throw new ForbiddenException('Device push endpoint is not configured');
    }

    if (this.matches(ip)) return true;

    this.logger.warn(`Rejected /iclock request from unlisted IP ${ip}`);
    throw new ForbiddenException('Source IP not permitted for device push');
  }

  private normalise(ip: string): string {
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  }

  private parseRule(entry: string): { base: number; mask: number } | string {
    const [addr, bits] = entry.split('/');
    const n = this.ipv4ToInt(addr);
    if (n === null) return entry; // not IPv4: exact-string match only
    if (bits === undefined) return { base: n, mask: 0xffffffff };
    const prefix = Number(bits);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return entry;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return { base: (n & mask) >>> 0, mask };
  }

  private matches(ip: string): boolean {
    const n = this.ipv4ToInt(ip);
    return this.rules.some((rule) => {
      if (typeof rule === 'string') return rule === ip;
      if (n === null) return false;
      return ((n & rule.mask) >>> 0) === rule.base;
    });
  }

  private ipv4ToInt(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let out = 0;
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      const v = Number(p);
      if (v > 255) return null;
      out = (out << 8) | v;
    }
    return out >>> 0;
  }
}
