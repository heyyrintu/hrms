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
 * {@link assertPublicWebhookTarget} checks a URL when it is saved and gives a
 * clear error before a delivery is attempted. It is not what makes delivery
 * safe: a name can resolve publicly for the check and to 127.0.0.1 for the
 * connection (DNS rebinding). The binding check is `guardedLookup` in
 * webhook-http.ts, which judges the address the socket actually dials.
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

/**
 * Expands an IPv6 address to its eight 16-bit groups, or null if malformed.
 *
 * Classification has to work on the expanded form. The URL parser rewrites
 * `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, so anything that pattern-matches
 * the text of an address sees a different string from the one that is dialled.
 */
function expandIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0]; // drop any zone index

  // A trailing dotted quad is two groups written in IPv4 notation.
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const v4 = ipv4ToInt(dotted[2]);
    if (v4 === null) return null;
    text = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const split = (part: string) => (part === '' ? [] : part.split(':'));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const missing = 8 - head.length - tail.length;

  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  return groups.map((group) => parseInt(group, 16));
}

/** Two 16-bit groups read back as a dotted IPv4 address. */
function groupsToIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function classifyIpv6(ip: string): string | null {
  const g = expandIpv6(ip);
  if (!g) return 'malformed';

  const zero = (from: number, to: number) =>
    g.slice(from, to).every((group) => group === 0);

  if (zero(0, 8)) return 'unspecified';
  if (zero(0, 7) && g[7] === 1) return 'loopback';

  // Addresses that carry an IPv4 address inside them reach that IPv4 host, so
  // they are judged by it: IPv4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96)
  // and 6to4 (2002::/16).
  if (zero(0, 5) && g[5] === 0xffff) return classifyIpv4(groupsToIpv4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) {
    return classifyIpv4(groupsToIpv4(g[6], g[7]));
  }
  if (g[0] === 0x2002) return classifyIpv4(groupsToIpv4(g[1], g[2]));

  // IPv4-compatible (::a.b.c.d) is deprecated and has no legitimate use here.
  if (zero(0, 6)) return 'IPv4-compatible (deprecated)';

  if ((g[0] & 0xfe00) === 0xfc00) return 'unique local';
  if ((g[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((g[0] & 0xffc0) === 0xfec0) return 'site-local (deprecated)';
  if ((g[0] & 0xff00) === 0xff00) return 'multicast';
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'documentation';

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
export function bareHostname(url: URL): string {
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
