'use client';

import { FileText, ShieldAlert } from 'lucide-react';

interface Form16HeaderProps {
  /** Always names Part B. Nothing here is a whole Form 16. */
  title: string;
  subtitle: string;
}

/**
 * The page heading and the standing explanation of what Part A is and where it
 * comes from. Part B is all this system can honestly produce.
 */
export function Form16Header({ title, subtitle }: Form16HeaderProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
          <FileText className="w-7 h-7 text-primary-600" />
          {title}
        </h1>
        <p className="text-warm-600 mt-1">{subtitle}</p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">Part B only. There is no Part A here.</p>
            <p className="text-sm text-amber-800 mt-1">
              Part A — the sheet carrying the certificate number, the TRACES verification and the
              challan details — is issued by the Income Tax Department through the TRACES portal,
              against the Form 24Q returns the employer has actually filed. It cannot be generated
              from payroll data, and nothing produced on this page is a substitute for it. Download
              Part A from TRACES and issue the two parts together.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
