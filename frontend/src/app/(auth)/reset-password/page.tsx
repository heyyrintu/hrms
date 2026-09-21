'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Button, Input, FormError } from '@/components/ui';
import { passwordResetApi } from '@/lib/api-password-reset';

const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await passwordResetApi.resetPassword({ token, newPassword });
      toast.success('Password reset. Please sign in with your new password.');
      router.push('/login');
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
      setError(
        typeof message === 'string'
          ? message
          : err instanceof Error
            ? err.message
            : 'Could not reset your password. Please try again.',
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
          Choose a new password
        </h2>
        <p className="mt-1.5 sm:mt-2 text-sm text-warm-500">
          Setting a new password signs you out of every other device.
        </p>
      </div>

      <div className="bg-white py-6 sm:py-8 px-5 sm:px-7 shadow-elevated rounded-2xl border border-warm-200">
        {token ? (
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            {error && <FormError message={error} />}

            <Input
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              autoComplete="new-password"
            />

            <Input
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat the new password"
              required
              autoComplete="new-password"
            />

            <Button
              type="submit"
              className="w-full h-11"
              loading={submitting}
              disabled={submitting}
            >
              {submitting ? 'Resetting...' : 'Reset password'}
            </Button>
          </form>
        ) : (
          <div className="space-y-3 text-center">
            <h3 className="text-lg font-semibold text-warm-900">
              This link is incomplete
            </h3>
            <p className="text-sm text-warm-500">
              Open the link exactly as it appears in the email, or start again.
            </p>
            <Link
              href="/forgot-password"
              className="inline-block text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              Request a new link
            </Link>
          </div>
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

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary for this route to prerender.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
