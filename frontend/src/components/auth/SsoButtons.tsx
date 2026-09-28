'use client';

import { SsoProviderKey } from '@/types/security';

export interface SsoButtonsProps {
  /** Tenant code from /login?org=; null means the default tenant. */
  org: string | null;
  /** Reports the tenant's enabled providers and whether it is SSO-only. */
  onProviders?: (info: { providers: SsoProviderKey[]; requireSso: boolean }) => void;
}

/**
 * "Continue with Google / Microsoft" links for the login page.
 * Built by WS-3 (plan Task 3.6); the scaffold renders nothing.
 */
export default function SsoButtons(_props: SsoButtonsProps) {
  return null;
}
