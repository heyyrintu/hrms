'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { Button, Input, FormError } from '@/components/ui';
import SsoButtons from '@/components/auth/SsoButtons';
import MfaCodeStep from '@/components/auth/MfaCodeStep';
import TotpEnrolment from '@/components/auth/TotpEnrolment';
import RecoveryCodes from '@/components/auth/RecoveryCodes';
import { AuthResponse } from '@/types';

// Demo credentials are a development affordance only. NODE_ENV is inlined by
// Next at build time, so a production build drops this block entirely.
const showDemoAccounts = process.env.NODE_ENV !== 'production';

/** Plain-English messages for the sso_error codes the SSO callback redirects with (spec §3.3). */
const SSO_ERROR_MESSAGES: Record<string, string> = {
  invalid_state: 'Your sign-in attempt expired or was already used. Please try again.',
  provider_disabled: 'Single sign-on is not available for your organisation.',
  idp_error: 'We could not complete sign-in with your identity provider. Please try again.',
  email_unverified: 'Your identity provider has not verified your email address.',
  domain_not_allowed: 'Your email domain is not allowed to sign in this way.',
  wrong_directory: 'Your account belongs to a different organisation directory.',
  identity_conflict: 'This sign-in identity is already linked to a different account.',
  no_account: 'No account was found for your email address.',
  account_inactive: 'Your account is inactive. Contact your administrator.',
};

/** The login page's own state machine, driven by what /auth/login returns. */
type Step =
  | { name: 'password' }
  | { name: 'mfa'; mfaToken: string }
  | { name: 'enrol-setup'; enrolToken: string }
  | { name: 'enrol-codes'; recoveryCodes: string[]; session: AuthResponse };

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const org = searchParams.get('org');
  const ssoError = searchParams.get('sso_error');

  const { login, completeSession, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [requireSso, setRequireSso] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (ssoError) {
      setError(SSO_ERROR_MESSAGES[ssoError] ?? 'Sign-in failed. Please try again.');
    }
  }, [ssoError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const outcome = await login(email, password, org);
      if (outcome.status === 'mfa') {
        setStep({ name: 'mfa', mfaToken: outcome.mfaToken });
      } else if (outcome.status === 'enrol') {
        setStep({ name: 'enrol-setup', enrolToken: outcome.enrolToken });
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
      setError(
        typeof message === 'string'
          ? message
          : err instanceof Error
            ? err.message
            : 'Login failed. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (step.name === 'mfa') {
    return (
      <MfaCodeStep
        mfaToken={step.mfaToken}
        onSuccess={(session) => {
          completeSession(session);
          router.push('/dashboard');
        }}
        onBack={() => {
          setStep({ name: 'password' });
          setError('Too many attempts — sign in again');
        }}
      />
    );
  }

  if (step.name === 'enrol-setup') {
    return (
      <TotpEnrolment
        enrolToken={step.enrolToken}
        onEnabled={(result) =>
          setStep({
            name: 'enrol-codes',
            recoveryCodes: result.recoveryCodes,
            session: result.session,
          })
        }
      />
    );
  }

  if (step.name === 'enrol-codes') {
    return (
      <RecoveryCodes
        codes={step.recoveryCodes}
        onContinue={() => {
          completeSession(step.session);
          router.push('/dashboard');
        }}
      />
    );
  }

  return (
    <div className="w-full max-w-md space-y-6 sm:space-y-8">
      {/* Logo & Title */}
      <div className="text-center">
        <img
          src="/logo.png"
          alt="Drona Logitech"
          className="mx-auto h-12 sm:h-16 w-auto object-contain"
        />
        <h2 className="mt-4 sm:mt-6 text-2xl sm:text-3xl font-bold text-warm-900">
          Welcome back
        </h2>
        <p className="mt-1.5 sm:mt-2 text-sm text-warm-500">
          Sign in to your HRMS workspace
        </p>
      </div>

      {/* Login Form */}
      <div className="bg-white py-6 sm:py-8 px-5 sm:px-7 shadow-elevated rounded-2xl border border-warm-200 space-y-5">
        <SsoButtons
          org={org}
          onProviders={(info) => setRequireSso(info.requireSso)}
        />

        {(!requireSso || showPasswordForm) && (
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

            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
            />

            <div className="flex justify-end -mt-1">
              <Link
                href="/forgot-password"
                className="text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                Forgot password?
              </Link>
            </div>

            <Button
              type="submit"
              className="w-full h-11"
              loading={submitting}
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        )}

        {requireSso && !showPasswordForm && (
          <>
            {error && <FormError message={error} />}
            <div className="text-center">
              <button
                type="button"
                onClick={() => setShowPasswordForm(true)}
                className="text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                Sign in with password (administrators)
              </button>
            </div>
          </>
        )}

        {/* Demo accounts info. Build-time gated: a production build must not
            hand every visitor working HR Admin credentials. */}
        {showDemoAccounts && (!requireSso || showPasswordForm) && (
          <div className="mt-5 sm:mt-7 pt-5 sm:pt-6 border-t border-warm-200">
            <p className="text-xs text-warm-400 text-center mb-2 sm:mb-3 font-medium uppercase tracking-wider">Demo accounts</p>
            <p className="text-[11px] text-warm-400 text-center mb-2 sm:mb-3">password: password123</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { role: 'HR Admin', email: 'admin@example.com' },
                { role: 'Manager', email: 'manager@example.com' },
                { role: 'Employee', email: 'employee@example.com' },
                { role: 'Contractor', email: 'contractor@example.com' },
              ].map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => setEmail(account.email)}
                  className="bg-warm-50 hover:bg-warm-100 border border-warm-200 p-2 sm:p-2.5 rounded-lg text-left transition-colors group active:scale-[0.98]"
                >
                  <p className="font-semibold text-xs text-warm-700 group-hover:text-warm-900">{account.role}</p>
                  <p className="text-[10px] sm:text-[11px] text-warm-400 truncate">{account.email}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for this route to prerender.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
