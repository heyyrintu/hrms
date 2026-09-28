import * as crypto from 'crypto';
import { RecoveryCodesService } from './recovery-codes.service';

describe('RecoveryCodesService', () => {
  let service: RecoveryCodesService;

  beforeEach(() => {
    service = new RecoveryCodesService();
  });

  describe('generate', () => {
    it('generates 10 unique codes shown as xxxxx-xxxxx with matching hashes', () => {
      const { plain, hashes } = service.generate();

      expect(plain).toHaveLength(10);
      expect(hashes).toHaveLength(10);
      expect(new Set(plain).size).toBe(10);

      for (const code of plain) {
        expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      }

      plain.forEach((code, i) => {
        expect(hashes[i]).toBe(service.hash(code));
      });
    });
  });

  describe('normalise / hash', () => {
    it('normalises different typed forms of the same code to the same value', () => {
      const a = service.normalise('ABCDE-FGHJK');
      const b = service.normalise('abcde fghjk');
      const c = service.normalise('abcdefghjk');

      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it('hashes the normalised value with sha256', () => {
      const expected = crypto.createHash('sha256').update('abcdefghjk').digest('hex');
      expect(service.hash('ABCDE-FGHJK')).toBe(expected);
      expect(service.hash('abcde fghjk')).toBe(expected);
      expect(service.hash('abcdefghjk')).toBe(expected);
    });
  });

  describe('looksLikeRecoveryCode', () => {
    it('is true for a normalised length of 10', () => {
      expect(service.looksLikeRecoveryCode('ABCDE-FGHJK')).toBe(true);
      expect(service.looksLikeRecoveryCode('abcde fghjk')).toBe(true);
      expect(service.looksLikeRecoveryCode('abcdefghjk')).toBe(true);
    });

    it('is false for a 6-digit TOTP code', () => {
      expect(service.looksLikeRecoveryCode('123456')).toBe(false);
    });
  });
});
