'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/salaryCalculations';
import { payrollDepthApi, PayrollRunStatus, SalaryHold } from '@/lib/api-payroll-depth';
import { ReleaseHoldDialog, VoidHoldDialog } from './HoldDialogs';
import { HoldStatusBadge } from './HoldStatusBadge';
import { employeeName, errorMessage, formatRunLabel } from './shared';
import type { RunContext, RunEmployee } from './types';

const HOLDABLE: PayrollRunStatus[] = ['DRAFT', 'COMPUTED', 'APPROVED'];
const RELEASABLE: PayrollRunStatus[] = ['APPROVED', 'PAID'];

interface Props {
  run: RunContext;
  holds: SalaryHold[];
  loading: boolean;
  loadError: boolean;
  employees: RunEmployee[];
  /** Refetch the run's holds (the page owns them, for the "Held" badges). */
  onChanged: () => void;
}

/** Salary holds of this run (spec C3): hold, unhold, release, void. */
export function HoldsTab({ run, holds, loading, loadError, employees, onChanged }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState<SalaryHold | null>(null);
  const [voiding, setVoiding] = useState<SalaryHold | null>(null);
  const canHold = HOLDABLE.includes(run.status);
  const heldIds = new Set(holds.map((h) => h.employee.id));
  const holdable = employees.filter((e) => !heldIds.has(e.id));

  const hold = async () => {
    const trimmed = reason.trim();
    if (!employeeId) return setFormError('Choose an employee');
    if (!trimmed) return setFormError('Give a reason for the hold');
    setFormError(null);
    setSaving(true);
    try {
      await payrollDepthApi.holdSalary(run.id, { employeeId, reason: trimmed });
      toast.success('Salary held');
      setEmployeeId('');
      setReason('');
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to hold the salary'));
    } finally {
      setSaving(false);
    }
  };

  const unhold = async (h: SalaryHold) => {
    if (!confirm(`Remove the hold on ${employeeName(h.employee)}'s salary?`)) return;
    try {
      await payrollDepthApi.unhold(h.id);
      toast.success('Hold removed');
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to remove the hold'));
    }
  };

  return (
    <div className="space-y-4">
      {canHold && (
        <div className="rounded-lg border border-warm-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-warm-900">Hold an employee&apos;s salary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label htmlFor="hold-employee" className="block text-xs font-medium text-warm-700 mb-1">Employee</label>
              <select
                id="hold-employee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
              >
                <option value="">Choose an employee</option>
                {holdable.map((e) => (
                  <option key={e.id} value={e.id}>
                    {employeeName(e)} ({e.employeeCode})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="hold-reason" className="block text-xs font-medium text-warm-700 mb-1">Reason</label>
              <input
                id="hold-reason"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <Button onClick={hold} loading={saving}>Hold salary</Button>
            </div>
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-warm-500 py-4">Loading holds…</p>
      ) : loadError ? (
        <div className="py-4 text-sm text-red-600">
          Failed to load holds.{' '}
          <button type="button" onClick={onChanged} className="underline">Retry</button>
        </div>
      ) : holds.length === 0 ? (
        <p className="text-sm text-warm-500 py-4">No salaries are held in this run.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-200 bg-warm-50 text-xs uppercase text-warm-600">
                <th className="px-3 py-2 text-left">Employee</th>
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
                        {run.status !== 'PAID' && (
                          <Button size="sm" variant="secondary" onClick={() => unhold(h)}>Unhold</Button>
                        )}
                        {RELEASABLE.includes(run.status) && (
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

      <ReleaseHoldDialog
        hold={releasing}
        onClose={() => setReleasing(null)}
        onDone={() => {
          setReleasing(null);
          onChanged();
        }}
      />
      <VoidHoldDialog
        hold={voiding}
        onClose={() => setVoiding(null)}
        onDone={() => {
          setVoiding(null);
          onChanged();
        }}
      />
    </div>
  );
}
