import { ConfigService } from '@nestjs/config';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import {
  PAYLOAD_BUCKET_BYTES,
  PAYLOAD_HEADER_BYTES,
  padPayload,
  unpadPayload,
} from './pending-payload';

describe('pending payload padding', () => {
  // A test-only key supplied through a stubbed ConfigService (never the env).
  const encryption = new FieldEncryptionService({
    get: () => 'a'.repeat(64),
  } as unknown as ConfigService);

  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

  it('uses an 8192-byte bucket and an 8-byte length header', () => {
    expect(PAYLOAD_BUCKET_BYTES).toBe(8192);
    expect(PAYLOAD_HEADER_BYTES).toBe(8);
  });

  it('pads short payloads of very different lengths to the same 8192-byte plaintext', () => {
    const tiny = JSON.stringify([{ questionId: 'q', numericValue: 1 }]);
    const longer = JSON.stringify([
      { questionId: 'q-1', textValue: 'x'.repeat(3000), choiceValues: [], numericValue: null },
    ]);

    expect(bytes(padPayload(tiny))).toBe(8192);
    expect(bytes(padPayload(longer))).toBe(8192);
  });

  it('encrypts two very different short payloads to ciphertexts of identical length', () => {
    const a = encryption.encrypt(padPayload(JSON.stringify([{ questionId: 'q', textValue: 'ok' }])));
    const b = encryption.encrypt(
      padPayload(JSON.stringify([{ questionId: 'q', textValue: 'y'.repeat(4000) }])),
    );

    expect(a.length).toBe(b.length);
    expect(a).not.toBe(b);
  });

  it('round-trips exactly, including multi-byte UTF-8 text', () => {
    const json = JSON.stringify([
      { questionId: 'q-1', textValue: 'नमस्ते 👋 café — “quoted”  ', choiceValues: ['Ünïcode'] },
    ]);

    const padded = padPayload(json);
    expect(unpadPayload(padded)).toBe(json);
    expect(unpadPayload(encryption.decrypt(encryption.encrypt(padded)))).toBe(json);
  });

  it('frames the payload with its UTF-8 byte length as 8 zero-padded digits', () => {
    const json = '["é"]'; // 6 bytes: é is 2 bytes in UTF-8
    expect(padPayload(json).slice(0, 8)).toBe('00000006');
  });

  it('puts a payload just over the first bucket into a 16384-byte bucket', () => {
    // header (8) + json (8185) = 8193 bytes > 8192.
    const json = JSON.stringify('z'.repeat(8183)); // 8183 + 2 quotes = 8185 bytes
    expect(bytes(json)).toBe(8185);

    const padded = padPayload(json);
    expect(bytes(padded)).toBe(16384);
    expect(unpadPayload(padded)).toBe(json);
  });

  it('keeps a payload that exactly fills the first bucket at 8192 bytes', () => {
    const json = JSON.stringify('z'.repeat(8182)); // 8184 bytes + 8 header = 8192
    expect(bytes(padPayload(json))).toBe(8192);
  });

  it('rejects a malformed frame', () => {
    expect(() => unpadPayload('not-a-frame')).toThrow();
    expect(() => unpadPayload('00009999{}')).toThrow();
  });
});
