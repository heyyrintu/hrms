'use client';

import { ShieldAlert } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { permissionForPath } from '@/lib/permission-paths';

/**
 * Role/permission gate for every page under /settlements.
 *
 * The API already refuses these calls for non-admins (and for custom-role
 * holders without the matching permission), so this is not the security
 * boundary. Without it, though, someone who navigates directly to a
 * settlement URL they cannot use gets the full shell and a wall of failed
 * requests, which reads as a broken app rather than a page they should not
 * be on.
 *
 * A fixed admin role (isAdmin) always gets through. Otherwise a custom-role
 * holder gets through only when their permissions cover the current path
 * (spec §4.3) — mirrors AdminLayout's isAdmin || hasPermission(...) check
 * (I5: this used to check isAdmin alone, so exit.manage holders got the
 * "no access" wall the API itself would not have given them).
 *
 * A settlement names what a departing colleague is owed, down to the gratuity
 * and the recoveries taken off it. Nobody outside HR should see a half-loaded
 * version of that and be left guessing what it said.
 */
export default function SettlementsLayout({ children }: { children: React.ReactNode }) {
    const { isAdmin, isLoading, hasPermission } = useAuth();
    const pathname = usePathname();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary-500 border-t-transparent" />
            </div>
        );
    }

    const allowedByPermission = hasPermission(permissionForPath(pathname));

    if (!isAdmin && !allowedByPermission) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <ShieldAlert className="mb-4 h-10 w-10 text-warm-400" aria-hidden="true" />
                <h1 className="text-lg font-semibold text-warm-900">
                    You do not have access to this page
                </h1>
                <p className="mt-1.5 max-w-sm text-sm text-warm-500">
                    Settlements are limited to HR administrators. If you are leaving
                    and want to know what you are owed, ask your HR team.
                </p>
            </div>
        );
    }

    return <>{children}</>;
}
