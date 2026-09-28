/**
 * Length-hiding framing for pending anonymous survey payloads.
 *
 * AES-GCM ciphertext is exactly as long as its plaintext (plus a constant),
 * so an unpadded pending row would leak the byte length of the answers.
 * Anyone with SELECT could note that length while the row waits (its xmin
 * names the participant) and match it against the released responses.
 * Padding every payload to a fixed bucket makes all normal submissions
 * encrypt to the same size; only very long text answers reach a larger
 * bucket.
 *
 * Frame: `<UTF-8 byte length of json, 8 zero-padded digits>` + json + spaces,
 * up to the bucket size in bytes.
 */
export const PAYLOAD_BUCKET_BYTES = 8192;
export const PAYLOAD_HEADER_BYTES = 8;

export function padPayload(json: string): string {
  const jsonBytes = Buffer.byteLength(json, 'utf8');
  const framed = PAYLOAD_HEADER_BYTES + jsonBytes;
  const bucket = Math.max(
    PAYLOAD_BUCKET_BYTES,
    Math.ceil(framed / PAYLOAD_BUCKET_BYTES) * PAYLOAD_BUCKET_BYTES,
  );
  const header = String(jsonBytes).padStart(PAYLOAD_HEADER_BYTES, '0');
  if (header.length !== PAYLOAD_HEADER_BYTES) {
    throw new Error('Pending payload too large to frame');
  }
  return header + json + ' '.repeat(bucket - framed);
}

export function unpadPayload(padded: string): string {
  const buf = Buffer.from(padded, 'utf8');
  const header = buf.subarray(0, PAYLOAD_HEADER_BYTES).toString('ascii');
  if (!/^\d{8}$/.test(header)) {
    throw new Error('Malformed pending payload frame');
  }
  const length = Number(header);
  if (PAYLOAD_HEADER_BYTES + length > buf.length) {
    throw new Error('Malformed pending payload frame');
  }
  return buf
    .subarray(PAYLOAD_HEADER_BYTES, PAYLOAD_HEADER_BYTES + length)
    .toString('utf8');
}
