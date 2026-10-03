'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useAuth } from '@/contexts/AuthContext';
import { departmentsApi, performanceApi } from '@/lib/api';
import { calibrationApi } from '@/lib/api-performance-calibration';
import type { CalibrationRow, CalibrationView } from '@/lib/api-performance-calibration';
import { DistributionChart } from '@/components/performance/calibration/DistributionChart';
import { OverrideDialog } from '@/components/performance/calibration/OverrideDialog';

interface CycleOption { id: string; name: string; status: string }

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

const dash = (v: number | null | undefined) => (v === null || v === undefined ? '-' : String(v));

export default function CalibrationPage() {
  const { isAdmin } = useAuth();

  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [managers, setManagers] = useState<Array<{ id: string; name: string }>>([]);
  const [cycleId, setCycleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [managerId, setManagerId] = useState('');

  const [view, setView] = useState<CalibrationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [overriding, setOverriding] = useState<CalibrationRow | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await performanceApi.getCycles({ limit: '100' });
        const list: CycleOption[] = res.data?.data ?? [];
        setCycles(list);
        if (list.length > 0) setCycleId((prev) => prev || list[0].id);
        else setLoading(false);
      } catch {
        toast.error('Failed to load review cycles');
        setLoading(false);
      }
      try {
        const res = await departmentsApi.getAll();
        setDepartments(Array.isArray(res.data) ? res.data : (res.data?.data ?? []));
      } catch {
        /* the department filter simply stays empty */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!cycleId) return;
    setLoading(true);
    setError(false);
    try {
      const res = await calibrationApi.get({
        cycleId,
        ...(departmentId ? { departmentId } : {}),
        ...(managerId ? { managerId } : {}),
      });
      setView(res.data);
      // Remember every manager we have seen so the filter keeps its options once narrowed.
      setManagers((prev) => {
        const map = new Map(prev.map((m) => [m.id, m.name]));
        for (const m of res.data.byManager) map.set(m.reviewerId, m.reviewerName);
        return Array.from(map, ([id, name]) => ({ id, name }));
      });
    } catch (err) {
      setError(true);
      setView(null);
      toast.error(errorMessage(err, 'Failed to load calibration data'));
    } finally {
      setLoading(false);
    }
  }, [cycleId, departmentId, managerId]);

  useEffect(() => {
    load();
  }, [load]);

  const completed = view?.cycle.status === 'COMPLETED';

  const handleOverride = async (reviewId: string, rating: number | null, reason: string) => {
    try {
      await calibrationApi.calibrate(reviewId, rating, reason);
      toast.success(rating === null ? 'Calibration reverted' : 'Rating overridden');
      setOverriding(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to apply override'));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-warm-900">Calibration</h1>
        <p className="text-sm text-warm-500">Compare rating distributions across the organisation and adjust outliers with an audited override.</p>
      </div>

      {!isAdmin && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-800">
          Read-only: your reviewees
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Cycle"
          value={cycleId}
          onChange={(e) => setCycleId(e.target.value)}
          options={cycles.map((c) => ({ value: c.id, label: c.name }))}
          placeholder={cycles.length === 0 ? 'No cycles' : undefined}
        />
        <Select
          label="Department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          placeholder="All departments"
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
        />
        <Select
          label="Manager"
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          placeholder="All managers"
          options={managers.map((m) => ({ value: m.id, label: m.name }))}
        />
      </div>

      {loading ? (
        <p className="text-sm text-warm-500">Loading calibration data...</p>
      ) : error ? (
        <Card><CardContent className="p-6 text-center text-sm text-red-600">Could not load calibration data.</CardContent></Card>
      ) : !view ? (
        <Card><CardContent className="p-8 text-center text-warm-500">Select a review cycle to begin.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <DistributionChart title="Overall" distribution={view.overall} />
            <div className="space-y-4">
              {view.byDepartment.length === 0 && <p className="text-sm text-warm-500">No department data.</p>}
              {view.byDepartment.map((d) => (
                <DistributionChart key={d.departmentId ?? 'none'} title={`Department: ${d.departmentName}`} distribution={d.distribution} />
              ))}
            </div>
            <div className="space-y-4">
              {view.byManager.length === 0 && <p className="text-sm text-warm-500">No manager data.</p>}
              {view.byManager.map((m) => (
                <DistributionChart key={m.reviewerId} title={`Manager: ${m.reviewerName}`} distribution={m.distribution} />
              ))}
            </div>
          </div>

          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {view.reviews.length === 0 ? (
                <p className="p-8 text-center text-warm-500">No reviews match these filters.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead>Manager rating</TableHead>
                      <TableHead>Calibrated</TableHead>
                      <TableHead>Final</TableHead>
                      <TableHead>Potential</TableHead>
                      <TableHead>Reason</TableHead>
                      {isAdmin && <TableHead>Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.reviews.map((r) => (
                      <TableRow key={r.reviewId}>
                        <TableCell>
                          <div className="font-medium text-warm-900">{r.employeeName}</div>
                          <div className="text-xs text-warm-500">{r.employeeCode}</div>
                        </TableCell>
                        <TableCell>{r.departmentName}</TableCell>
                        <TableCell>{r.reviewerName}</TableCell>
                        <TableCell>{dash(r.managerRating)}</TableCell>
                        <TableCell>
                          {r.calibratedRating !== null ? <Badge variant="warning">{r.calibratedRating}</Badge> : '-'}
                        </TableCell>
                        <TableCell>{dash(r.finalRating)}</TableCell>
                        <TableCell>{dash(r.potentialRating)}</TableCell>
                        <TableCell className="max-w-xs text-sm text-warm-600">{r.calibrationReason ?? '-'}</TableCell>
                        {isAdmin && (
                          <TableCell>
                            {!completed && (
                              <Button variant="secondary" size="sm" onClick={() => setOverriding(r)}>Override</Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {isAdmin && <OverrideDialog row={overriding} onClose={() => setOverriding(null)} onSubmit={handleOverride} />}
    </div>
  );
}
