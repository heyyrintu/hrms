'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { attendanceCaptureApi, type CapturePolicyStatus } from '@/lib/api-attendance-capture';
import { SelfieCapture } from './SelfieCapture';

interface Pending {
  resolve: (uploadId: string) => void;
  reject: (error: Error) => void;
}

/**
 * Loads the caller's punch policy and runs the selfie step of a punch.
 *
 * `requestSelfie()` resolves with an upload id after the employee confirms a
 * photo, with `undefined` when the policy does not ask for one, and rejects
 * when they cancel. Render `selfieDialog` once in the page.
 */
export function usePunchCapture(): {
  policy: CapturePolicyStatus | null;
  /** True when the server will refuse a punch from this network (no covering request). */
  officeOnly: boolean;
  requestSelfie: () => Promise<string | undefined>;
  selfieDialog: ReactElement;
} {
  const [policy, setPolicy] = useState<CapturePolicyStatus | null>(null);
  const [open, setOpen] = useState(false);
  const pending = useRef<Pending | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => attendanceCaptureApi.getPolicy())
      .then((res) => {
        if (alive) setPolicy(res.data);
      })
      // Without the policy the server still enforces it and says why.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const requestSelfie = useCallback((): Promise<string | undefined> => {
    if (!policy?.selfieRequired) return Promise.resolve(undefined);
    return new Promise<string | undefined>((resolve, reject) => {
      pending.current = { resolve, reject };
      setOpen(true);
    });
  }, [policy]);

  const settle = (fn: (p: Pending) => void) => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    if (current) fn(current);
  };

  const selfieDialog = (
    <SelfieCapture
      open={open}
      onCancel={() => settle((p) => p.reject(new Error('Selfie cancelled')))}
      onCaptured={(uploadId) => settle((p) => p.resolve(uploadId))}
    />
  );

  const officeOnly = !!policy && policy.ipRestrictionEnabled && !policy.ipAllowed && !policy.coveringRequest;

  return { policy, officeOnly, requestSelfie, selfieDialog };
}
