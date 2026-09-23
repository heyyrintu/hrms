'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  attendancePolicyApi,
  AttendancePolicy,
} from '@/lib/api-attendance-policy';
import { CalendarX, RefreshCw, Save } from 'lucide-react';
import toast from 'react-hot-toast';

/** Form state is all strings: number inputs hand back strings anyway. */
interface PolicyForm {
  defaultShiftStart: string;
  defaultGraceMinutes: string;
  lateMarksPerHalfDay: string;
  autoMarkAbsent: boolean;
  absentIsLop: boolean;
  minHalfDayMinutes: string;
  minFullDayMinutes: string;
}

const emptyForm: PolicyForm = {
  defaultShiftStart: '09:00',
  defaultGraceMinutes: '15',
  lateMarksPerHalfDay: '',
  autoMarkAbsent: false,
  absentIsLop: true,
  minHalfDayMinutes: '240',
  minFullDayMinutes: '480',
};

function toForm(policy: AttendancePolicy): PolicyForm {
  return {
    defaultShiftStart: policy.defaultShiftStart,
    defaultGraceMinutes: String(policy.defaultGraceMinutes),
    // An empty box means "no penalty", which the API spells as null.
    lateMarksPerHalfDay:
      policy.lateMarksPerHalfDay == null ? '' : String(policy.lateMarksPerHalfDay),
    autoMarkAbsent: policy.autoMarkAbsent,
    absentIsLop: policy.absentIsLop,
    minHalfDayMinutes: String(policy.minHalfDayMinutes),
    minFullDayMinutes: String(policy.minFullDayMinutes),
  };
}

export default function AttendancePolicyPage() {
  const [form, setForm] = useState<PolicyForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [absentDate, setAbsentDate] = useState('');
  const [sweeping, setSweeping] = useState(false);

  useEffect(() => {
    loadPolicy();
  }, []);

  const loadPolicy = async () => {
    setLoading(true);
    try {
      const response = await attendancePolicyApi.get();
      setForm(toForm(response.data));
    } catch (error: any) {
      toast.error(
        error.response?.data?.message || 'Failed to load the attendance policy',
      );
    } finally {
      setLoading(false);
    }
  };

  const set = <K extends keyof PolicyForm>(key: K, value: PolicyForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.defaultShiftStart)) {
      toast.error('Default shift start must be a 24-hour HH:mm time');
      return;
    }

    setSaving(true);
    try {
      const response = await attendancePolicyApi.update({
        defaultShiftStart: form.defaultShiftStart,
        defaultGraceMinutes: Number(form.defaultGraceMinutes),
        lateMarksPerHalfDay:
          form.lateMarksPerHalfDay.trim() === ''
            ? null
            : Number(form.lateMarksPerHalfDay),
        autoMarkAbsent: form.autoMarkAbsent,
        absentIsLop: form.absentIsLop,
        minHalfDayMinutes: Number(form.minHalfDayMinutes),
        minFullDayMinutes: Number(form.minFullDayMinutes),
      });
      setForm(toForm(response.data));
      toast.success('Attendance policy saved');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to save the policy');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAbsent = async () => {
    if (!absentDate) {
      toast.error('Pick a date to sweep');
      return;
    }

    setSweeping(true);
    try {
      const response = await attendancePolicyApi.markAbsent(absentDate);
      const { marked, skipped } = response.data;
      toast.success(`Marked ${marked} absent, skipped ${skipped}`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to mark absentees');
    } finally {
      setSweeping(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900">
            Attendance Policy
          </h1>
          <p className="text-warm-500">
            Late marks, auto-absent and how absences hit payroll
          </p>
        </div>
        <Button variant="secondary" onClick={loadPolicy} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shift and late marks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-warm-500">Loading...</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Default shift start (HH:mm)"
                  value={form.defaultShiftStart}
                  placeholder="09:00"
                  onChange={(e) => set('defaultShiftStart', e.target.value)}
                />
                <Input
                  label="Grace minutes"
                  type="number"
                  min={0}
                  max={240}
                  value={form.defaultGraceMinutes}
                  onChange={(e) => set('defaultGraceMinutes', e.target.value)}
                />
              </div>
              <Input
                label="Late marks per half day (blank for none)"
                type="number"
                min={1}
                max={31}
                value={form.lateMarksPerHalfDay}
                placeholder="No penalty"
                onChange={(e) => set('lateMarksPerHalfDay', e.target.value)}
              />
              <p className="text-sm text-warm-500">
                Used only when an employee has no shift assignment. Every Nth late
                mark in a calendar month turns that day into a half day.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Absence handling</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.autoMarkAbsent}
              onChange={(e) => set('autoMarkAbsent', e.target.checked)}
            />
            <span>Mark missing days absent automatically each night</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.absentIsLop}
              onChange={(e) => set('absentIsLop', e.target.checked)}
            />
            <span>Absent days are loss of pay</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Minutes for a half day"
              type="number"
              min={0}
              max={1440}
              value={form.minHalfDayMinutes}
              onChange={(e) => set('minHalfDayMinutes', e.target.value)}
            />
            <Input
              label="Minutes for a full day"
              type="number"
              min={0}
              max={1440}
              value={form.minFullDayMinutes}
              onChange={(e) => set('minFullDayMinutes', e.target.value)}
            />
          </div>
          <p className="text-sm text-warm-500">
            Applied at clock-out to the day&apos;s net worked minutes: at least the
            full-day figure keeps the day present, at least the half-day figure makes
            it a half day, and less than that marks it absent. Set a figure to 0 to
            switch that rule off.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} loading={saving} disabled={loading}>
          <Save className="h-4 w-4 mr-2" />
          Save policy
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mark absentees for a past day</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-warm-500">
            Weekends, holidays, approved leave, approved comp-off and days that
            already have a record are left alone.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <Input
              label="Date"
              type="date"
              value={absentDate}
              onChange={(e) => setAbsentDate(e.target.value)}
            />
            <Button
              variant="secondary"
              onClick={handleMarkAbsent}
              loading={sweeping}
            >
              <CalendarX className="h-4 w-4 mr-2" />
              Mark absentees
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
