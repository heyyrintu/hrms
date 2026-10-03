"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/contexts/AuthContext";
import { currentEmployeeId } from "@/lib/current-employee";
import {
  timesheetsApi,
  type EntryInput,
  type MyWeek,
  type TimesheetStatus,
} from "@/lib/api-timesheets";
import { projectsApi, type LoggableProject } from "@/lib/api-projects";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  RotateCcw,
  Send,
  Save,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  addDays,
  dayHeader,
  formatDay,
  formatHours,
  mondayOf,
  todayIso,
  weekDays,
} from "./week";

type BadgeVariant =
  "default" | "success" | "warning" | "danger" | "info" | "gray";

const STATUS_VARIANT: Record<TimesheetStatus, BadgeVariant> = {
  DRAFT: "gray",
  SUBMITTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

interface Row {
  key: string;
  projectId: string;
  taskId: string | null;
  /** `ALPHA` or `ALPHA / Build`, used for accessible names. */
  label: string;
  title: string;
  note: string;
}

type Cells = Record<string, Record<string, string>>;

const rowKey = (projectId: string, taskId: string | null) =>
  `${projectId}|${taskId ?? ""}`;

/** Accept only what can become a valid hours value: up to 2 digits, 2 decimals. */
const HOURS_INPUT = /^\d{0,2}(\.\d{0,2})?$/;

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string | string[] } } };
  const message = e.response?.data?.message;
  if (Array.isArray(message)) return message.join("; ");
  return message || fallback;
}

/** Rows and cells for the entries the server holds. */
function hydrate(week: MyWeek): { rows: Row[]; cells: Cells } {
  const rows: Row[] = [];
  const cells: Cells = {};
  for (const entry of week.entries) {
    const key = rowKey(entry.projectId, entry.taskId);
    if (!cells[key]) {
      const code = entry.project?.code ?? "Project";
      const taskName = entry.task?.name ?? null;
      rows.push({
        key,
        projectId: entry.projectId,
        taskId: entry.taskId,
        label: taskName ? `${code} / ${taskName}` : code,
        title: entry.project?.name ?? "",
        note: entry.note ?? "",
      });
      cells[key] = {};
    }
    cells[key][entry.date] = String(entry.hours);
  }
  return { rows, cells };
}

export default function TimesheetsPage() {
  const { user } = useAuth();
  const employeeId = currentEmployeeId(user);

  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso()));
  const [week, setWeek] = useState<MyWeek | null>(null);
  const [loggable, setLoggable] = useState<LoggableProject[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [cells, setCells] = useState<Cells>({});
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const status = week?.timesheet?.status ?? null;
  const readOnly = status === "SUBMITTED" || status === "APPROVED";

  const load = useCallback(async () => {
    if (!employeeId) return;
    const ticket = ++latest.current;
    setLoading(true);
    setFailed(false);
    try {
      const [weekRes, projectsRes] = await Promise.all([
        timesheetsApi.getMyWeek(weekStart),
        projectsApi.loggable(weekStart).catch(() => {
          toast.error("Failed to load your projects");
          return null;
        }),
      ]);
      if (ticket !== latest.current) return;
      const next = weekRes.data;
      const built = hydrate(next);
      setWeek(next);
      setRows(built.rows);
      setCells(built.cells);
      setLoggable(projectsRes?.data ?? []);
      setDirty(false);
    } catch {
      if (ticket !== latest.current) return;
      setFailed(true);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [weekStart, employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const addOptions = useMemo(() => {
    const taken = new Set(rows.map((r) => r.key));
    const options: { value: string; label: string }[] = [];
    for (const p of loggable) {
      if (p.tasks.length === 0) {
        if (!taken.has(rowKey(p.id, null))) {
          options.push({
            value: rowKey(p.id, null),
            label: `${p.code} - ${p.name}`,
          });
        }
      } else {
        for (const t of p.tasks) {
          if (!taken.has(rowKey(p.id, t.id))) {
            options.push({
              value: rowKey(p.id, t.id),
              label: `${p.code} - ${p.name} / ${t.name}`,
            });
          }
        }
      }
    }
    return options;
  }, [loggable, rows]);

  const addRow = (value: string) => {
    if (!value) return;
    const [projectId, taskId = ""] = value.split("|");
    const project = loggable.find((p) => p.id === projectId);
    if (!project) return;
    const task = taskId
      ? project.tasks.find((t) => t.id === taskId)
      : undefined;
    setRows((prev) => [
      ...prev,
      {
        key: value,
        projectId,
        taskId: taskId || null,
        label: task ? `${project.code} / ${task.name}` : project.code,
        title: project.name,
        note: "",
      },
    ]);
    setDirty(true);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setCells((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setDirty(true);
  };

  const setCell = (key: string, date: string, value: string) => {
    if (!HOURS_INPUT.test(value)) return;
    setCells((prev) => ({ ...prev, [key]: { ...prev[key], [date]: value } }));
    setDirty(true);
  };

  const setNote = (key: string, note: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, note } : r)));
    setDirty(true);
  };

  const hours = (key: string, date: string): number => {
    const n = Number(cells[key]?.[date]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const rowTotal = (key: string) =>
    days.reduce((sum, d) => sum + hours(key, d), 0);
  const dayTotal = (date: string) =>
    rows.reduce((sum, r) => sum + hours(r.key, date), 0);
  const grandTotal = days.reduce((sum, d) => sum + dayTotal(d), 0);

  const buildEntries = (): EntryInput[] => {
    const entries: EntryInput[] = [];
    for (const row of rows) {
      for (const date of days) {
        const n = hours(row.key, date);
        if (n > 0) {
          entries.push({
            date,
            projectId: row.projectId,
            taskId: row.taskId,
            hours: n,
            note: row.note.trim() || null,
          });
        }
      }
    }
    return entries;
  };

  const inWindow = (projectId: string, date: string): boolean => {
    const member = loggable.find((p) => p.id === projectId)?.member;
    if (!member) return true;
    return (
      member.startDate <= date &&
      (member.endDate === null || member.endDate >= date)
    );
  };

  /** Persist the grid; returns the saved week, or null when the server refused. */
  const save = async (entries: EntryInput[]): Promise<MyWeek | null> => {
    try {
      const res = await timesheetsApi.saveEntries(weekStart, entries);
      const saved = res.data;
      const built = hydrate(saved);
      setWeek(saved);
      setRows(built.rows);
      setCells(built.cells);
      setDirty(false);
      return saved;
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save the timesheet"));
      return null;
    }
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      if (await save(buildEntries())) toast.success("Draft saved");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    const entries = buildEntries();
    if (entries.length === 0) {
      toast.error("Add some hours before submitting");
      return;
    }
    setBusy(true);
    try {
      let id = week?.timesheet?.id ?? null;
      if (dirty || !id) {
        const saved = await save(entries);
        if (!saved?.timesheet) return;
        id = saved.timesheet.id;
      }
      await timesheetsApi.submit(id);
      toast.success("Timesheet submitted for approval");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to submit the timesheet"));
    } finally {
      setBusy(false);
    }
  };

  const handleRecall = async () => {
    const id = week?.timesheet?.id;
    if (!id) return;
    setBusy(true);
    try {
      await timesheetsApi.recall(id);
      toast.success("Timesheet recalled to draft");
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to recall the timesheet"));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
          <Clock className="h-6 w-6 text-primary-600" />
          Timesheets
        </h1>
        <p className="mt-1 text-warm-600">
          Log your hours by project for the week of {formatDay(weekStart)}
        </p>
      </div>
    </div>
  );

  if (!employeeId) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-warm-600">
              No employee record is linked to your account, so there is no
              timesheet to fill in.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-end gap-2">
        <Button
          variant="secondary"
          aria-label="Previous week"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          label="Week of"
          value={weekStart}
          onChange={(e) => {
            if (e.target.value) setWeekStart(mondayOf(e.target.value));
          }}
        />
        <Button
          variant="secondary"
          aria-label="Next week"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {status && <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>}
      </div>

      {status === "REJECTED" && week?.timesheet?.approverNote && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          Rejected: {week.timesheet.approverNote}
        </div>
      )}

      {loading ? (
        <div
          role="status"
          aria-label="Loading timesheet"
          className="flex justify-center py-20"
        >
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : failed ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="mb-4 text-warm-700">
              Failed to load this week's timesheet.
            </p>
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {!readOnly && (
            <div className="max-w-md">
              <Select
                label="Add row"
                value=""
                placeholder="Select project / task"
                options={addOptions}
                onChange={(e) => addRow(e.target.value)}
              />
            </div>
          )}

          {rows.length === 0 && (
            <p className="rounded-lg border border-dashed border-warm-300 p-6 text-center text-warm-600">
              Add a project or task above to start logging hours for this week.
            </p>
          )}

          {
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-warm-200 text-left text-warm-600">
                      <th className="px-3 py-2 font-medium">Project / task</th>
                      {days.map((d) => (
                        <th
                          key={d}
                          className="px-1 py-2 text-center font-medium"
                        >
                          {dayHeader(d)}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">
                        Total
                      </th>
                      <th className="px-3 py-2 font-medium">Note</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="border-b border-warm-100">
                        <td className="px-3 py-2">
                          <div className="font-medium text-warm-900">
                            {row.label}
                          </div>
                          <div className="text-xs text-warm-500">
                            {row.title}
                          </div>
                        </td>
                        {days.map((d) => (
                          <td key={d} className="px-1 py-2 text-center">
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Hours ${row.label} ${dayHeader(d)}`}
                              className={cn(
                                "input h-9 w-16 text-center",
                                "disabled:bg-warm-50",
                              )}
                              value={cells[row.key]?.[d] ?? ""}
                              disabled={readOnly || !inWindow(row.projectId, d)}
                              title={
                                inWindow(row.projectId, d)
                                  ? undefined
                                  : "You are not a member of this project on this day"
                              }
                              onChange={(e) =>
                                setCell(row.key, d, e.target.value)
                              }
                            />
                          </td>
                        ))}
                        <td
                          data-testid={`row-total-${row.key}`}
                          className="px-3 py-2 text-right font-semibold"
                        >
                          {formatHours(rowTotal(row.key))}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            aria-label={`Note ${row.label}`}
                            maxLength={500}
                            className="input h-9 w-48"
                            value={row.note}
                            disabled={readOnly}
                            onChange={(e) => setNote(row.key, e.target.value)}
                          />
                        </td>
                        <td className="px-1">
                          {!readOnly && (
                            <button
                              type="button"
                              aria-label={`Remove ${row.label}`}
                              className="rounded p-1 text-warm-400 hover:text-red-600"
                              onClick={() => removeRow(row.key)}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-b border-warm-100 text-warm-500">
                      <td className="px-3 py-2">Attended</td>
                      {days.map((d) => {
                        const minutes = week?.attendedMinutesByDate[d] ?? 0;
                        return (
                          <td
                            key={d}
                            data-testid={`attended-${d}`}
                            className="px-1 py-2 text-center"
                          >
                            {minutes > 0 ? formatHours(minutes / 60) : "-"}
                          </td>
                        );
                      })}
                      <td colSpan={3} />
                    </tr>
                    <tr className="font-semibold text-warm-900">
                      <td className="px-3 py-2">Logged</td>
                      {days.map((d) => (
                        <td
                          key={d}
                          data-testid={`col-total-${d}`}
                          className="px-1 py-2 text-center"
                        >
                          {formatHours(dayTotal(d))}
                        </td>
                      ))}
                      <td
                        data-testid="grand-total"
                        className="px-3 py-2 text-right"
                      >
                        {formatHours(grandTotal)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          }

          <div className="flex flex-wrap justify-end gap-2">
            {status === "SUBMITTED" && (
              <Button
                variant="secondary"
                onClick={handleRecall}
                disabled={busy}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Recall
              </Button>
            )}
            {!readOnly && (
              <>
                <Button
                  variant="secondary"
                  onClick={handleSave}
                  disabled={busy}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save draft
                </Button>
                <Button onClick={handleSubmit} disabled={busy}>
                  <Send className="mr-2 h-4 w-4" />
                  Submit for approval
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
