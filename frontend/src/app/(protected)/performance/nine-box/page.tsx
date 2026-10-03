'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { departmentsApi, performanceApi } from '@/lib/api';
import { calibrationApi } from '@/lib/api-performance-calibration';
import type { Band, NineBoxView } from '@/lib/api-performance-calibration';

// y axis (top to bottom): potential HIGH, MEDIUM, LOW. x axis (left to right): performance LOW, MEDIUM, HIGH.
const POTENTIAL_ROWS: Band[] = ['HIGH', 'MEDIUM', 'LOW'];
const PERFORMANCE_COLS: Band[] = ['LOW', 'MEDIUM', 'HIGH'];

// Keyed `${performance}-${potential}`.
const CELL_TITLES: Record<string, string> = {
  'HIGH-HIGH': 'Star',
  'MEDIUM-HIGH': 'High potential',
  'LOW-HIGH': 'Inconsistent',
  'HIGH-MEDIUM': 'Future star',
  'MEDIUM-MEDIUM': 'Core player',
  'LOW-MEDIUM': 'Underperformer',
  'HIGH-LOW': 'Solid performer',
  'MEDIUM-LOW': 'Effective',
  'LOW-LOW': 'Risk',
};

const CELL_TONE: Record<string, string> = {
  'HIGH-HIGH': 'bg-emerald-50 border-emerald-200',
  'LOW-LOW': 'bg-red-50 border-red-200',
};

interface CycleOption { id: string; name: string; status: string }

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

export default function NineBoxPage() {
  const [cycles, setCycles] = useState<CycleOption[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [cycleId, setCycleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [view, setView] = useState<NineBoxView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
      const res = await calibrationApi.nineBox({ cycleId, ...(departmentId ? { departmentId } : {}) });
      setView(res.data);
    } catch (err) {
      setError(true);
      setView(null);
      toast.error(errorMessage(err, 'Failed to load the 9-box grid'));
    } finally {
      setLoading(false);
    }
  }, [cycleId, departmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const employeesIn = (performance: Band, potential: Band) =>
    view?.cells.find((c) => c.performance === performance && c.potential === potential)?.employees ?? [];

  const missingReason = (m: NineBoxView['missing'][number]) => {
    const parts: string[] = [];
    if (m.missingRating) parts.push('Performance rating missing');
    if (m.missingPotential) parts.push('Potential rating missing');
    return parts.join(', ');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-warm-900">9-Box Grid</h1>
        <p className="text-sm text-warm-500">Performance (final rating) against potential for the selected review cycle.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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
      </div>

      {loading ? (
        <p className="text-sm text-warm-500">Loading 9-box grid...</p>
      ) : error ? (
        <Card><CardContent className="p-6 text-center text-sm text-red-600">Could not load the 9-box grid.</CardContent></Card>
      ) : !view ? (
        <Card><CardContent className="p-8 text-center text-warm-500">Select a review cycle to begin.</CardContent></Card>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex flex-col justify-between py-2 text-xs font-semibold text-warm-500 w-14 text-right">
              <span>High potential</span>
              <span>Medium</span>
              <span>Low</span>
            </div>
            <div className="flex-1">
              <div className="grid grid-cols-3 gap-2">
                {POTENTIAL_ROWS.flatMap((potential) =>
                  PERFORMANCE_COLS.map((performance) => {
                    const key = `${performance}-${potential}`;
                    const people = employeesIn(performance, potential);
                    return (
                      <div
                        key={key}
                        data-testid={`cell-${key}`}
                        className={`min-h-[120px] rounded-lg border p-2 ${CELL_TONE[key] ?? 'bg-white border-warm-200'}`}
                      >
                        <div className="text-xs font-semibold text-warm-700 mb-2">{CELL_TITLES[key]}</div>
                        <div className="flex flex-wrap gap-1">
                          {people.map((p) => (
                            <span
                              key={p.reviewId}
                              title={[p.designation, p.departmentName].filter(Boolean).join(' - ')}
                              className="inline-flex items-center rounded-full bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200 px-2 py-0.5 text-xs"
                            >
                              {p.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  }),
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-1 text-center text-xs font-semibold text-warm-500">
                <span>Low performance</span>
                <span>Medium</span>
                <span>High performance</span>
              </div>
            </div>
          </div>

          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-warm-800 mb-2">Not placed</h3>
              {view.missing.length === 0 ? (
                <p className="text-sm text-warm-500">Everyone in this view has been placed.</p>
              ) : (
                <ul className="space-y-1">
                  {view.missing.map((m) => (
                    <li key={m.reviewId} className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-warm-900">{m.name}</span>
                      <span className="text-warm-500">{missingReason(m)}</span>
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
