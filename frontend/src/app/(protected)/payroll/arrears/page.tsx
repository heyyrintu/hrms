'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { History } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { payrollDepthApi, SalaryArrear, SalaryArrearStatus } from '@/lib/api-payroll-depth';
import { ArrearsTable } from '@/components/payroll/adjustments/ArrearsTable';
import { NotAuthorized } from '@/components/payroll/adjustments/NotAuthorized';
import { useEmployeeOptions } from '@/components/payroll/adjustments/useEmployeeOptions';
import {
  MONTH_SHORT,
  PAYROLL_ADMIN_ROLES,
  employeeName,
  errorMessage,
} from '@/components/payroll/adjustments/shared';

const STATUSES: SalaryArrearStatus[] = ['PENDING', 'INCLUDED', 'PAID', 'CANCELLED'];

/** Salary arrears from backdated revisions (spec C1): filter, detect, cancel. */
export default function SalaryArrearsPage() {
  const { hasRole } = useAuth();
  const allowed = hasRole(...PAYROLL_ADMIN_ROLES);
  return allowed ? <ArrearsView /> : <NotAuthorized />;
}

function ArrearsView() {
  const [arrears, setArrears] = useState<SalaryArrear[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<'' | SalaryArrearStatus>('');
  const [employeeId, setEmployeeId] = useState('');
  const [detectFor, setDetectFor] = useState('');
  const [detecting, setDetecting] = useState(false);
  const { employees } = useEmployeeOptions();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const params: { status?: SalaryArrearStatus; employeeId?: string } = {};
      if (status) params.status = status;
      if (employeeId) params.employeeId = employeeId;
      const res = await payrollDepthApi.listArrears(Object.keys(params).length ? params : undefined);
      setArrears(res.data ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [status, employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const detect = async () => {
    if (!detectFor) {
      toast.error('Choose an employee to detect arrears for');
      return;
    }
    setDetecting(true);
    try {
      const res = await payrollDepthApi.detectArrears(detectFor);
      const created = res.data?.created ?? 0;
      toast.success(created === 0 ? 'No new arrears found' : `${created} new arrear${created === 1 ? '' : 's'} detected`);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to detect arrears'));
    } finally {
      setDetecting(false);
    }
  };

  const cancel = async (a: SalaryArrear) => {
    if (!confirm(`Cancel the ${MONTH_SHORT[a.forMonth]} ${a.forYear} arrear for ${employeeName(a.employee)}?`)) return;
    try {
      await payrollDepthApi.cancelArrear(a.id);
      toast.success('Arrear cancelled');
      await load();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to cancel the arrear'));
    }
  };

  const employeeOptions = employees.map((e) => (
    <option key={e.id} value={e.id}>
      {employeeName(e)} ({e.employeeCode})
    </option>
  ));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
          <History className="w-7 h-7 text-primary-600" />
          Salary arrears
        </h1>
        <p className="text-warm-600 mt-1">
          Differences from backdated salary revisions, paid (or recovered) through the next run.
        </p>
      </div>

      <Card>
        <CardContent className="py-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem]">
              <label htmlFor="detect-employee" className="block text-xs font-medium text-warm-700 mb-1">
                Detect for employee
              </label>
              <select
                id="detect-employee"
                value={detectFor}
                onChange={(e) => setDetectFor(e.target.value)}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
              >
                <option value="">Choose an employee</option>
                {employeeOptions}
              </select>
            </div>
            <Button onClick={detect} loading={detecting}>Detect arrears</Button>
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t border-warm-100 pt-4">
            <div>
              <label htmlFor="arrear-status" className="block text-xs font-medium text-warm-700 mb-1">Status</label>
              <select
                id="arrear-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as '' | SalaryArrearStatus)}
                className="px-3 py-2 border border-warm-300 rounded-lg text-sm"
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[14rem]">
              <label htmlFor="arrear-employee" className="block text-xs font-medium text-warm-700 mb-1">
                Filter by employee
              </label>
              <select
                id="arrear-employee"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm"
              >
                <option value="">All employees</option>
                {employeeOptions}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        {loading ? (
          <p className="p-6 text-sm text-warm-500">Loading arrears…</p>
        ) : loadError ? (
          <div className="p-6 text-sm text-red-600">
            Failed to load arrears.{' '}
            <button type="button" onClick={load} className="underline">Retry</button>
          </div>
        ) : arrears.length === 0 ? (
          <p className="p-6 text-sm text-warm-500">No arrears match these filters.</p>
        ) : (
          <ArrearsTable arrears={arrears} onCancel={cancel} />
        )}
      </Card>
    </div>
  );
}
