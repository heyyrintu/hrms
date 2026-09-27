'use client';

import { useCallback, useEffect, useState } from 'react';
import { PauseCircle } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/salaryCalculations';
import { payrollDepthApi, PayrollRunStatus, SalaryHold, SalaryHoldStatus } from '@/lib/api-payroll-depth';
import { ReleaseHoldDialog, VoidHoldDialog } from '@/components/payroll/adjustments/HoldDialogs';
import { HoldStatusBadge } from '@/components/payroll/adjustments/HoldStatusBadge';
import { NotAuthorized } from '@/components/payroll/adjustments/NotAuthorized';
import {
  PAYROLL_ADMIN_ROLES,
  employeeName,
  formatRunLabel,
} from '@/components/payroll/adjustments/shared';

const STATUSES: SalaryHoldStatus[] = ['HELD', 'RELEASED', 'VOIDED'];
/** A held salary can be released once the run it was held in is approved or paid (spec C3). */
const RELEASABLE: PayrollRunStatus[] = ['APPROVED', 'PAID'];

/** Salary holds across runs: release into a later run, or void. */
export default function SalaryHoldsPage() {
  const { hasRole } = useAuth();
  const allowed = hasRole(...PAYROLL_ADMIN_ROLES);
  return allowed ? <HoldsView /> : <NotAuthorized />;
}

function HoldsView() {
  const [holds, setHolds] = useState<SalaryHold[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<'' | SalaryHoldStatus>('');
  const [releasing, setReleasing] = useState<SalaryHold | null>(null);
  const [voiding, setVoiding] = useState<SalaryHold | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await payrollDepthApi.listHolds(status || undefined);
      setHolds(res.data ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
            <PauseCircle className="w-7 h-7 text-primary-600" />
            Salary holds
          </h1>
          <p className="text-warm-600 mt-1">Salaries withheld from a run, and where they were released.</p>
        </div>
        <div>
          <label htmlFor="hold-status" className="block text-xs font-medium text-warm-700 mb-1">Status</label>
          <select
            id="hold-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | SalaryHoldStatus)}
            className="px-3 py-2 border border-warm-300 rounded-lg text-sm"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        {loading ? (
          <p className="p-6 text-sm text-warm-500">Loading holds…</p>
        ) : loadError ? (
          <div className="p-6 text-sm text-red-600">
            Failed to load holds.{' '}
            <button type="button" onClick={load} className="underline">Retry</button>
          </div>
        ) : holds.length === 0 ? (
          <CardContent className="py-10 text-center text-sm text-warm-500">
            No salary holds match this filter.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-warm-200 bg-warm-50 text-xs uppercase text-warm-600">
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-left">Held in</th>
                  <th className="px-3 py-2 text-left">Reason</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Held amount</th>
                  <th className="px-3 py-2 text-left">Released into</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100">
                {holds.map((h) => (
                  <tr key={h.id}>
                    <td className="px-3 py-2">
                      {employeeName(h.employee)}
                      <span className="block text-xs text-warm-500">{h.employee.employeeCode}</span>
                    </td>
                    <td className="px-3 py-2">{formatRunLabel(h.payrollRun)}</td>
                    <td className="px-3 py-2 text-warm-700">
                      {h.reason}
                      {h.voidReason && <span className="block text-xs text-warm-500">Void: {h.voidReason}</span>}
                    </td>
                    <td className="px-3 py-2"><HoldStatusBadge status={h.status} /></td>
                    <td className="px-3 py-2 text-right">{h.heldAmount != null ? formatCurrency(h.heldAmount) : '-'}</td>
                    <td className="px-3 py-2">{h.releaseRun ? formatRunLabel(h.releaseRun) : '-'}</td>
                    <td className="px-3 py-2">
                      {h.status === 'HELD' && (
                        <div className="flex justify-end gap-2">
                          {RELEASABLE.includes(h.payrollRun.status) && (
                            <Button size="sm" variant="secondary" onClick={() => setReleasing(h)}>Release</Button>
                          )}
                          <Button size="sm" variant="danger" onClick={() => setVoiding(h)}>Void</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ReleaseHoldDialog
        hold={releasing}
        onClose={() => setReleasing(null)}
        onDone={() => {
          setReleasing(null);
          load();
        }}
      />
      <VoidHoldDialog
        hold={voiding}
        onClose={() => setVoiding(null)}
        onDone={() => {
          setVoiding(null);
          load();
        }}
      />
    </div>
  );
}
