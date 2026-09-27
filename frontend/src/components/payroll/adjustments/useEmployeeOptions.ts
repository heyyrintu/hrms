'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { employeesApi } from '@/lib/api';
import type { EmployeeRef } from '@/lib/api-payroll-depth';
import { unwrapList } from './shared';

export interface EmployeeOption extends EmployeeRef {
  status?: string;
}

/**
 * Loads the tenant's employees once for a picker. `enabled` defers the request
 * until the picker is actually shown (a dialog that is closed costs nothing).
 */
export function useEmployeeOptions(enabled = true, status?: 'ACTIVE') {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const params: Record<string, unknown> = { limit: 1000 };
        if (status) params.status = status;
        const res = await employeesApi.getAll(params);
        if (cancelled) return;
        setEmployees(unwrapList<EmployeeOption>(res?.data));
        setLoaded(true);
      } catch {
        if (!cancelled) toast.error('The employee list could not be loaded');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, loaded, status]);

  return { employees, loading };
}
