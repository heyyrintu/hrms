import { Injectable, NotImplementedException } from '@nestjs/common';

/**
 * TOTP primitives (otplib): 6 digits, 30-second step, ±1 step window.
 * Owned by WS-2 (plan Task 2.1).
 */
@Injectable()
export class TotpService {
  generateSecret(): string {
    throw new NotImplementedException();
  }

  keyUri(_email: string, _issuer: string, _secret: string): string {
    throw new NotImplementedException();
  }

  qrDataUrl(_uri: string): Promise<string> {
    throw new NotImplementedException();
  }

  /** Accepted 30-second step, or null when the code is wrong or replayed. */
  verify(_secret: string, _code: string, _lastStep: number | null): number | null {
    throw new NotImplementedException();
  }
}
