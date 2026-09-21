import * as dns from 'node:dns';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  bareHostname,
  classifyBlockedAddress,
  privateTargetsAllowed,
  UnsafeWebhookTargetError,
} from './url-safety';

/**
 * The one HTTP client webhook deliveries go through.
 *
 * Checking a hostname and then handing the URL to `fetch` leaves a gap: `fetch`
 * does its own DNS lookup, and a hostile name server can answer the check with
 * a public address and the connection with 127.0.0.1. So the check lives inside
 * the connection instead. Every address the socket is about to dial passes
 * through {@link guardedLookup} first, which makes the address that was checked
 * the address that is used.
 *
 * `node:http` never follows redirects, so a public URL cannot 302 inward
 * either. A 3xx comes back to the caller as a plain status.
 */

/** Response bodies are only kept for debugging; stop reading well before memory matters. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * A `lookup` for `net.connect` that refuses to hand back a blocked address.
 *
 * It resolves every address for the name and rejects the lot if any one is
 * blocked, for the same reason the save-time check does: which address gets
 * dialled is not ours to choose. Node calls this with `all: true` when it races
 * address families, and without it otherwise, so both answer shapes are served.
 */
export function guardedLookup(
  hostname: string,
  options: any,
  callback: (...args: any[]) => void,
): void {
  const opts = options && typeof options === 'object' ? options : {};

  dns.lookup(hostname, { ...opts, all: true }, (error: NodeJS.ErrnoException | null, addresses: any) => {
    if (error) {
      callback(error);
      return;
    }

    const list: dns.LookupAddress[] = addresses;
    if (!list || list.length === 0) {
      callback(new UnsafeWebhookTargetError(`"${hostname}" could not be resolved`));
      return;
    }

    if (!privateTargetsAllowed()) {
      for (const { address } of list) {
        const reason = classifyBlockedAddress(address);
        if (reason) {
          callback(
            new UnsafeWebhookTargetError(
              `"${hostname}" resolves to ${address} (${reason}), which a webhook may not target`,
            ),
          );
          return;
        }
      }
    }

    if (opts.all) {
      callback(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
}

export interface WebhookRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export interface WebhookResponse {
  status: number;
  text(): Promise<string>;
}

/**
 * POSTs a webhook delivery. Shaped like `fetch` so the call sites read the same,
 * but it only ever connects to public addresses and never follows a redirect.
 * Rejects with {@link UnsafeWebhookTargetError} when the target is refused.
 */
export function webhookFetch(
  url: string,
  init: WebhookRequestInit,
): Promise<WebhookResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new UnsafeWebhookTargetError(`"${url}" is not a valid URL`));
      return;
    }

    const request =
      parsed.protocol === 'https:'
        ? httpsRequest
        : parsed.protocol === 'http:'
          ? httpRequest
          : null;
    if (!request) {
      reject(new UnsafeWebhookTargetError('A webhook URL must use http:// or https://'));
      return;
    }

    // An IP literal is dialled directly and never reaches `lookup`, so it has
    // to be judged here.
    const host = bareHostname(parsed);
    if (isIP(host) && !privateTargetsAllowed()) {
      const reason = classifyBlockedAddress(host);
      if (reason) {
        reject(new UnsafeWebhookTargetError(`A webhook may not target ${host} (${reason})`));
        return;
      }
    }

    const req = request(
      parsed,
      {
        method: init.method,
        headers: {
          ...init.headers,
          'Content-Length': String(Buffer.byteLength(init.body)),
        },
        lookup: guardedLookup as any,
        signal: init.signal,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, text: async () => body });
        };

        res.on('data', (chunk: Buffer) => {
          if (size >= MAX_BODY_BYTES) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BODY_BYTES) {
            // Enough to debug with. Stop the download rather than buffer it.
            finish();
            res.destroy();
          }
        });
        res.on('end', finish);
        res.on('error', (error) => {
          if (!settled) reject(error);
        });
      },
    );

    req.on('error', reject);
    req.end(init.body);
  });
}
