"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { timesheetsApi, type Timesheet } from "@/lib/api-timesheets";
import { cn } from "@/lib/utils";
import { CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import {
  dayHeader,
  formatDay,
  formatHours,
  weekDays,
} from "../../timesheets/week";

function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string | string[] } } };
  const message = e.response?.data?.message;
  if (Array.isArray(message)) return message.join("; ");
  return message || fallback;
}

const rowKey = (projectId: string, taskId: string | null) =>
  `${projectId}|${taskId ?? ""}`;

/** The day by project grid of one timesheet, read-only. */
function Breakdown({ sheet }: { sheet: Timesheet }) {
  const days = useMemo(() => weekDays(sheet.weekStart), [sheet.weekStart]);

  const { rows, hours } = useMemo(() => {
    const labels = new Map<string, { label: string; title: string }>();
    const grid = new Map<string, Map<string, number>>();
    for (const e of sheet.entries ?? []) {
      const key = rowKey(e.projectId, e.taskId);
      if (!labels.has(key)) {
        const code = e.project?.code ?? "Project";
        labels.set(key, {
          label: e.task ? `${code} / ${e.task.name}` : code,
          title: e.project?.name ?? "",
        });
        grid.set(key, new Map());
      }
      const row = grid.get(key)!;
      row.set(e.date, (row.get(e.date) ?? 0) + e.hours);
    }
    return {
      rows: [...labels.entries()].map(([key, v]) => ({ key, ...v })),
      hours: grid,
    };
  }, [sheet.entries]);

  const cell = (key: string, date: string) => hours.get(key)?.get(date) ?? 0;
  const rowTotal = (key: string) => days.reduce((s, d) => s + cell(key, d), 0);
  const dayTotal = (date: string) =>
    rows.reduce((s, r) => s + cell(r.key, date), 0);
  const grand = days.reduce((s, d) => s + dayTotal(d), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-warm-200 text-left text-warm-600">
            <th className="px-2 py-2 font-medium">Project / task</th>
            {days.map((d) => (
              <th key={d} className="px-1 py-2 text-center font-medium">
                {dayHeader(d)}
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-warm-100">
              <td className="px-2 py-2">
                <div className="font-medium text-warm-900">{row.label}</div>
                <div className="text-xs text-warm-500">{row.title}</div>
              </td>
              {days.map((d) => (
                <td
                  key={d}
                  data-testid={`cell-${row.key}-${d}`}
                  className="px-1 py-2 text-center"
                >
                  {cell(row.key, d) > 0 ? formatHours(cell(row.key, d)) : "-"}
                </td>
              ))}
              <td
                data-testid={`row-total-${row.key}`}
                className="px-2 py-2 text-right font-semibold"
              >
                {formatHours(rowTotal(row.key))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold text-warm-900">
            <td className="px-2 py-2">Total</td>
            {days.map((d) => (
              <td
                key={d}
                data-testid={`col-total-${d}`}
                className="px-1 py-2 text-center"
              >
                {formatHours(dayTotal(d))}
              </td>
            ))}
            <td data-testid="grand-total" className="px-2 py-2 text-right">
              {formatHours(grand)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function TimesheetApprovalsPage() {
  const [items, setItems] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Timesheet | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // The id the dialog is for now; a slower earlier response must not replace it.
  const openRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await timesheetsApi.getPendingApprovals();
      setItems(res.data ?? []);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    openRef.current = null;
    setOpenId(null);
    setDetail(null);
    setNote("");
  };

  const open = async (id: string) => {
    openRef.current = id;
    setOpenId(id);
    setDetail(null);
    setNote("");
    try {
      const res = await timesheetsApi.get(id);
      if (openRef.current !== id) return;
      setDetail(res.data);
    } catch (err) {
      if (openRef.current !== id) return;
      toast.error(errorMessage(err, "Failed to load the timesheet"));
      close();
    }
  };

  const decide = async (decision: "approve" | "reject") => {
    // Act on the timesheet the reviewer is looking at, never on a stale selection.
    if (!detail || detail.id !== openId) return;
    const id = detail.id;
    setSaving(true);
    try {
      const text = note.trim() || undefined;
      if (decision === "approve") await timesheetsApi.approve(id, text);
      else await timesheetsApi.reject(id, text);
      toast.success(
        decision === "approve" ? "Timesheet approved" : "Timesheet rejected",
      );
      close();
      await load();
    } catch (err) {
      toast.error(errorMessage(err, `Failed to ${decision} the timesheet`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
              <ClipboardCheck className="h-6 w-6 text-primary-600" />
              Timesheet Approvals
            </h1>
            <p className="mt-1 text-warm-600">
              Review weekly timesheets waiting for your decision
            </p>
          </div>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw
              className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
            />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div
            role="status"
            aria-label="Loading timesheets"
            className="flex justify-center py-20"
          >
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : failed ? (
          <Card>
            <CardContent className="py-16 text-center">
              <p className="mb-4 text-warm-700">
                Failed to load the pending timesheets.
              </p>
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <h3 className="mb-2 text-lg font-semibold text-warm-900">
                Nothing waiting
              </h3>
              <p className="text-warm-600">
                No timesheets are waiting for your approval.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-warm-200 text-left text-warm-600">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Week of</th>
                    <th className="px-4 py-3 text-right font-medium">Hours</th>
                    <th className="px-4 py-3 font-medium">Submitted</th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-warm-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-warm-900">
                          {item.employee?.name ?? "Unknown employee"}
                        </div>
                        <div className="text-xs text-warm-500">
                          {item.employee?.code}
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatDay(item.weekStart)}</td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {formatHours(item.totalHours)}
                      </td>
                      <td className="px-4 py-3">
                        {item.submittedAt
                          ? formatDay(item.submittedAt.slice(0, 10))
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Review ${item.employee?.name ?? "timesheet"}`}
                          onClick={() => open(item.id)}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      <Modal
        isOpen={openId !== null}
        onClose={close}
        size="2xl"
        title={
          detail?.employee ? `Timesheet - ${detail.employee.name}` : "Timesheet"
        }
      >
        <div role="dialog" aria-label="Timesheet detail" className="space-y-4">
          {detail ? (
            <>
              <p className="text-sm text-warm-600">
                Week of {formatDay(detail.weekStart)} -{" "}
                {formatHours(detail.totalHours)} h
              </p>
              <Breakdown sheet={detail} />
              <div>
                <label htmlFor="timesheet-decision-note" className="label">
                  Note
                </label>
                <textarea
                  id="timesheet-decision-note"
                  className="input min-h-[80px] w-full"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note to the employee"
                />
              </div>
              <ModalFooter>
                <Button variant="secondary" onClick={close} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => decide("reject")}
                  disabled={saving}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </Button>
                <Button onClick={() => decide("approve")} disabled={saving}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
                </Button>
              </ModalFooter>
            </>
          ) : (
            <div
              role="status"
              aria-label="Loading timesheet"
              className="flex justify-center py-12"
            >
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
