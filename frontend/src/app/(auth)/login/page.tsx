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
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-md space-y-8">
      {/* Logo & Title */}
      <div className="text-center">
        <div className="mx-auto h-12 w-12 rounded-xl bg-primary-600 flex items-center justify-center">
          <span className="text-white font-bold text-2xl">H</span>
        </div>
        <h2 className="mt-6 text-3xl font-bold tracking-tight text-gray-900">
          Sign in to HRMS
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Enter your credentials to access your account
        </p>
      </div>

      {/* Login Form */}
      <div className="bg-white py-8 px-6 shadow-lg rounded-lg">
        <form onSubmit={handleSubmit} className="space-y-6">
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
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />

          <Button
            type="submit"
            className="w-full"
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        {/* Demo accounts info */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center mb-3">Demo accounts (password: password123)</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 p-2 rounded">
              <p className="font-medium text-gray-700">HR Admin</p>
              <p className="text-gray-500">admin@example.com</p>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <p className="font-medium text-gray-700">Manager</p>
              <p className="text-gray-500">manager@example.com</p>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <p className="font-medium text-gray-700">Employee</p>
              <p className="text-gray-500">employee@example.com</p>
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <p className="font-medium text-gray-700">Contractor</p>
              <p className="text-gray-500">contractor@example.com</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
