'use client';

import { useCallback, useEffect, useState } from 'react';

import { payrollDepthApi, SalaryArrear } from '@/lib/api-payroll-depth';
import { ArrearsTable } from './ArrearsTable';

/**
 * Arrears included in this run. The list endpoint has no run filter, so the
 * tenant's arrears are filtered here by `payrollRun.id`.
 */
export function RunArrearsTab({ runId }: { runId: string }) {
  const [arrears, setArrears] = useState<SalaryArrear[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await payrollDepthApi.listArrears();
      setArrears((res.data ?? []).filter((a) => a.payrollRun?.id === runId));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-warm-500 py-4">Loading arrears…</p>;
  if (loadError) {
    return (
      <div className="py-4 text-sm text-red-600">
        Failed to load arrears.{' '}
        <button type="button" onClick={load} className="underline">Retry</button>
      </div>
    );
  }
  if (arrears.length === 0) {
    return <p className="text-sm text-warm-500 py-4">No arrears are included in this run.</p>;
  }
  return <ArrearsTable arrears={arrears} showRun={false} />;
}
