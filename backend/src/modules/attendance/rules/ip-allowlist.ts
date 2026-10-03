import { BlockList, isIP } from 'node:net';

type Family = 'ipv4' | 'ipv6';

/**
 * Normalise a socket address. Node reports IPv4 clients on a dual-stack
 * listener as `::ffff:a.b.c.d`; strip that so it matches IPv4 ranges.
 */
export function normaliseIp(
  ip: string | undefined | null,
): { address: string; family: Family } | null {
  if (!ip) return null;
  let address = ip.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) address = mapped[1];
  const v = isIP(address);
  if (v === 4) return { address, family: 'ipv4' };
  if (v === 6) return { address, family: 'ipv6' };
  return null;
}

function parseEntry(
  entry: string,
): { address: string; family: Family; prefix: number | null } | null {
  const [addr, prefixText, extra] = entry.trim().split('/');
  if (extra !== undefined) return null;
  const n = normaliseIp(addr);
  if (!n) return null;
  if (prefixText === undefined) return { ...n, prefix: null };
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > (n.family === 'ipv4' ? 32 : 128)) return null;
  return { ...n, prefix };
}

/** Error message for a bad allowlist entry, or null when it is valid. */
export function validateIpRange(entry: string): string | null {
  return parseEntry(entry) ? null : `Invalid IP address or range: "${entry}"`;
}

/**
 * Whether `ip` falls inside any of the ranges. Fails closed: an empty,
 * missing or unparsable address, or an empty list, allows nothing.
 */
export function isIpAllowed(ip: string | undefined | null, ranges: string[]): boolean {
  const target = normaliseIp(ip);
  if (!target || ranges.length === 0) return false;
  const list = new BlockList();
  for (const r of ranges) {
    const e = parseEntry(r);
    if (!e) continue;
    if (e.prefix === null) list.addAddress(e.address, e.family);
    else list.addSubnet(e.address, e.prefix, e.family);
  }
  return list.check(target.address, target.family);
}
