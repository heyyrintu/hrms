'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/salaryCalculations';
import { payrollDepthApi, RunReimbursements } from '@/lib/api-payroll-depth';
import { employeeName } from './shared';

/** Expense claims paid through this run (spec C4). Read-only. */
export function ReimbursementsTab({ runId }: { runId: string }) {
  const [data, setData] = useState<RunReimbursements | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await payrollDepthApi.getRunReimbursements(runId);
      setData(res.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-warm-500 py-4">Loading reimbursements…</p>;
  if (loadError || !data) {
    return (
      <div className="py-4 text-sm text-red-600">
        Failed to load reimbursements.{' '}
        <button type="button" onClick={load} className="underline">Retry</button>
      </div>
    );
  }
  if (!data.enabled) {
    return (
      <p className="text-sm text-warm-500 py-4">
        Reimbursing expenses through payroll is not enabled. Turn it on under Payroll settings to pay
        approved claims with salary.
      </p>
    );
  }
  if (data.claims.length === 0) {
    return <p className="text-sm text-warm-500 py-4">No approved expense claims for this run&apos;s employees.</p>;
  }

  const attached = data.claims.filter((c) => c.attached).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-warm-600">
        {attached} attached, {data.claims.length - attached} eligible · Total {formatCurrency(data.total)}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-200 bg-warm-50 text-xs uppercase text-warm-600">
              <th className="px-3 py-2 text-left">Employee</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">Expense date</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-100">
            {data.claims.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">
                  {employeeName(c.employee)}
                  <span className="block text-xs text-warm-500">{c.employee.employeeCode}</span>
                </td>
                <td className="px-3 py-2">{c.categoryName}</td>
                <td className="px-3 py-2">{c.expenseDate ? c.expenseDate.slice(0, 10) : '-'}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(c.amount)}</td>
                <td className="px-3 py-2">
                  <Badge variant={c.attached ? 'success' : 'gray'}>{c.attached ? 'Attached' : 'Eligible'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
