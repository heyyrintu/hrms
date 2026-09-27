'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Settings } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { payrollDepthApi, PayrollSettings } from '@/lib/api-payroll-depth';
import { NotAuthorized } from '@/components/payroll/adjustments/NotAuthorized';
import { PAYROLL_ADMIN_ROLES, errorMessage } from '@/components/payroll/adjustments/shared';

/** Tenant payroll switches (Keka wave C): reimbursements through payroll, auto arrears. */
export default function PayrollSettingsPage() {
  const { hasRole } = useAuth();
  const allowed = hasRole(...PAYROLL_ADMIN_ROLES);
  return allowed ? <SettingsView /> : <NotAuthorized />;
}

function SettingsView() {
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await payrollDepthApi.getSettings();
      setSettings(res.data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await payrollDepthApi.updateSettings({
        reimburseExpensesViaPayroll: settings.reimburseExpensesViaPayroll,
        autoArrears: settings.autoArrears,
      });
      if (res?.data) setSettings(res.data);
      toast.success('Payroll settings saved');
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to save payroll settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
          <Settings className="w-7 h-7 text-primary-600" />
          Payroll settings
        </h1>
        <p className="text-warm-600 mt-1">How payroll runs pick up expenses and salary revisions.</p>
      </div>

      <Card>
        <CardContent className="py-5">
          {loading ? (
            <p className="text-sm text-warm-500">Loading settings…</p>
          ) : loadError || !settings ? (
            <div className="text-sm text-red-600">
              Failed to load payroll settings.{' '}
              <button type="button" onClick={load} className="underline">Retry</button>
            </div>
          ) : (
            <div className="space-y-5">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={settings.reimburseExpensesViaPayroll}
                  onChange={(e) => setSettings({ ...settings, reimburseExpensesViaPayroll: e.target.checked })}
                  aria-label="Reimburse approved expenses through payroll"
                />
                <span>
                  <span className="block text-sm font-medium text-warm-900">
                    Reimburse approved expenses through payroll
                  </span>
                  <span className="block text-sm text-warm-500">
                    Approved expense claims are added to the next run as a non-taxable line and marked
                    reimbursed when the run is paid. When off, claims are reimbursed by hand.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={settings.autoArrears}
                  onChange={(e) => setSettings({ ...settings, autoArrears: e.target.checked })}
                  aria-label="Detect arrears automatically"
                />
                <span>
                  <span className="block text-sm font-medium text-warm-900">Detect arrears automatically</span>
                  <span className="block text-sm text-warm-500">
                    Processing a regular run detects arrears from backdated salary revisions for its
                    employees. Detection can always be run by hand from Salary arrears.
                  </span>
                </span>
              </label>
              <div className="flex justify-end">
                <Button onClick={save} loading={saving}>Save settings</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
