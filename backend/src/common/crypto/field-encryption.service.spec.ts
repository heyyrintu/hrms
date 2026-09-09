import { FieldEncryptionService } from './field-encryption.service';

const TEST_KEY = 'a'.repeat(64); // 32 bytes, hex-encoded

function buildService(key?: string) {
  return new FieldEncryptionService({ get: () => key } as any);
}

describe('FieldEncryptionService', () => {
  it('round-trips a value through encrypt and decrypt', () => {
    const svc = buildService(TEST_KEY);
    const stored = svc.encrypt('123412341234');

    expect(stored).not.toBe('123412341234');
    expect(stored.startsWith('enc:v1:')).toBe(true);
    expect(svc.decrypt(stored)).toBe('123412341234');
  });

  it('produces a different ciphertext each time for the same input', () => {
    const svc = buildService(TEST_KEY);
    expect(svc.encrypt('123412341234')).not.toBe(svc.encrypt('123412341234'));
  });

  it('returns legacy plaintext unchanged from decrypt so old rows keep working', () => {
    const svc = buildService(TEST_KEY);
    expect(svc.decrypt('123412341234')).toBe('123412341234');
  });

  it('masks to the last four digits whether the stored value is encrypted or legacy plaintext', () => {
    const svc = buildService(TEST_KEY);
    expect(svc.mask(svc.encrypt('123412341234'))).toBe('XXXX XXXX 1234');
    expect(svc.mask('123412341234')).toBe('XXXX XXXX 1234');
    expect(svc.mask(null)).toBeNull();
  });

  it('refuses to encrypt when no key is configured', () => {
    const svc = buildService(undefined);
    expect(() => svc.encrypt('123412341234')).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => buildService('abc').encrypt('x')).toThrow(/64 hex/);
  });
});
