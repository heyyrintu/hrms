import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;
const CODE_COUNT = 10;

/**
 * Single-use recovery codes: 10 per user, shown once, stored as sha256.
 * Owned by WS-2 (plan Task 2.1).
 */
@Injectable()
export class RecoveryCodesService {
  generate(): { plain: string[]; hashes: string[] } {
    const plain: string[] = [];
    const hashes: string[] = [];
    const seen = new Set<string>();

    while (plain.length < CODE_COUNT) {
      const raw = this.randomCode();
      const normalised = this.normalise(raw);
      if (seen.has(normalised)) continue;
      seen.add(normalised);
      plain.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
      hashes.push(this.hash(raw));
    }

    return { plain, hashes };
  }

  normalise(input: string): string {
    return input.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  hash(input: string): string {
    return crypto.createHash('sha256').update(this.normalise(input)).digest('hex');
  }

  looksLikeRecoveryCode(input: string): boolean {
    return this.normalise(input).length === CODE_LENGTH;
  }

  private randomCode(): string {
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    return out;
  }
}
