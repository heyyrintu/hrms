/**
 * TRUST_PROXY -> Express `trust proxy` setting.
 *
 * Off by default: with no proxy in front, trusting X-Forwarded-For lets any
 * client pick its own req.ip and walk around the per-IP throttler (public
 * careers apply, offer answers, pre-onboarding) and the biometric allowlist.
 * Behind a reverse proxy / load balancer, set it so req.ip is the real client:
 *
 *   TRUST_PROXY=1                      trust one hop (the usual single proxy)
 *   TRUST_PROXY=loopback,10.0.0.0/8    trust these addresses / subnets
 *   TRUST_PROXY=true                   trust every hop (only if the edge strips XFF)
 *
 * Unset, empty, "false" or "0" leave it off.
 */
export type TrustProxySetting = boolean | number | string;

const NAMED_RANGES = ['loopback', 'linklocal', 'uniquelocal'];
const ADDRESS = /^[0-9a-fA-F.:]+(\/\d{1,3})?$/;

/** The shape env validation accepts (kept in step with parseTrustProxy). */
export const TRUST_PROXY_PATTERN =
  /^\s*(true|false|\d{1,2}|((loopback|linklocal|uniquelocal|[0-9a-fA-F.:]+(\/\d{1,3})?)(\s*,\s*(loopback|linklocal|uniquelocal|[0-9a-fA-F.:]+(\/\d{1,3})?))*))\s*$/i;

export function parseTrustProxy(raw: string | undefined | null): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false' || value === '0') return false;
  if (value.toLowerCase() === 'true') return true;
  if (/^\d{1,2}$/.test(value)) return Number(value);

  const entries = value.split(',').map((s) => s.trim());
  const valid = entries.every(
    (e) => NAMED_RANGES.includes(e.toLowerCase()) || ADDRESS.test(e),
  );
  if (!valid) {
    throw new Error(
      'TRUST_PROXY must be a hop count, true/false, or a comma-separated list of addresses, subnets or loopback/linklocal/uniquelocal',
    );
  }
  return entries
    .map((e) => (NAMED_RANGES.includes(e.toLowerCase()) ? e.toLowerCase() : e))
    .join(',');
}
