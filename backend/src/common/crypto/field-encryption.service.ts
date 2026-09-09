import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Application-level encryption for sensitive columns such as Aadhaar numbers.
 *
 * Stored format: `enc:v1:<iv b64>:<auth tag b64>:<ciphertext b64>`.
 * Values without the prefix are treated as legacy plaintext so rows written
 * before encryption was introduced keep working until they are migrated
 * (see prisma/encrypt-aadhaar.ts).
 *
 * The key comes from FIELD_ENCRYPTION_KEY: 32 bytes, hex-encoded (64 chars).
 */
@Injectable()
export class FieldEncryptionService {
  constructor(private readonly config: ConfigService) {}

  private key(): Buffer {
    const raw = this.config.get<string>('FIELD_ENCRYPTION_KEY');
    if (!raw) {
      throw new InternalServerErrorException(
        'FIELD_ENCRYPTION_KEY is not configured; sensitive fields cannot be stored',
      );
    }
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new InternalServerErrorException(
        'FIELD_ENCRYPTION_KEY must be 64 hex characters (32 bytes)',
      );
    }
    return Buffer.from(raw, 'hex');
  }

  isEncrypted(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plain: string): string {
    const key = this.key();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  /** Encrypt when a value is present; pass null/undefined through untouched. */
  encryptNullable(plain: string | null | undefined): string | null | undefined {
    if (plain === null || plain === undefined || plain === '') return plain;
    return this.encrypt(plain);
  }

  decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) return stored; // legacy plaintext
    const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(':');
    const decipher = createDecipheriv(ALGORITHM, this.key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Masked display form: everything but the last four characters hidden,
   * grouped in fours like an Aadhaar card. Never throws on undecryptable input.
   */
  mask(stored: string | null | undefined, visible = 4): string | null | undefined {
    if (stored === null || stored === undefined) return stored;
    let plain: string;
    try {
      plain = this.decrypt(stored);
    } catch {
      return 'XXXX XXXX XXXX';
    }
    const digits = plain.replace(/\s+/g, '');
    const tail = digits.slice(-visible);
    const hiddenLen = Math.max(digits.length - tail.length, 0);
    const masked = 'X'.repeat(hiddenLen) + tail;
    return masked.replace(/(.{4})(?=.)/g, '$1 ').trim();
  }
}
