'use client';

import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Role gate for every page under /payroll.
 *
 * The API already refuses these calls for non-admins, so this is not the
 * security boundary. Without it, though, an employee who navigates directly to
 * a payroll URL gets the full payroll shell and a wall of failed requests,
 * which reads as a broken app rather than a page they should not be on.
 *
 * Salary figures for the whole company sit behind these pages, so the wrong
 * impression matters more here than elsewhere: someone seeing an empty payroll
 * table should understand they were refused, not that the data is missing.
 *
 * An employee's own payslips live at /my-payslips and their own Form 16 at
 * /my-form16, neither of which is under this gate.
 */
export default function PayrollLayout({ children }: { children: React.ReactNode }) {
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
                    Payroll pages are limited to HR administrators. Your own payslips
                    are under My Payslips, and your own Form 16 under My Form 16.
                </p>
            </div>
        );
    }

    return <>{children}</>;
}
