'use client';

import { useState } from 'react';
import axios from 'axios';
import { Button, Input, FormError } from '@/components/ui';
import { twoFactorApi } from '@/lib/api-security';
import { AuthResponse } from '@/types';

const MAX_ATTEMPTS = 5;

export interface MfaCodeStepProps {
  mfaToken: string;
  /** A code (TOTP or recovery) verified successfully. */
  onSuccess: (session: AuthResponse) => void;
  /** Too many wrong codes: the challenge is spent, go back to the password step. */
  onBack: () => void;
}

/**
 * The second-factor step of login: a 6-digit TOTP code, with a toggle to a
 * single-use recovery code instead. Owned by WS-2 (plan Task 2.7).
 */
export default function MfaCodeStep({ mfaToken, onSuccess, onBack }: MfaCodeStepProps) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const response = await twoFactorApi.verify(mfaToken, code.trim());
      onSuccess(response.data);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;

      if (status === 401) {
        const next = attempts + 1;
        setAttempts(next);
        if (next >= MAX_ATTEMPTS) {
          onBack();
          return;
        }
        setError('Invalid code');
      } else {
        const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
        setError(
          typeof message === 'string' ? message : 'Could not verify your code. Please try again.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = () => {
    setUseRecovery((v) => !v);
    setCode('');
    setError('');
  };

  return (
    <div className="w-full max-w-md space-y-6 sm:space-y-8">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-warm-900">Two-factor authentication</h2>
        <p className="mt-1.5 sm:mt-2 text-sm text-warm-500">
          {useRecovery
            ? 'Enter one of your recovery codes.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      </div>

      <div className="bg-white py-6 sm:py-8 px-5 sm:px-7 shadow-elevated rounded-2xl border border-warm-200">
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
          {error && <FormError message={error} />}

          {useRecovery ? (
            <Input
              label="Recovery code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="xxxxx-xxxxx"
              autoComplete="one-time-code"
              autoFocus
              required
            />
          ) : (
            <Input
              label="Authentication code"
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
          )}

          <Button type="submit" className="w-full h-11" loading={submitting} disabled={submitting}>
            {submitting ? 'Verifying...' : 'Verify'}
          </Button>
        </form>

        <div className="mt-5 sm:mt-6 text-center">
          <button
            type="button"
            onClick={toggleMode}
            className="text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code'}
          </button>
        </div>
      </div>
    </div>
  );
}
