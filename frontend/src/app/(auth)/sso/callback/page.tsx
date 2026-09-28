'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { ssoApi } from '@/lib/api-security';
import { Spinner } from '@/components/ui';

/**
 * OIDC hands control back here with `#code=...` in the URL fragment (never
 * sent to any server or written to access logs). Trades it for a session and
 * lands on the dashboard. Owned by WS-3 (plan Task 3.6).
 *
 * The fragment is cleared with `history.replaceState` before the exchange
 * even starts, so a reload or back navigation after the code has already
 * been used finds nothing to resubmit and falls straight through to the
 * login page's error state instead of looping.
 */
export default function SsoCallbackPage() {
  const router = useRouter();
  const { completeSession } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const hash = window.location.hash;
    const code = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('code');

    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    if (!code) {
      router.replace('/login?sso_error=idp_error');
      return;
    }

    ssoApi
      .exchange(code)
      .then((response) => {
        completeSession(response.data);
        router.replace('/dashboard');
      })
      .catch(() => {
        router.replace('/login?sso_error=idp_error');
      });
    // Runs once on mount only: the fragment is only ever meaningful the first time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <Spinner />
      <p className="text-sm text-warm-500">Completing sign-in&hellip;</p>
    </div>
  );
}
