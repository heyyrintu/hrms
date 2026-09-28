import { authenticator } from 'otplib';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  let service: TotpService;

  beforeEach(() => {
    service = new TotpService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('generateSecret / keyUri / qrDataUrl', () => {
    it('generates a base32 secret', () => {
      const secret = service.generateSecret();
      expect(secret).toMatch(/^[A-Z2-7]+$/);
      expect(secret.length).toBeGreaterThanOrEqual(16);
    });

    it('builds an otpauth key URI with the issuer and email', () => {
      const uri = service.keyUri('jane@acme.test', 'Acme Corp', 'JBSWY3DPEHPK3PXP');
      expect(uri.startsWith('otpauth://totp/')).toBe(true);
      expect(uri).toContain(encodeURIComponent('Acme Corp'));
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    });

    it('renders a data: URL QR code for the key URI', async () => {
      const uri = service.keyUri('jane@acme.test', 'Acme Corp', 'JBSWY3DPEHPK3PXP');
      const dataUrl = await service.qrDataUrl(uri);
      expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  describe('verify', () => {
    const secret = 'JBSWY3DPEHPK3PXP';

    it('accepts the current code', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      const code = authenticator.generate(secret);
      const step = service.verify(secret, code, null);
      expect(step).not.toBeNull();
    });

    it('rejects a wrong code', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      const step = service.verify(secret, '000000', null);
      expect(step).toBeNull();
    });

    it('rejects the same code used twice (replay)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      const code = authenticator.generate(secret);
      const firstStep = service.verify(secret, code, null);
      expect(firstStep).not.toBeNull();
      const secondStep = service.verify(secret, code, firstStep);
      expect(secondStep).toBeNull();
    });

    it('accepts a code from the previous 30-second step (±1 window)', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      const previousStepCode = authenticator.generate(secret);

      jest.setSystemTime(new Date('2026-09-28T12:00:30Z'));
      const step = service.verify(secret, previousStepCode, null);
      expect(step).not.toBeNull();
    });

    it('rejects non-digit input without calling otplib', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      expect(service.verify(secret, 'abcdef', null)).toBeNull();
      expect(service.verify(secret, '12345', null)).toBeNull();
      expect(service.verify(secret, '1234567', null)).toBeNull();
    });
  });
});
