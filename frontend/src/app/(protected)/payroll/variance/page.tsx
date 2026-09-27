'use client';

/**
 * Payroll variance report (Keka wave C, WS-C2): this run against a previous
 * one, per employee and per component. The role gate lives in the /payroll
 * layout, so there is none here.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Download, RefreshCw, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { payrollApi } from '@/lib/api';
import { payrollAccountingApi, VarianceEmployeeStatus, VarianceReport } from '@/lib/api-payroll-accounting';
import { downloadBlob, formatMoney, formatPct, monthLabel } from '@/components/payroll/accounting/money';

const serverMessage = (error: unknown, fallback: string): string =>
  (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

interface RunOption {
  id: string;
  month: number;
  year: number;
  runType: 'REGULAR' | 'OFF_CYCLE';
  sequence: number;
  status: string;
}

const statusVariants: Record<VarianceEmployeeStatus, 'success' | 'danger' | 'warning' | 'gray'> = {
  NEW: 'success',
  LEFT: 'danger',
  CHANGED: 'warning',
  UNCHANGED: 'gray',
};

export default function PayrollVariancePage() {
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [runId, setRunId] = useState('');
  const [compareRunId, setCompareRunId] = useState('');
  const [thresholdPct, setThresholdPct] = useState('10');

  const [report, setReport] = useState<VarianceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoadingRuns(true);
      try {
        const response = await payrollApi.getRuns();
        const runList = (response.data ?? []) as RunOption[];
        setRuns(runList);
        if (runList.length > 0) setRunId((current) => current || runList[0].id);
      } catch (error) {
        toast.error(serverMessage(error, 'The list of payroll runs could not be loaded.'));
      } finally {
        setLoadingRuns(false);
      }
    })();
  }, []);

  const runOptions = useMemo(
    () =>
      runs.map((run) => ({
        value: run.id,
        label: `${monthLabel(run.month, run.year)}${run.runType === 'OFF_CYCLE' ? ` · Off-cycle #${run.sequence}` : ''}`,
      })),
    [runs],
  );
  const compareOptions = useMemo(
    () => [{ value: '', label: 'Previous month (default)' }, ...runOptions.filter((o) => o.value !== runId)],
    [runOptions, runId],
  );

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const parsedThreshold = Number(thresholdPct);
      const response = await payrollAccountingApi.getVariance({
        runId,
        compareRunId: compareRunId || undefined,
        thresholdPct: Number.isFinite(parsedThreshold) ? parsedThreshold : undefined,
      });
      setReport(response.data);
    } catch (error) {
      setReport(null);
      toast.error(serverMessage(error, 'The variance report could not be built.'));
    } finally {
      setLoading(false);
    }
  }, [runId, compareRunId, thresholdPct]);

  useEffect(() => {
    void load();
  }, [load]);

  const employees = useMemo(
    () => (report ? (flaggedOnly ? report.employees.filter((e) => e.flagged) : report.employees) : []),
    [report, flaggedOnly],
  );

  const toggleExpanded = (employeeId: string) =>
    setExpanded((current) => ({ ...current, [employeeId]: !current[employeeId] }));

  const handleDownload = async () => {
    if (!runId) return;
    setDownloading(true);
    try {
      const parsedThreshold = Number(thresholdPct);
      const response = await payrollAccountingApi.exportVariance({
        runId,
        compareRunId: compareRunId || undefined,
        thresholdPct: Number.isFinite(parsedThreshold) ? parsedThreshold : undefined,
      });
      const run = runs.find((r) => r.id === runId);
      const stamp = run ? `${run.year}-${String(run.month).padStart(2, '0')}` : runId;
      downloadBlob(response.data as Blob, `variance-${stamp}.csv`);
    } catch (error) {
      toast.error(serverMessage(error, 'The variance report could not be exported.'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-warm-900 sm:text-2xl">
            <TrendingUp className="h-6 w-6 text-primary-600" aria-hidden="true" />
            Payroll variance
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-warm-600">
            Compare a payroll run against a previous one to see who is new, who left, and what changed for
            everyone still on it.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading || loadingRuns}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Payroll run"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            options={runOptions}
            placeholder={loadingRuns ? 'Loading...' : 'No payroll runs yet'}
          />
          <Select
            label="Compare against"
            value={compareRunId}
            onChange={(e) => setCompareRunId(e.target.value)}
            options={compareOptions}
          />
          <Input
            label="Flag threshold (%)"
            inputMode="decimal"
            value={thresholdPct}
            onChange={(e) => setThresholdPct(e.target.value)}
          />
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <TotalCard label="Gross" amount={report.totals.gross} />
            <TotalCard label="Deductions" amount={report.totals.deductions} />
            <TotalCard label="Net" amount={report.totals.net} />
            <div className="rounded-lg border border-warm-200 p-3">
              <p className="text-xs uppercase text-warm-500">Headcount</p>
              <p className="text-lg font-semibold text-warm-900">
                {report.totals.headcount.current}
                <span className="ml-1 text-sm font-normal text-warm-500">
                  (was {report.totals.headcount.previous})
                </span>
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-warm-900">
                  Employees ({employees.length}
                  {flaggedOnly ? ` of ${report.employees.length}` : ''})
                </h2>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-warm-700">
                    <input
                      type="checkbox"
                      checked={flaggedOnly}
                      onChange={(e) => setFlaggedOnly(e.target.checked)}
                      className="h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500/20"
                    />
                    Flagged only
                  </label>
                  <Button variant="secondary" size="sm" onClick={() => void handleDownload()} loading={downloading}>
                    <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Download CSV
                  </Button>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    <TableHead>Employee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Gross Δ</TableHead>
                    <TableHead className="text-right">Deductions Δ</TableHead>
                    <TableHead className="text-right">Net Δ</TableHead>
                    <TableHead className="text-right">Net Δ%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.length === 0 ? (
                    <TableEmptyState message="No employees match this filter." colSpan={7} />
                  ) : (
                    employees.map((employee) => (
                      <Fragment key={employee.employeeId}>
                        <TableRow onClick={() => toggleExpanded(employee.employeeId)}>
                          <TableCell>
                            {expanded[employee.employeeId] ? (
                              <ChevronDown className="h-4 w-4 text-warm-400" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-warm-400" aria-hidden="true" />
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-warm-900">{employee.name}</p>
                            <p className="text-xs text-warm-500">
                              {employee.employeeCode}
                              {employee.department ? ` · ${employee.department}` : ''}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariants[employee.status]}>{employee.status}</Badge>
                            {employee.flagged ? <Badge variant="danger" className="ml-1">Flagged</Badge> : null}
                          </TableCell>
                          <TableCell className="text-right">{formatMoney(employee.gross.delta)}</TableCell>
                          <TableCell className="text-right">{formatMoney(employee.deductions.delta)}</TableCell>
                          <TableCell className="text-right">{formatMoney(employee.net.delta)}</TableCell>
                          <TableCell className="text-right">{formatPct(employee.net.deltaPct)}</TableCell>
                        </TableRow>
                        {expanded[employee.employeeId] && employee.components.length > 0 ? (
                          <tr>
                            <td />
                            <td colSpan={6} className="bg-warm-50 px-3 py-2.5">
                              <ul className="space-y-1 text-xs text-warm-600">
                                {employee.components.map((component) => (
                                  <li key={component.key} className="flex justify-between">
                                    <span>{component.key}</span>
                                    <span>
                                      {formatMoney(component.previous)} → {formatMoney(component.current)} (
                                      {component.delta >= 0 ? '+' : ''}
                                      {formatMoney(component.delta)})
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <h2 className="text-sm font-semibold text-warm-900">Components</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Previous</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">Delta</TableHead>
                    <TableHead className="text-right">Delta %</TableHead>
                    <TableHead className="text-right">Employees affected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.components.length === 0 ? (
                    <TableEmptyState message="No component activity." colSpan={7} />
                  ) : (
                    report.components.map((component) => (
                      <TableRow key={component.key}>
                        <TableCell>{component.key}</TableCell>
                        <TableCell className="text-xs text-warm-600">{component.category}</TableCell>
                        <TableCell className="text-right">{formatMoney(component.previous)}</TableCell>
                        <TableCell className="text-right">{formatMoney(component.current)}</TableCell>
                        <TableCell className="text-right">{formatMoney(component.delta)}</TableCell>
                        <TableCell className="text-right">{formatPct(component.deltaPct)}</TableCell>
                        <TableCell className="text-right">{component.employeesAffected}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="py-8 text-center text-sm text-warm-500">Choose a payroll run to see its variance.</p>
      )}
    </div>
  );
}

function TotalCard({
  label,
  amount,
}: {
  label: string;
  amount: { current: number; previous: number; delta: number; deltaPct: number | null };
}) {
  return (
    <div className="rounded-lg border border-warm-200 p-3">
      <p className="text-xs uppercase text-warm-500">{label}</p>
      <p className="text-lg font-semibold text-warm-900">{formatMoney(amount.current)}</p>
      <p className="text-xs text-warm-500">
        was {formatMoney(amount.previous)} ({formatPct(amount.deltaPct)})
      </p>
    </div>
  );
}
