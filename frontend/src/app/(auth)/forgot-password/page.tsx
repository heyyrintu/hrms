'use client';

import { useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { Button, Input, FormError } from '@/components/ui';
import { passwordResetApi } from '@/lib/api-password-reset';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await passwordResetApi.forgotPassword({ email });
      // The API answers identically for a known and an unknown address, and so
      // does this screen: branching here would give the enumeration away.
      setSent(true);
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
      setError(
        typeof message === 'string'
          ? message
          : err instanceof Error
            ? err.message
            : 'Could not send the reset link. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-6 sm:space-y-8">
      <div className="text-center">
        <img
          src="/logo.png"
          alt="Drona Logitech"
          className="mx-auto h-12 sm:h-16 w-auto object-contain"
        />
        <h2 className="mt-4 sm:mt-6 text-2xl sm:text-3xl font-bold text-warm-900">
          Forgot your password?
        </h2>
        <p className="mt-1.5 sm:mt-2 text-sm text-warm-500">
          Enter your work email and we will send you a link to set a new one.
        </p>
      </div>

      <div className="bg-white py-6 sm:py-8 px-5 sm:px-7 shadow-elevated rounded-2xl border border-warm-200">
        {sent ? (
          <div className="space-y-3 text-center">
            <h3 className="text-lg font-semibold text-warm-900">Check your email</h3>
            <p className="text-sm text-warm-500">
              If an account exists for that address, a reset link is on its way.
              The link can be used once and expires in 60 minutes.
            </p>
            <p className="text-sm text-warm-400">
              Nothing arrived? Check your spam folder, or{' '}
              <button
                type="button"
                className="text-primary-600 hover:text-primary-700 font-medium"
                onClick={() => setSent(false)}
              >
                try a different address
              </button>
              .
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            {error && <FormError message={error} />}

            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />

            <Button
              type="submit"
              className="w-full h-11"
              loading={submitting}
              disabled={submitting}
            >
              {submitting ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>
        )}

        <div className="mt-5 sm:mt-7 pt-5 sm:pt-6 border-t border-warm-200 text-center">
          <Link
            href="/login"
            className="text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
