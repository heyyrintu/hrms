'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { payrollDepthApi } from '@/lib/api-payroll-depth';
import { EmployeeMultiSelect } from './EmployeeMultiSelect';
import { useEmployeeOptions } from './useEmployeeOptions';
import { MONTH_LONG, errorMessage } from './shared';

const MAX_REASON = 500;
const MAX_EMPLOYEES = 500;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Creates an OFF_CYCLE run (spec C5): a scoped run for a month, e.g. a missed
 * joiner's salary (`includeSalary`) or a bonus-only payout. Active and inactive
 * employees can be scoped, so the picker lists everyone.
 */
export function OffCycleRunDialog({ isOpen, onClose, onCreated }: Props) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [reason, setReason] = useState('');
  const [includeSalary, setIncludeSalary] = useState(false);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { employees, loading } = useEmployeeOptions(isOpen);

  useEffect(() => {
    if (!isOpen) {
      setReason('');
      setIncludeSalary(false);
      setEmployeeIds([]);
      setFormError(null);
    }
  }, [isOpen]);

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) return setFormError('Give a reason for this run');
    if (trimmed.length > MAX_REASON) return setFormError(`The reason can be at most ${MAX_REASON} characters`);
    if (employeeIds.length === 0) return setFormError('Choose at least one employee');
    if (employeeIds.length > MAX_EMPLOYEES) return setFormError(`At most ${MAX_EMPLOYEES} employees per run`);
    setFormError(null);
    setSaving(true);
    try {
      await payrollDepthApi.createOffCycleRun({ month, year, reason: trimmed, includeSalary, employeeIds });
      toast.success('Off-cycle run created');
      onCreated();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to create the off-cycle run'));
    } finally {
      setSaving(false);
    }
  };

  const thisYear = now.getFullYear();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New off-cycle run" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="offcycle-month" className="block text-sm font-medium text-warm-700 mb-1">Month</label>
            <select
              id="offcycle-month"
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
            >
              {MONTH_LONG.slice(1).map((name, i) => (
                <option key={name} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="offcycle-year" className="block text-sm font-medium text-warm-700 mb-1">Year</label>
            <select
              id="offcycle-year"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
            >
              {[thisYear, thisYear - 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="offcycle-reason" className="block text-sm font-medium text-warm-700 mb-1">Reason</label>
          <textarea
            id="offcycle-reason"
            value={reason}
            maxLength={MAX_REASON}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
            placeholder="e.g. Salary for a joiner missed in the regular run"
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-warm-700">
          <input
            type="checkbox"
            checked={includeSalary}
            onChange={(e) => setIncludeSalary(e.target.checked)}
            aria-label="Include the full month salary"
            className="mt-0.5"
          />
          <span>
            Include the full month salary
            <span className="block text-xs text-warm-500">
              Leave off for a run that only pays one-time payments, arrears, releases or settlements.
            </span>
          </span>
        </label>
        <div>
          <p className="block text-sm font-medium text-warm-700 mb-1">Employees</p>
          <EmployeeMultiSelect
            employees={employees}
            selected={employeeIds}
            onChange={setEmployeeIds}
            max={MAX_EMPLOYEES}
            loading={loading}
          />
        </div>
        {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={saving}>Create off-cycle run</Button>
      </ModalFooter>
    </Modal>
  );
}
