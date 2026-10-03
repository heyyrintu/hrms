"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAuth } from "@/contexts/AuthContext";
import { departmentsApi } from "@/lib/api";
import { projectsApi } from "@/lib/api-projects";
import {
  utilisationApi,
  type EmployeeUtilisationRow,
  type ProjectUtilisationRow,
  type UtilisationGroupBy,
  type UtilisationQuery,
  type UtilisationReport,
} from "@/lib/api-utilisation";
import { UserRole } from "@/types";
import { cn } from "@/lib/utils";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import {
  addDays,
  addMonths,
  firstOfMonth,
  formatHours,
  lastOfMonth,
  todayIso,
} from "../../timesheets/week";

const DASH = "—";

const pctText = (v: number | null) => (v === null ? DASH : `${v}%`);

type Preset = "this-month" | "last-month" | "last-4-weeks" | "custom";

function presetRange(
  preset: Exclude<Preset, "custom">,
  today: string,
): { from: string; to: string } {
  switch (preset) {
    case "this-month":
      return { from: firstOfMonth(today), to: lastOfMonth(today) };
    case "last-month": {
      const last = addMonths(today, -1);
      return { from: firstOfMonth(last), to: lastOfMonth(last) };
    }
    case "last-4-weeks":
      return { from: addDays(today, -27), to: today };
  }
}

const PRESETS: { key: Exclude<Preset, "custom">; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-4-weeks", label: "Last 4 weeks" },
];

function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const inner = (data as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}

export default function UtilisationPage() {
  const { hasRole, hasPermission } = useAuth();
  const canViewEmployees =
    hasRole(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN) ||
    !!hasPermission?.("projects.reports.view");

  const [initialRange] = useState(() => presetRange("this-month", todayIso()));
  const [preset, setPreset] = useState<Preset>("this-month");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [groupBy, setGroupBy] = useState<UtilisationGroupBy>(
    canViewEmployees ? "employee" : "project",
  );
  const [departmentId, setDepartmentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [includeSubmitted, setIncludeSubmitted] = useState(false);

  const [departments, setDepartments] = useState<
    { id: string; name: string }[]
  >([]);
  const [projectOptions, setProjectOptions] = useState<
    { id: string; code: string; name: string }[]
  >([]);

  const [report, setReport] = useState<UtilisationReport | null>(null);
  // The grouping the shown report was built for: the toggle changes before the new data arrives.
  const [reportGroupBy, setReportGroupBy] =
    useState<UtilisationGroupBy>(groupBy);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [downloading, setDownloading] = useState(false);

  const query = useMemo<UtilisationQuery>(
    () => ({
      from,
      to,
      groupBy,
      ...(departmentId ? { departmentId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(includeSubmitted ? { includeSubmitted: true } : {}),
    }),
    [from, to, groupBy, departmentId, projectId, includeSubmitted],
  );

  // Filter lists are conveniences: a failure leaves the filter empty.
  useEffect(() => {
    departmentsApi
      .getAll()
      .then((res) => setDepartments(asList(res.data)))
      .catch(() => {});
    projectsApi
      .list({ limit: 100 })
      .then((res) => setProjectOptions(asList(res.data)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await utilisationApi.get(query);
      setReport(res.data);
      setReportGroupBy(query.groupBy);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      setReport(null);
      setError(status === 403 ? "forbidden" : "failed");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (key: Exclude<Preset, "custom">) => {
    const range = presetRange(key, todayIso());
    setPreset(key);
    setFrom(range.from);
    setTo(range.to);
  };

  const download = async () => {
    setDownloading(true);
    try {
      const res = await utilisationApi.exportCsv(query);
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `utilisation-${from}-${to}-${groupBy}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download the CSV");
    } finally {
      setDownloading(false);
    }
  };

  const toggle = (value: UtilisationGroupBy, label: string) => (
    <button
      type="button"
      aria-pressed={groupBy === value}
      onClick={() => setGroupBy(value)}
      className={cn(
        "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
        groupBy === value
          ? "bg-primary-600 text-white"
          : "bg-warm-100 text-warm-700 hover:bg-warm-200",
      )}
    >
      {label}
    </button>
  );

  const rows = report?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
            <BarChart3 className="h-6 w-6 text-primary-600" />
            Utilisation
          </h1>
          <p className="mt-1 text-warm-600">
            Hours logged against capacity, from approved timesheets
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw
              className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
            />
            Refresh
          </Button>
          <Button
            variant="secondary"
            onClick={download}
            disabled={downloading || loading}
          >
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={preset === p.key}
                  onClick={() => applyPreset(p.key)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm",
                    preset === p.key
                      ? "border-primary-600 bg-primary-50 text-primary-700"
                      : "border-warm-300 text-warm-700 hover:bg-warm-50",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Input
              type="date"
              label="From"
              value={from}
              max={to}
              onChange={(e) => {
                if (e.target.value) {
                  setFrom(e.target.value);
                  setPreset("custom");
                }
              }}
            />
            <Input
              type="date"
              label="To"
              value={to}
              min={from}
              onChange={(e) => {
                if (e.target.value) {
                  setTo(e.target.value);
                  setPreset("custom");
                }
              }}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-2">
              {canViewEmployees && toggle("employee", "By employee")}
              {toggle("project", "By project")}
            </div>
            <div className="w-48">
              <Select
                label="Department"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                placeholder="All departments"
                options={departments.map((d) => ({
                  value: d.id,
                  label: d.name,
                }))}
              />
            </div>
            <div className="w-56">
              <Select
                label="Project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="All projects"
                options={projectOptions.map((p) => ({
                  value: p.id,
                  label: `${p.code} - ${p.name}`,
                }))}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-warm-700">
              <input
                type="checkbox"
                checked={includeSubmitted}
                onChange={(e) => setIncludeSubmitted(e.target.checked)}
              />
              Include submitted
            </label>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div
          role="status"
          aria-label="Loading report"
          className="flex justify-center py-20"
        >
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : error === "forbidden" ? (
        <Card>
          <CardContent className="py-16 text-center text-warm-700">
            You do not have access to this view of the utilisation report.
          </CardContent>
        </Card>
      ) : error === "failed" ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="mb-4 text-warm-700">
              Failed to load the utilisation report.
            </p>
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : report && rows.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-warm-600">
            No data for this range.
          </CardContent>
        </Card>
      ) : report ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            {reportGroupBy === "employee" ? (
              <EmployeeTable report={report} />
            ) : (
              <ProjectTable report={report} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const th = "px-4 py-3 font-medium";
const num = "px-4 py-3 text-right";

function EmployeeTable({ report }: { report: UtilisationReport }) {
  const rows = report.rows as EmployeeUtilisationRow[];
  const totals = report.totals as Omit<
    EmployeeUtilisationRow,
    "employeeId" | "name" | "code" | "department"
  >;
  return (
    <table className="w-full min-w-[720px] text-sm">
      <thead>
        <tr className="border-b border-warm-200 text-left text-warm-600">
          <th className={th}>Employee</th>
          <th className={th}>Department</th>
          <th className={cn(th, "text-right")}>Capacity (h)</th>
          <th className={cn(th, "text-right")}>Logged (h)</th>
          <th className={cn(th, "text-right")}>Billable (h)</th>
          <th className={cn(th, "text-right")}>Utilisation</th>
          <th className={cn(th, "text-right")}>Billable</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.employeeId} className="border-b border-warm-100">
            <td className="px-4 py-3">
              <div className="font-medium text-warm-900">{r.name}</div>
              <div className="text-xs text-warm-500">{r.code}</div>
            </td>
            <td className="px-4 py-3">{r.department ?? DASH}</td>
            <td className={num}>{formatHours(r.capacityHours)}</td>
            <td className={num}>{formatHours(r.loggedHours)}</td>
            <td className={num}>{formatHours(r.billableHours)}</td>
            <td className={num}>{pctText(r.utilisationPct)}</td>
            <td className={num}>{pctText(r.billablePct)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr
          data-testid="totals-row"
          className="bg-warm-50 font-semibold text-warm-900"
        >
          <td className="px-4 py-3">Total</td>
          <td className="px-4 py-3" />
          <td className={num}>{formatHours(totals.capacityHours)}</td>
          <td className={num}>{formatHours(totals.loggedHours)}</td>
          <td className={num}>{formatHours(totals.billableHours)}</td>
          <td className={num}>{pctText(totals.utilisationPct)}</td>
          <td className={num}>{pctText(totals.billablePct)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function ProjectTable({ report }: { report: UtilisationReport }) {
  const rows = report.rows as ProjectUtilisationRow[];
  const totals = report.totals as Omit<
    ProjectUtilisationRow,
    "projectId" | "code" | "name"
  >;
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr className="border-b border-warm-200 text-left text-warm-600">
          <th className={th}>Project</th>
          <th className={cn(th, "text-right")}>Logged (h)</th>
          <th className={cn(th, "text-right")}>Billable (h)</th>
          <th className={cn(th, "text-right")}>Billable share</th>
          <th className={cn(th, "text-right")}>Contributors</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.projectId} className="border-b border-warm-100">
            <td className="px-4 py-3">
              <div className="font-medium text-warm-900">{r.code}</div>
              <div className="text-xs text-warm-500">{r.name}</div>
            </td>
            <td className={num}>{formatHours(r.loggedHours)}</td>
            <td className={num}>{formatHours(r.billableHours)}</td>
            <td className={num}>{pctText(r.billableSharePct)}</td>
            <td className={num}>{r.contributors}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr
          data-testid="totals-row"
          className="bg-warm-50 font-semibold text-warm-900"
        >
          <td className="px-4 py-3">Total</td>
          <td className={num}>{formatHours(totals.loggedHours)}</td>
          <td className={num}>{formatHours(totals.billableHours)}</td>
          <td className={num}>{pctText(totals.billableSharePct)}</td>
          <td className={num}>{totals.contributors}</td>
        </tr>
      </tfoot>
    </table>
  );
}
