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
 * ZKTeco/ESSL devices cannot send credentials, so the only defence against a
 * forged punch is restricting where pushes may come from. Configure
 * BIOMETRIC_ALLOWED_IPS as a comma-separated list of IPv4 addresses and/or
 * CIDR ranges (e.g. "10.0.5.20, 192.168.1.0/24"). When unset, every source is
 * allowed and a warning is logged once at startup.
 *
 * If the API sits behind a proxy, set `app.set('trust proxy', ...)` so req.ip
 * reflects the real client.
 */
@Injectable()
export class DeviceIpGuard implements CanActivate {
  private readonly logger = new Logger(DeviceIpGuard.name);
  private readonly rules: Array<{ base: number; mask: number } | string>;

  constructor(config: ConfigService) {
    const raw = config.get<string>('BIOMETRIC_ALLOWED_IPS') ?? '';
    this.rules = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => this.parseRule(entry));

    if (this.rules.length === 0) {
      this.logger.warn(
        'BIOMETRIC_ALLOWED_IPS is not set: /iclock accepts pushes from any source IP',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.rules.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = this.normalise(req.ip ?? '');

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
