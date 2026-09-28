'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { recognitionApi, type EngagementSettings } from '@/lib/api-recognition';
import toast from 'react-hot-toast';

function errorMessage(err: unknown, fallback: string): string {
  const axiosError = err as { response?: { data?: { message?: string } } };
  return axiosError.response?.data?.message || fallback;
}

const defaults: EngagementSettings = {
  pointsEnabled: false,
  monthlyPointsAllowance: 100,
  showBirthdays: true,
  showAnniversaries: true,
};

/** HR: points toggle + allowance, and the feed's birthday/anniversary toggles. */
export function EngagementSettingsForm() {
  const [settings, setSettings] = useState<EngagementSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recognitionApi.getSettings();
      setSettings(res.data ?? defaults);
    } catch {
      toast.error('Failed to load engagement settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await recognitionApi.updateSettings(settings);
      setSettings(res.data ?? settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-warm-500">Loading settings…</p>;
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-warm-900">Points</p>
          <p className="text-sm text-warm-500">Let recognition carry points, spent from a monthly allowance</p>
        </div>
        <input
          type="checkbox"
          aria-label="Points enabled"
          checked={settings.pointsEnabled}
          onChange={(e) => setSettings({ ...settings, pointsEnabled: e.target.checked })}
          className="h-5 w-5"
        />
      </div>

      {settings.pointsEnabled && (
        <Input
          label="Monthly points allowance per employee"
          type="number"
          min={0}
          max={100000}
          value={settings.monthlyPointsAllowance}
          onChange={(e) =>
            setSettings({ ...settings, monthlyPointsAllowance: Number(e.target.value) || 0 })
          }
        />
      )}

      <div className="flex items-center justify-between">
        <p className="font-medium text-warm-900">Show birthdays on the feed</p>
        <input
          type="checkbox"
          aria-label="Show birthdays"
          checked={settings.showBirthdays}
          onChange={(e) => setSettings({ ...settings, showBirthdays: e.target.checked })}
          className="h-5 w-5"
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="font-medium text-warm-900">Show work anniversaries on the feed</p>
        <input
          type="checkbox"
          aria-label="Show work anniversaries"
          checked={settings.showAnniversaries}
          onChange={(e) => setSettings({ ...settings, showAnniversaries: e.target.checked })}
          className="h-5 w-5"
        />
      </div>

      <Button onClick={save} loading={saving}>
        Save Settings
      </Button>
    </div>
  );
}
