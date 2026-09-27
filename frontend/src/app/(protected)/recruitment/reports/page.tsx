'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { recruitmentApi, type FunnelReport, type JobOpening } from '@/lib/api-recruitment';

function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)}%`;
}

function days(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}d`;
}

/** Hiring funnel report: reach/conversion per stage, headline totals, and source mix. */
export default function RecruitmentReportsPage() {
  const { hasRole } = useAuth();
  const isManager = hasRole(UserRole.MANAGER) && !hasRole(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN);

  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [jobOpeningId, setJobOpeningId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<FunnelReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    recruitmentApi
      .listOpenings()
      .then((res) => setOpenings(res.data ?? []))
      .catch(() => toast.error('Failed to load job openings'));
  }, []);

  const load = useCallback(async () => {
    if (isManager && !jobOpeningId) {
      setReport(null);
      return;
    }
    setLoading(true);
    try {
      const res = await recruitmentApi.funnel({
        jobOpeningId: jobOpeningId || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setReport(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load the funnel report'));
    } finally {
      setLoading(false);
    }
  }, [isManager, jobOpeningId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const maxReached = report?.stages.reduce((max, s) => Math.max(max, s.reached), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900">Hiring funnel</h1>
          <p className="text-sm text-warm-500">Reach and conversion through each stage, and where hires come from.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
          <Select
            label={isManager ? 'Job opening (required)' : 'Job opening (all if blank)'}
            value={jobOpeningId}
            onChange={(e) => setJobOpeningId(e.target.value)}
            options={[{ value: '', label: 'All openings' }, ...openings.map((o) => ({ value: o.id, label: o.title }))]}
          />
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </CardContent>
      </Card>

      {isManager && !jobOpeningId ? (
        <p className="rounded-xl border border-warm-200 bg-white p-6 text-center text-sm text-warm-500">
          Choose one of your job openings to see its funnel.
        </p>
      ) : loading ? (
        <p className="text-sm text-warm-500">Loading report…</p>
      ) : !report ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ['Applied', report.totals.applied],
              ['Hired', report.totals.hired],
              ['Rejected', report.totals.rejected],
              ['Withdrawn', report.totals.withdrawn],
              ['Offers sent', report.totals.offersSent],
              ['Offer acceptance', pct(report.totals.offerAcceptanceRate)],
              ['Avg. time to hire', days(report.totals.avgTimeToHireDays)],
            ].map(([label, value]) => (
              <Card key={label as string}>
                <CardContent className="p-4">
                  <p className="text-xs uppercase tracking-wide text-warm-500">{label}</p>
                  <p className="mt-1 text-xl font-semibold text-warm-900">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Stage funnel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {report.stages.length === 0 ? (
                <p className="text-sm text-warm-500">No active stages configured.</p>
              ) : (
                report.stages.map((stage) => (
                  <div key={stage.stageId}>
                    <div className="mb-1 flex items-baseline justify-between text-sm">
                      <span className="font-medium text-warm-900">{stage.name}</span>
                      <span className="text-warm-500">
                        Reached {stage.reached} · Current {stage.current}
                        {stage.conversionFromPrevious !== null && ` · ${pct(stage.conversionFromPrevious)} of previous`}
                        {stage.avgDaysInStage !== null && ` · ${days(stage.avgDaysInStage)} avg`}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-warm-100">
                      <div
                        className="h-2 rounded-full bg-primary-500"
                        style={{ width: maxReached > 0 ? `${(stage.reached / maxReached) * 100}%` : '0%' }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Applications by source</CardTitle>
            </CardHeader>
            <CardContent>
              {report.bySource.length === 0 ? (
                <p className="text-sm text-warm-500">No applications in this window.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {report.bySource.map((row) => (
                    <li key={row.source} className="flex items-center justify-between">
                      <span className="text-warm-700">{row.source}</span>
                      <span className="font-medium text-warm-900">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
