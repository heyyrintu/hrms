'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import SsoProvidersTab from '@/components/security/SsoProvidersTab';
import SecurityPolicyTab from '@/components/security/SecurityPolicyTab';
import CustomRolesTab from '@/components/security/CustomRolesTab';
import SecurityUsersTab from '@/components/security/SecurityUsersTab';

const TABS = [
  { key: 'sso', label: 'Single sign-on', Component: SsoProvidersTab },
  { key: 'policy', label: 'Two-factor & sign-in', Component: SecurityPolicyTab },
  { key: 'roles', label: 'Custom roles', Component: CustomRolesTab },
  { key: 'users', label: 'Users', Component: SecurityUsersTab },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * Security administration (Keka wave H1). The /admin layout gate keeps this
 * page to SUPER_ADMIN and HR_ADMIN; custom roles never unlock it.
 */
function SecurityAdmin() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const active: TabKey = TABS.some((t) => t.key === requested) ? (requested as TabKey) : 'sso';
  const ActiveTab = TABS.find((t) => t.key === active)!.Component;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary-600" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold text-warm-900">Security</h1>
          <p className="text-sm text-warm-500">
            Single sign-on, two-factor authentication and custom roles for your organisation.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Security settings" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => router.replace(`${pathname}?tab=${t.key}`)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
              active === t.key
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-warm-200 bg-white text-warm-600 hover:bg-warm-50',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        <ActiveTab />
      </div>
    </div>
  );
}

export default function SecurityAdminPage() {
  // useSearchParams needs a Suspense boundary for this route to prerender.
  return (
    <Suspense fallback={null}>
      <SecurityAdmin />
    </Suspense>
  );
}
