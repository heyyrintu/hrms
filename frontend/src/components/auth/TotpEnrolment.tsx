'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import { Button, Input, FormError, Spinner } from '@/components/ui';
import { twoFactorApi } from '@/lib/api-security';
import { AuthResponse } from '@/types';

export interface TotpEnrolmentProps {
  /** A step token from forced enrolment mid-login; omitted when enabling from an existing session. */
  enrolToken?: string;
  onEnabled: (result: { recoveryCodes: string[]; session: AuthResponse }) => void;
}

/** Pulls the shared secret out of an otpauth:// key URI, for manual entry. */
function parseSecret(otpauthUrl: string): string | null {
  const match = otpauthUrl.match(/[?&]secret=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * TOTP enrolment: scan the QR (or enter the key manually), then confirm with
 * a code. Owned by WS-2 (plan Task 2.7); reused by /my-security (Task 2.8).
 */
export default function TotpEnrolment({ enrolToken, onEnabled }: TotpEnrolmentProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await twoFactorApi.setup(enrolToken);
        if (cancelled) return;
        setQrCodeDataUrl(response.data.qrCodeDataUrl);
        setSecret(parseSecret(response.data.otpauthUrl));
      } catch (err) {
        if (cancelled) return;
        const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
        setError(
          typeof message === 'string'
            ? message
            : 'Could not start two-factor setup. Please try again.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enrolToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const response = await twoFactorApi.enable(code.trim(), enrolToken);
      onEnabled(response.data);
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
      setError(typeof message === 'string' ? message : 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-warm-900">
          Set up two-factor authentication
        </h2>
        <p className="mt-1.5 sm:mt-2 text-sm text-warm-500">
          Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password, ...).
        </p>
      </div>

      <div className="bg-white py-6 sm:py-8 px-5 sm:px-7 shadow-elevated rounded-2xl border border-warm-200 space-y-5">
        {error && <FormError message={error} />}

        {qrCodeDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrCodeDataUrl}
            alt="QR code for your authenticator app"
            className="mx-auto h-40 w-40 rounded-lg border border-warm-200 p-2"
          />
        )}

        {secret && (
          <p className="text-center text-xs text-warm-500">
            Can&apos;t scan the code? Enter this key manually:
            <br />
            <span className="mt-1 inline-block font-mono font-semibold tracking-wide text-warm-700">
              {secret}
            </span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Confirmation code"
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            required
          />
          <Button type="submit" className="w-full h-11" loading={submitting} disabled={submitting}>
            {submitting ? 'Confirming...' : 'Confirm and enable'}
          </Button>
        </form>
      </div>
    </div>
  );
}
