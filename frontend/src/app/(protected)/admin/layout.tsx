'use client';

import { ShieldAlert } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { permissionForPath } from '@/lib/permission-paths';

const SECURITY_PREFIX = '/admin/security';

/**
 * Role/permission gate for every page under /admin.
 *
 * The API already refuses these calls for non-admins (and for custom-role
 * holders without the matching permission), so this is not the security
 * boundary. Without it, though, someone who navigates directly to an admin
 * URL they cannot use gets the full admin shell and a wall of failed
 * requests, which reads as a broken app rather than a page they should not
 * be on.
 *
 * A fixed admin role (isAdmin) always gets through. Otherwise a custom-role
 * holder gets through only when their permissions cover the current path
 * (spec §4.3) AND the path is not under /admin/security — security
 * administration stays admin-only regardless of any grantable permission
 * (spec P8; permission-paths.ts never lists a /admin/security path anyway,
 * but this is an explicit belt-and-braces check).
 *
 * Applied once here instead of in each of the ~19 admin pages, so a new page
 * added to this directory is covered by default.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading, hasPermission } = useAuth();
  const pathname = usePathname();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary-500 border-t-transparent" />
      </div>
    );
  }

  const isSecurityPath = pathname === SECURITY_PREFIX || pathname?.startsWith(`${SECURITY_PREFIX}/`);
  const allowedByPermission =
    !isSecurityPath && hasPermission(permissionForPath(pathname));

  if (!isAdmin && !allowedByPermission) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShieldAlert className="mb-4 h-10 w-10 text-warm-400" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-warm-900">
          You do not have access to this page
        </h1>
        <p className="mt-1.5 max-w-sm text-sm text-warm-500">
          Administration pages are limited to HR administrators. If you think you
          should have access, ask your HR team.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
