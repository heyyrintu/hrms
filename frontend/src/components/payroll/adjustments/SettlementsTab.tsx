'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/salaryCalculations';
import { EmployeeRef, payrollDepthApi } from '@/lib/api-payroll-depth';
import { EDITABLE_RUN_STATUSES, employeeName, errorMessage } from './shared';
import type { RunContext } from './types';

/**
 * A full-and-final settlement row of `GET /payroll/runs/:id/settlements`.
 *
 * Defined here because the frozen client (`lib/api-payroll-depth.ts`) has
 * attach/detach but no list call; the backend adds the list route for this tab.
 */
export interface RunSettlementRow {
  id: string;
  employee: EmployeeRef;
  status: string;
  netPayable: number;
  lastWorkingDate: string;
  payrollRunId: string | null;
}

export interface RunSettlements {
  attached: RunSettlementRow[];
  eligible: RunSettlementRow[];
}

export const listRunSettlements = (runId: string) =>
  api.get<RunSettlements>(`/payroll/runs/${runId}/settlements`);

interface Props {
  run: RunContext;
  onInputsChanged: () => void;
}

/** Settlements paid through an off-cycle run (spec C5). */
export function SettlementsTab({ run, onInputsChanged }: Props) {
  const [data, setData] = useState<RunSettlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const editable = EDITABLE_RUN_STATUSES.includes(run.status);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await listRunSettlements(run.id);
      setData({ attached: res.data?.attached ?? [], eligible: res.data?.eligible ?? [] });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [run.id]);

  useEffect(() => {
    load();
  }, [load]);

  const attach = async (row: RunSettlementRow) => {
    setBusy(row.id);
    try {
      await payrollDepthApi.attachSettlement(run.id, row.id);
      toast.success('Settlement attached');
      await load();
      onInputsChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to attach the settlement'));
    } finally {
      setBusy(null);
    }
  };

  const detach = async (row: RunSettlementRow) => {
    if (!confirm(`Detach ${employeeName(row.employee)}'s settlement from this run?`)) return;
    setBusy(row.id);
    try {
      await payrollDepthApi.detachSettlement(run.id, row.id);
      toast.success('Settlement detached');
      await load();
      onInputsChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to detach the settlement'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="text-sm text-warm-500 py-4">Loading settlements…</p>;
  if (loadError || !data) {
    return (
      <div className="py-4 text-sm text-red-600">
        Failed to load settlements.{' '}
        <button type="button" onClick={load} className="underline">Retry</button>
      </div>
    );
  }

  const section = (title: string, rows: RunSettlementRow[], action: 'attach' | 'detach') => (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-warm-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-warm-500">
          {action === 'detach' ? 'No settlements are paid through this run.' : 'No approved settlements waiting for payment.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-200 bg-warm-50 text-xs uppercase text-warm-600">
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Last working day</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Net payable</th>
                {editable && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    {employeeName(r.employee)}
                    <span className="block text-xs text-warm-500">{r.employee.employeeCode}</span>
                  </td>
                  <td className="px-3 py-2">{r.lastWorkingDate ? r.lastWorkingDate.slice(0, 10) : '-'}</td>
                  <td className="px-3 py-2"><Badge variant="gray">{r.status}</Badge></td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.netPayable)}</td>
                  {editable && (
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy === r.id}
                        onClick={() => (action === 'attach' ? attach(r) : detach(r))}
                      >
                        {action === 'attach' ? 'Attach' : 'Detach'}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {section('Paid through this run', data.attached, 'detach')}
      {editable && section('Eligible settlements', data.eligible, 'attach')}
    </div>
  );
}
