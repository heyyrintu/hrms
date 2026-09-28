'use client';

import { useEffect, useState } from 'react';
import { ssoApi } from '@/lib/api-security';
import { SsoProviderKey } from '@/types/security';

export interface SsoButtonsProps {
  /** Tenant code from /login?org=; null means the default tenant. */
  org: string | null;
  /** Reports the tenant's enabled providers and whether it is SSO-only. */
  onProviders?: (info: { providers: SsoProviderKey[]; requireSso: boolean }) => void;
}

const PROVIDER_LABEL: Record<SsoProviderKey, string> = {
  GOOGLE: 'Google',
  MICROSOFT: 'Microsoft',
};

/**
 * "Continue with Google / Microsoft" links for the login page. Built by
 * WS-3 (plan Task 3.6). Renders nothing until the tenant's providers are
 * known, and nothing at all when there are none or the lookup fails.
 */
export default function SsoButtons({ org, onProviders }: SsoButtonsProps) {
  const [providers, setProviders] = useState<SsoProviderKey[]>([]);

  useEffect(() => {
    let cancelled = false;

    ssoApi
      .providers(org)
      .then((response) => {
        if (cancelled) return;
        setProviders(response.data.providers);
        onProviders?.(response.data);
      })
      .catch(() => {
        if (cancelled) return;
        setProviders([]);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org]);

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <a
          key={provider}
          href={ssoApi.startUrl(provider, org)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-warm-200 bg-white px-4 py-2.5 text-sm font-medium text-warm-700 shadow-sm transition-colors hover:bg-warm-50"
        >
          Continue with {PROVIDER_LABEL[provider]}
        </a>
      ))}
    </div>
  );
}
