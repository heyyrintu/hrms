import { Injectable, NotImplementedException } from '@nestjs/common';

/**
 * Single-use recovery codes: 10 per user, shown once, stored as sha256.
 * Owned by WS-2 (plan Task 2.1).
 */
@Injectable()
export class RecoveryCodesService {
  generate(): { plain: string[]; hashes: string[] } {
    throw new NotImplementedException();
  }

  normalise(_input: string): string {
    throw new NotImplementedException();
  }

  hash(_input: string): string {
    throw new NotImplementedException();
  }

  looksLikeRecoveryCode(_input: string): boolean {
    throw new NotImplementedException();
  }
}
