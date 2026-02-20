'use client';

import { ErrorBoundary, FallbackProps } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  return (
    <div className="flex min-h-screen items-center justify-center bg-warm-50 p-4">
      <div className="w-full max-w-sm sm:max-w-md rounded-2xl bg-white p-6 sm:p-8 shadow-elevated border border-warm-200 text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-red-50 flex items-center justify-center ring-1 ring-red-200">
          <svg className="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-lg sm:text-xl font-semibold text-warm-900 mb-2">Something went wrong</h2>
        <p className="text-warm-500 text-sm mb-6">{message}</p>
        <button
          onClick={resetErrorBoundary}
          className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 shadow-soft transition-all active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function ErrorBoundaryWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}
