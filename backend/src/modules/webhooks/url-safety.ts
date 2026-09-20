import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Keeps webhook deliveries pointed at the public internet.
 *
 * A webhook URL is attacker-chosen data. Whoever can create one can make this
 * server issue an HTTP request from inside the network perimeter, and
 * `POST /webhooks/:id/test` hands the response body straight back to them.
 * Without a target check that is a read primitive against anything the server
 * can reach: the cloud metadata service at 169.254.169.254 and the credentials
 * it vends, Postgres and Redis, and every internal admin surface that trusts
 * its own network. HR_ADMIN is a people-ops role, not an infrastructure one,
 * so "admins only" is not a control here.
 *
 * The check therefore runs twice: once when the URL is saved, and again
 * immediately before every request. Validating only on save is bypassed by a
 * hostname that resolves publicly then flips to 127.0.0.1 (DNS rebinding), and
 * by a public URL that redirects inward — which is why redirects are not
 * followed either.
 */

/** Blocked because they are not the public internet. */
const BLOCKED_IPV4: Array<[string, number, string]> = [
  ['0.0.0.0', 8, 'this network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local (cloud metadata)'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.88.99.0', 24, '6to4 relay anycast'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Reject '01' and '1e2' style octets: Number() is far too generous.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function classifyIpv4(ip: string): string | null {
  const value = ipv4ToInt(ip);
  if (value === null) return 'malformed';

  for (const [network, bits, reason] of BLOCKED_IPV4) {
    const base = ipv4ToInt(network);
    if (base === null) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) === (base & mask)) return reason;
  }
  return null;
}

function classifyIpv6(ip: string): string | null {
  const lower = ip.toLowerCase().split('%')[0]; // drop any zone index

  if (lower === '::') return 'unspecified';
  if (lower === '::1') return 'loopback';

  // An IPv4 address wearing an IPv6 coat still reaches the IPv4 host.
  // Covers ::ffff:127.0.0.1 and the NAT64 prefix 64:ff9b::/96.
  const embedded = lower.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded && (lower.startsWith('::ffff:') || lower.startsWith('64:ff9b:'))) {
    return classifyIpv4(embedded[1]);
  }

  const head = lower.split(':')[0];
  const leading = parseInt(head || '0', 16);

  if ((leading & 0xfe00) === 0xfc00) return 'unique local';
  if ((leading & 0xffc0) === 0xfe80) return 'link-local';
  if ((leading & 0xff00) === 0xff00) return 'multicast';

  return null;
}

/**
 * Why this address may not be used, or null when it is a fine public target.
 */
export function classifyBlockedAddress(ip: string): string | null {
  const family = isIP(ip);
  if (family === 4) return classifyIpv4(ip);
  if (family === 6) return classifyIpv6(ip);
  return 'malformed';
}

/**
 * Private targets are refused everywhere unless a non-production deployment
 * opts in, so that a developer can point a webhook at their own machine.
 * Production can never opt in, whatever the environment says.
 */
export function privateTargetsAllowed(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS === 'true'
  );
}

/** Raised when a URL points somewhere a webhook is not allowed to reach. */
export class UnsafeWebhookTargetError extends Error {}

/** Strips the brackets the URL parser puts around an IPv6 host. */
function bareHostname(url: URL): string {
  const host = url.hostname;
  return host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
}

/**
 * Throws unless every address this URL's host resolves to is on the public
 * internet. Resolution is checked in full: a host that returns one public and
 * one private address is refused, because which one is dialled is not ours to
 * decide.
 */
export async function assertPublicWebhookTarget(rawUrl: string): Promise<void> {
  if (privateTargetsAllowed()) return;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookTargetError(`"${rawUrl}" is not a valid URL`);
  }

  const hostname = bareHostname(url);

  // An IP literal needs no lookup — classify it as written.
  if (isIP(hostname)) {
    const reason = classifyBlockedAddress(hostname);
    if (reason) {
      throw new UnsafeWebhookTargetError(
        `A webhook may not target ${hostname} (${reason})`,
      );
    }
    return;
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeWebhookTargetError(
      `"${hostname}" could not be resolved`,
    );
  }

  if (resolved.length === 0) {
    throw new UnsafeWebhookTargetError(
      `"${hostname}" could not be resolved`,
    );
  }

  for (const { address } of resolved) {
    const reason = classifyBlockedAddress(address);
    if (reason) {
      throw new UnsafeWebhookTargetError(
        `"${hostname}" resolves to ${address} (${reason}), which a webhook may not target`,
      );
    }
  }
}
