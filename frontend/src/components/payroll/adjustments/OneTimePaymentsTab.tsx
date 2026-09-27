'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/lib/salaryCalculations';
import {
  EARNING_KINDS,
  ONE_TIME_KIND_LABELS,
  OneTimePayment,
  OneTimePaymentKind,
  payrollDepthApi,
} from '@/lib/api-payroll-depth';
import { EDITABLE_RUN_STATUSES, employeeName, errorMessage } from './shared';
import type { RunContext, RunEmployee } from './types';

const KINDS = Object.keys(ONE_TIME_KIND_LABELS) as OneTimePaymentKind[];

interface Props {
  run: RunContext;
  employees: RunEmployee[];
  /** Called after an add or delete, so the page can refetch the run (needsRecompute). */
  onInputsChanged: () => void;
}

interface FormState {
  employeeId: string;
  kind: OneTimePaymentKind;
  name: string;
  amount: string;
  taxable: boolean;
  note: string;
}

const emptyForm: FormState = { employeeId: '', kind: 'BONUS', name: '', amount: '', taxable: true, note: '' };

/** Bonuses, incentives and recoveries paid through this run (spec C2). */
export function OneTimePaymentsTab({ run, employees, onInputsChanged }: Props) {
  const [items, setItems] = useState<OneTimePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editable = EDITABLE_RUN_STATUSES.includes(run.status);
  const isEarning = EARNING_KINDS.includes(form.kind);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await payrollDepthApi.listOneTimePayments(run.id);
      setItems(res.data ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [run.id]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const name = form.name.trim();
    const amount = Number(form.amount);
    if (!form.employeeId) return setFormError('Choose an employee');
    if (!name || name.length > 100) return setFormError('Give a name of 1 to 100 characters');
    if (!Number.isFinite(amount) || amount <= 0) return setFormError('The amount must be greater than zero');
    setFormError(null);
    setSaving(true);
    try {
      await payrollDepthApi.createOneTimePayment(run.id, {
        employeeId: form.employeeId,
        kind: form.kind,
        name,
        amount,
        ...(isEarning ? { taxable: form.taxable } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
      toast.success('One-time payment added');
      setForm(emptyForm);
      await load();
      onInputsChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to add the payment'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: OneTimePayment) => {
    if (!confirm(`Delete "${item.name}" for ${employeeName(item.employee)}?`)) return;
    try {
      await payrollDepthApi.deleteOneTimePayment(item.id);
      toast.success('One-time payment deleted');
      await load();
      onInputsChanged();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to delete the payment'));
    }
  };

  return (
    <div className="space-y-4">
      {editable && (
        <div className="rounded-lg border border-warm-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-warm-900">Add a one-time payment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="otp-employee" className="block text-xs font-medium text-warm-700 mb-1">Employee</label>
              <select
                id="otp-employee"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
              >
                <option value="">Choose an employee</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {employeeName(e)} ({e.employeeCode})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="otp-kind" className="block text-xs font-medium text-warm-700 mb-1">Kind</label>
              <select
                id="otp-kind"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as OneTimePaymentKind })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>{ONE_TIME_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="otp-name" className="block text-xs font-medium text-warm-700 mb-1">Name</label>
              <input
                id="otp-name"
                value={form.name}
                maxLength={100}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input"
                placeholder="e.g. Diwali bonus"
              />
            </div>
            <div>
              <label htmlFor="otp-amount" className="block text-xs font-medium text-warm-700 mb-1">Amount</label>
              <input
                id="otp-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="input"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor="otp-note" className="block text-xs font-medium text-warm-700 mb-1">Note (optional)</label>
              <input
                id="otp-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="input"
              />
            </div>
            {isEarning && (
              <label className="flex items-center gap-2 text-sm text-warm-700 pb-2">
                <input
                  type="checkbox"
                  checked={form.taxable}
                  onChange={(e) => setForm({ ...form, taxable: e.target.checked })}
                />
                Taxable
              </label>
            )}
            <Button onClick={add} loading={saving}>Add payment</Button>
          </div>
          {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-warm-500 py-4">Loading one-time payments…</p>
      ) : loadError ? (
        <div className="py-4 text-sm text-red-600">
          Failed to load one-time payments.{' '}
          <button type="button" onClick={load} className="underline">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-warm-500 py-4">No one-time payments in this run.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-200 bg-warm-50 text-xs uppercase text-warm-600">
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Tax</th>
                <th className="px-3 py-2 text-left">Note</th>
                {editable && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    {employeeName(item.employee)}
                    <span className="block text-xs text-warm-500">{item.employee.employeeCode}</span>
                  </td>
                  <td className="px-3 py-2">{ONE_TIME_KIND_LABELS[item.kind] ?? item.kind}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className={`px-3 py-2 text-right ${item.isEarning ? 'text-emerald-700' : 'text-red-600'}`}>
                    {item.isEarning ? '' : '−'}
                    {formatCurrency(item.amount)}
                  </td>
                  <td className="px-3 py-2">
                    {item.isEarning ? (
                      <Badge variant={item.taxable ? 'info' : 'gray'}>{item.taxable ? 'Taxable' : 'Non-taxable'}</Badge>
                    ) : (
                      <Badge variant="gray">Deduction</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-warm-600">{item.note ?? '-'}</td>
                  {editable && (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remove(item)}
                        className="p-1.5 text-warm-400 hover:text-red-600 rounded-lg"
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
}
