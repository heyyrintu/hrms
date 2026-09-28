import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

authenticator.options = { step: 30, digits: 6, window: 1 };

const CODE_PATTERN = /^\d{6}$/;

/**
 * TOTP primitives (otplib): 6 digits, 30-second step, ±1 step window.
 * Owned by WS-2 (plan Task 2.1).
 */
@Injectable()
export class TotpService {
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(email: string, issuer: string, secret: string): string {
    return authenticator.keyuri(email, issuer, secret);
  }

  qrDataUrl(uri: string): Promise<string> {
    return QRCode.toDataURL(uri);
  }

  /** Accepted 30-second step, or null when the code is wrong or replayed. */
  verify(secret: string, code: string, lastStep: number | null): number | null {
    if (!CODE_PATTERN.test(code)) return null;

    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return null;

    const step = Math.floor(Date.now() / 30_000) + delta;
    if (lastStep !== null && step <= lastStep) return null;

    return step;
  }
}
