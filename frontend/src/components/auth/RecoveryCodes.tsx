'use client';

import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';

export interface RecoveryCodesProps {
  codes: string[];
  /** Enabled once the "I have saved these codes" checkbox is checked. */
  onContinue: () => void;
}

/**
 * Shown once, right after 2FA is enabled: the 10 single-use recovery codes,
 * with copy and download options. Owned by WS-2 (plan Task 2.7).
 */
export default function RecoveryCodes({ codes, onContinue }: RecoveryCodesProps) {
  const [saved, setSaved] = useState(false);
  const checkboxId = useId();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Recovery codes copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'hrms-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-md space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-warm-900">Save your recovery codes</h2>
        <p className="mt-1.5 sm:mt-2 text-sm text-warm-500">
          Each code works once, if you ever lose access to your authenticator app. Store them
          somewhere safe — you won&apos;t see them again.
        </p>
      </div>

      <div className="bg-white py-6 sm:py-8 px-5 sm:px-7 shadow-elevated rounded-2xl border border-warm-200 space-y-5">
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-warm-800">
          {codes.map((code) => (
            <li key={code} className="rounded-lg bg-warm-50 px-3 py-2 text-center">
              {code}
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={handleCopy}>
            Copy
          </Button>
          <Button type="button" variant="secondary" className="flex-1" onClick={handleDownload}>
            Download .txt
          </Button>
        </div>

        <label htmlFor={checkboxId} className="flex items-start gap-2 text-sm text-warm-600">
          <input
            id={checkboxId}
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500"
          />
          I have saved these codes
        </label>

        <Button type="button" className="w-full h-11" disabled={!saved} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
