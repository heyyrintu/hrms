/**
 * Pages a custom-role holder may open because a permission covers every API
 * call the page makes (Keka wave H1). Fixed admin roles never need this map;
 * it only widens access, mirroring @RequirePermissions on the API.
 *
 * Paths are matched by longest prefix on whole segments.
 */
export const PERMISSION_PATHS: Record<string, string> = {};

export function permissionForPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  let best: string | undefined;
  for (const prefix of Object.keys(PERMISSION_PATHS)) {
    const matches = path === prefix || path.startsWith(prefix + '/');
    if (matches && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? PERMISSION_PATHS[best] : undefined;
}
