'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { GridPager } from '@/components/roster/GridPager';
import { RosterGrid } from '@/components/roster/RosterGrid';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { departmentsApi, employeesApi, shiftsApi } from '@/lib/api';
import {
  rosterApi,
  type CellUpdate,
  type RosterGrid as RosterGridData,
  type RotationPattern,
} from '@/lib/api-roster';
import type { Shift } from '@/lib/api-shifts';
import { parseLocalDate, toLocalIso, todayLocalIso } from '@/lib/date';
import { cn } from '@/lib/utils';
import { Edit2, Plus, RefreshCw, Trash2, Users } from 'lucide-react';

type Tab = 'roster' | 'patterns';

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

interface Department {
  id: string;
  name: string;
}

function addDays(iso: string, n: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + n);
  return toLocalIso(d);
}

/** The Monday of the week containing `iso`. */
function mondayOf(iso: string): string {
  const d = parseLocalDate(iso);
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return toLocalIso(d);
}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data
    ?.message;
  if (Array.isArray(message)) return message.join(', ');
  return message || fallback;
}

export default function AdminRosterPage() {
  const [tab, setTab] = useState<Tab>('roster');
  const [shifts, setShifts] = useState<Shift[]>([]);

  useEffect(() => {
    shiftsApi
      .getAll()
      .then((res: { data: Shift[] }) => setShifts(res.data))
      .catch(() => toast.error('Failed to load shifts'));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-warm-900">Shift roster</h1>
        <p className="text-sm text-warm-500">
          Plan who works which shift, by hand or from a rotation pattern.
        </p>
      </div>

      <div className="flex gap-2 border-b border-warm-200">
        {(
          [
            ['roster', 'Roster'],
            ['patterns', 'Rotation patterns'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              tab === id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-warm-500 hover:text-warm-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'roster' ? <RosterTab shifts={shifts} /> : <PatternsTab shifts={shifts} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster tab
// ---------------------------------------------------------------------------

function RosterTab({ shifts }: { shifts: Shift[] }) {
  const [start, setStart] = useState(() => mondayOf(todayLocalIso()));
  const [span, setSpan] = useState<7 | 14>(7);
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [grid, setGrid] = useState<RosterGridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    departmentsApi
      .getAll()
      .then((res: { data: Department[] }) => setDepartments(res.data))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await rosterApi.getGrid({
        from: start,
        to: addDays(start, span - 1),
        ...(departmentId ? { departmentId } : {}),
        ...(page > 1 ? { page } : {}),
      });
      setGrid(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [start, span, departmentId, page]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (cells: CellUpdate[]) => {
    try {
      await rosterApi.updateCells(cells);
      toast.success(`Saved ${cells.length} ${cells.length === 1 ? 'change' : 'changes'}`);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save the roster'));
      throw e;
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="secondary" onClick={() => {
              setPage(1);
              setStart(addDays(start, -span));
            }}>
            Previous
          </Button>
          <Button variant="secondary" onClick={() => {
              setPage(1);
              setStart(addDays(start, span));
            }}>
            Next
          </Button>
          <div className="w-44">
            <Input
              label="From"
              type="date"
              value={start}
              onChange={(e) => e.target.value && setStart(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {([7, 14] as const).map((n) => (
              <Button
                key={n}
                variant={span === n ? 'primary' : 'secondary'}
                onClick={() => setSpan(n)}
              >
                {`${n} days`}
              </Button>
            ))}
          </div>
          <div className="w-52">
            <Select
              label="Department"
              value={departmentId}
              onChange={(e) => {
                setPage(1);
                setDepartmentId(e.target.value);
              }}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="ghost" onClick={load} aria-label="Refresh roster">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {loading && !grid ? (
          <p className="py-8 text-center text-sm text-warm-500">Loading roster...</p>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="mb-3 text-sm text-red-600">Failed to load the roster.</p>
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        ) : grid ? (
          <>
            <RosterGrid grid={grid} shifts={shifts} editable onSave={save} />
            <GridPager meta={grid.meta} onPage={setPage} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rotation patterns tab
// ---------------------------------------------------------------------------

function PatternsTab({ shifts }: { shifts: Shift[] }) {
  const [patterns, setPatterns] = useState<RotationPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RotationPattern | null>(null);
  const [applying, setApplying] = useState<RotationPattern | null>(null);
  const [deleting, setDeleting] = useState<RotationPattern | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await rosterApi.listPatterns();
      setPatterns(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shiftCode = (id: string | null) =>
    id === null ? 'OFF' : (shifts.find((s) => s.id === id)?.code ?? '?');

  const remove = async () => {
    if (!deleting) return;
    try {
      await rosterApi.deletePattern(deleting.id);
      toast.success('Pattern deleted');
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete the pattern'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" />
          New pattern
        </Button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-warm-500">Loading patterns...</p>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="mb-3 text-sm text-red-600">Failed to load rotation patterns.</p>
          <Button variant="secondary" onClick={load}>
            Retry
          </Button>
        </div>
      ) : patterns.length === 0 ? (
        <p className="py-8 text-center text-sm text-warm-500">No rotation patterns yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {patterns.map((p) => (
            <Card key={p.id}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-warm-900">{p.name}</h3>
                    {p.description && <p className="text-sm text-warm-500">{p.description}</p>}
                    <p className="text-xs text-warm-500">{`${p.cycleLength}-day cycle`}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      aria-label="Edit pattern"
                      onClick={() => {
                        setEditing(p);
                        setEditorOpen(true);
                      }}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label="Delete pattern"
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {[...p.days]
                    .sort((a, b) => a.dayIndex - b.dayIndex)
                    .map((d) => (
                      <span
                        key={d.dayIndex}
                        className={cn(
                          'rounded-md px-2 py-1 text-xs font-semibold',
                          d.shiftId === null
                            ? 'bg-warm-100 text-warm-600'
                            : 'bg-primary-50 text-primary-800',
                        )}
                      >
                        {shiftCode(d.shiftId)}
                      </span>
                    ))}
                </div>
                <Button variant="secondary" onClick={() => setApplying(p)}>
                  <Users className="mr-1 h-4 w-4" />
                  Apply to employees
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editorOpen && (
        <PatternEditor
          key={editing?.id ?? 'new'}
          pattern={editing}
          shifts={shifts}
          onClose={() => setEditorOpen(false)}
          onSaved={async () => {
            setEditorOpen(false);
            await load();
          }}
        />
      )}

      {applying && (
        <ApplyPatternModal
          pattern={applying}
          onClose={() => setApplying(null)}
          onApplied={() => setApplying(null)}
        />
      )}

      <Modal isOpen={deleting !== null} onClose={() => setDeleting(null)} title="Delete pattern" size="sm">
        <p className="text-sm text-warm-600">
          {`Delete "${deleting?.name ?? ''}"? Roster entries already created from it stay as they are.`}
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove}>
            Confirm delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function PatternEditor({
  pattern,
  shifts,
  onClose,
  onSaved,
}: {
  pattern: RotationPattern | null;
  shifts: Shift[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(pattern?.name ?? '');
  const [description, setDescription] = useState(pattern?.description ?? '');
  // '' is OFF.
  const [days, setDays] = useState<string[]>(
    pattern
      ? [...pattern.days].sort((a, b) => a.dayIndex - b.dayIndex).map((d) => d.shiftId ?? '')
      : [''],
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error('Give the pattern a name');
      return;
    }
    const input = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      days: days.map((d) => (d === '' ? null : d)),
    };
    setSaving(true);
    try {
      if (pattern) await rosterApi.updatePattern(pattern.id, input);
      else await rosterApi.createPattern(input);
      toast.success(pattern ? 'Pattern updated' : 'Pattern created');
      await onSaved();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save the pattern'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={pattern ? 'Edit pattern' : 'New pattern'} size="lg">
      <div className="space-y-4">
        <Input label="Pattern name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        <Input
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
        <div className="space-y-2">
          <p className="text-sm font-medium text-warm-700">{`Cycle (${days.length} of 31 days)`}</p>
          {days.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 text-sm text-warm-500">{`Day ${i + 1}`}</span>
              <Select
                aria-label={`Day ${i + 1} shift`}
                value={value}
                onChange={(e) => setDays((prev) => prev.map((d, j) => (j === i ? e.target.value : d)))}
              >
                <option value="">OFF</option>
                {shifts
                  .filter((s) => s.isActive)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {`${s.code} · ${s.name}`}
                    </option>
                  ))}
              </Select>
              <Button
                variant="ghost"
                aria-label={`Remove day ${i + 1}`}
                disabled={days.length === 1}
                onClick={() => setDays((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={days.length >= 31}
            onClick={() => setDays((prev) => [...prev, ''])}
          >
            Add day
          </Button>
        </div>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving}>
          Save pattern
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function ApplyPatternModal({
  pattern,
  onClose,
  onApplied,
}: {
  pattern: RotationPattern;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState(todayLocalIso());
  const [endDate, setEndDate] = useState(addDays(todayLocalIso(), 27));
  const [cycleOffset, setCycleOffset] = useState('0');
  const [overwriteManual, setOverwriteManual] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    employeesApi
      .getAll({ limit: 1000 })
      .then((res: { data: EmployeeOption[] | { data?: EmployeeOption[] } }) => {
        const data = res.data;
        setEmployees(Array.isArray(data) ? data : (data.data ?? []));
      })
      .catch(() => toast.error('Failed to load employees'))
      .finally(() => setLoadingEmployees(false));
  }, []);

  const visible = employees.filter((e) =>
    `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (selected.size === 0) {
      toast.error('Select at least one employee');
      return;
    }
    if (selected.size > 500) {
      toast.error('Apply to at most 500 employees at a time');
      return;
    }
    setSubmitting(true);
    try {
      const res = await rosterApi.apply({
        patternId: pattern.id,
        employeeIds: [...selected],
        startDate,
        endDate,
        cycleOffset: Number(cycleOffset) || 0,
        overwriteManual,
      });
      const { created, updated, skippedManual } = res.data;
      toast.success(`Roster applied: ${created} created, ${updated} updated, ${skippedManual} skipped`);
      onApplied();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to apply the pattern'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Apply "${pattern.name}"`} size="xl">
      <div className="space-y-4" data-testid="apply-form">
        <div className="space-y-2">
          <Input
            label="Find employees"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code"
          />
          <div className="max-h-52 overflow-y-auto rounded-lg border border-warm-200 p-2">
            {loadingEmployees ? (
              <p className="p-2 text-sm text-warm-500">Loading employees...</p>
            ) : visible.length === 0 ? (
              <p className="p-2 text-sm text-warm-500">No employees found.</p>
            ) : (
              visible.map((e) => (
                <label key={e.id} className="flex items-center gap-2 p-1 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                  {`${e.firstName} ${e.lastName} (${e.employeeCode})`}
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-warm-500">{`${selected.size} selected`}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <Input
          label="Cycle offset"
          type="number"
          min={0}
          max={30}
          value={cycleOffset}
          onChange={(e) => setCycleOffset(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overwriteManual}
            onChange={(e) => setOverwriteManual(e.target.checked)}
          />
          Overwrite manual entries
        </label>
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} loading={submitting} data-testid="apply-submit">
          Apply
        </Button>
      </ModalFooter>
    </Modal>
  );
}
