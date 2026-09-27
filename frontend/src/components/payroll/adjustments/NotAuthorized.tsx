'use client';

import { ShieldAlert } from 'lucide-react';

/** The refusal shown by payroll admin pages, worded like the admin and payroll layouts. */
export function NotAuthorized() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ShieldAlert className="mb-4 h-10 w-10 text-warm-400" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-warm-900">You do not have access to this page</h1>
      <p className="mt-1.5 max-w-sm text-sm text-warm-500">
        This page is limited to HR administrators. If you think you should have access, ask your HR team.
      </p>
    </div>
  );
}
