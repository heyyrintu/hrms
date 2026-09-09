'use client';

import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Role gate for every page under /settlements.
 *
 * The API already refuses these calls for non-admins, so this is not the
 * security boundary. Without it, though, an employee who navigates directly to
 * a settlement URL gets the full shell and a wall of failed requests, which
 * reads as a broken app rather than a page they should not be on.
 *
 * A settlement names what a departing colleague is owed, down to the gratuity
 * and the recoveries taken off it. Nobody outside HR should see a half-loaded
 * version of that and be left guessing what it said.
 */
export default function SettlementsLayout({ children }: { children: React.ReactNode }) {
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
                    Settlements are limited to HR administrators. If you are leaving
                    and want to know what you are owed, ask your HR team.
                </p>
            </div>
        );
    }

    return <>{children}</>;
}
