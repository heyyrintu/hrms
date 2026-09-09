'use client';

import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Role gate for every page under /admin.
 *
 * The API already refuses these calls for non-admins, so this is not the
 * security boundary. Without it, though, a non-admin who navigates directly to
 * an admin URL gets the full admin shell and a wall of failed requests, which
 * reads as a broken app rather than a page they should not be on.
 *
 * Applied once here instead of in each of the ~19 admin pages, so a new page
 * added to this directory is covered by default.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) {
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
