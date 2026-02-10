'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button, Input, FormError } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login({ email, password });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
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

  return (
    <div className="w-full max-w-md space-y-8">
      {/* Logo & Title */}
      <div className="text-center">
        <img
          src="/logo.png"
          alt="Drona Logitech"
          className="mx-auto h-16 w-auto object-contain"
        />
        <h2 className="mt-6 text-3xl font-bold text-warm-900">
          Welcome back
        </h2>
        <p className="mt-2 text-sm text-warm-500">
          Sign in to your HRMS workspace
        </p>
      </div>

      {/* Login Form */}
      <div className="bg-white py-8 px-7 shadow-elevated rounded-2xl border border-warm-200">
        <form onSubmit={handleSubmit} className="space-y-5">
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

          <Button
            type="submit"
            className="w-full h-11"
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        {/* Demo accounts info */}
        <div className="mt-7 pt-6 border-t border-warm-200">
          <p className="text-xs text-warm-400 text-center mb-3 font-medium uppercase tracking-wider">Demo accounts</p>
          <p className="text-[11px] text-warm-400 text-center mb-3">password: password123</p>
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
                className="bg-warm-50 hover:bg-warm-100 border border-warm-200 p-2.5 rounded-lg text-left transition-colors group"
              >
                <p className="font-semibold text-xs text-warm-700 group-hover:text-warm-900">{account.role}</p>
                <p className="text-[11px] text-warm-400 truncate">{account.email}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
