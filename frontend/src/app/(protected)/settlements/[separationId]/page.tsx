'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { SettlementWorking } from '@/components/settlement/SettlementWorking';
import { formatMoney, formatDate, toPayloadNumber } from '@/components/settlement/format';
import { settlementApi, exitApi } from '@/lib/api';
import { SettlementStatus } from '@/types';
import type { Settlement, Separation, UpdateSettlementPayload } from '@/types';
import {
  ArrowLeft,
  Calculator,
  CheckCircle,
  BadgeIndianRupee,
  RefreshCw,
  AlertTriangle,
  Save,
  FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';

const statusVariants: Record<string, 'info' | 'warning' | 'success' | 'gray'> = {
  [SettlementStatus.DRAFT]: 'warning',
  [SettlementStatus.APPROVED]: 'info',
  [SettlementStatus.PAID]: 'success',
  [SettlementStatus.CANCELLED]: 'gray',
};

/** The four figures the settlement cannot derive and a person must enter. */
interface EnteredFigures {
  otherEarnings: string;
  otherRecoveries: string;
  tds: string;
  remarks: string;
}

const enteredFiguresOf = (settlement: Settlement): EnteredFigures => ({
  otherEarnings: settlement.otherEarnings ?? '0',
  otherRecoveries: settlement.otherRecoveries ?? '0',
  tds: settlement.tds ?? '0',
  remarks: settlement.remarks ?? '',
});

const httpStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } })?.response?.status;

const serverMessage = (error: unknown, fallback: string): string =>
  (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

/**
 * One separation's full and final settlement.
 *
 * The page is built around showing the working rather than the totals: every
 * figure carries the basis it was computed on, because an exiting employee is
 * entitled to check the arithmetic and will ask.
 */
export default function SettlementDetailPage() {
  const params = useParams<{ separationId: string }>();
  const separationId = params?.separationId as string;

  const [separation, setSeparation] = useState<Separation | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [waiveMinimumService, setWaiveMinimumService] = useState(false);
  const [recomputeModalOpen, setRecomputeModalOpen] = useState(false);
  const [figures, setFigures] = useState<EnteredFigures>({
    otherEarnings: '0',
    otherRecoveries: '0',
    tds: '0',
    remarks: '',
  });

  const applySettlement = useCallback((next: Settlement) => {
    setSettlement(next);
    setFigures(enteredFiguresOf(next));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(null);
    try {
      const sepRes = await exitApi.getById(separationId);
      setSeparation(sepRes.data);
    } catch {
      // The settlement is still worth showing without the separation header.
      setSeparation(null);
    }

    try {
      const res = await settlementApi.getBySeparation(separationId);
      applySettlement(res.data);
    } catch (error: unknown) {
      if (httpStatus(error) === 404) {
        // Not an error: this separation simply has no settlement yet.
        setSettlement(null);
      } else {
        setSettlement(null);
        setLoadFailed(serverMessage(error, 'Failed to load the settlement'));
        toast.error(serverMessage(error, 'Failed to load the settlement'));
      }
    } finally {
      setLoading(false);
    }
  }, [separationId, applySettlement]);

  useEffect(() => {
    if (separationId) load();
  }, [separationId, load]);

  /**
   * A 409 means somebody else moved this settlement between our read and our
   * write. Saying "action failed" would leave the user guessing; say what
   * happened and put the current version back on screen.
   */
  const handleConflict = async (error: unknown, fallback: string) => {
    if (httpStatus(error) === 409) {
      toast.error(
        `Someone else changed this settlement first: ${serverMessage(error, fallback)}. Reloading the current version.`,
      );
      await load();
      return true;
    }
    return false;
  };

  const runCompute = async () => {
    setBusy(true);
    try {
      const res = await settlementApi.compute(separationId, {
        waiveGratuityMinimumService: waiveMinimumService,
      });
      applySettlement(res.data);
      setRecomputeModalOpen(false);
      toast.success('Settlement computed');
    } catch (error: unknown) {
      if (await handleConflict(error, 'The settlement can no longer be recomputed')) {
        setRecomputeModalOpen(false);
        return;
      }
      toast.error(serverMessage(error, 'Failed to compute the settlement'));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveFigures = async () => {
    if (!settlement) return;

    // Read all three before sending. An unreadable entry used to become zero on
    // the way out and the save reported success, so a typo in the TDS box would
    // write a figure nobody entered to a settlement someone is paid from.
    const entered: [string, number | null][] = [
      ['Other earnings', toPayloadNumber(figures.otherEarnings)],
      ['Other recoveries', toPayloadNumber(figures.otherRecoveries)],
      ['TDS', toPayloadNumber(figures.tds)],
    ];
    const unreadable = entered.find(([, value]) => value === null);
    if (unreadable) {
      toast.error(
        `${unreadable[0]} must be a number of rupees, zero or more. Nothing was saved.`,
      );
      return;
    }
    const [[, otherEarnings], [, otherRecoveries], [, tds]] = entered;

    setBusy(true);
    try {
      const payload: UpdateSettlementPayload = {
        otherEarnings: otherEarnings as number,
        otherRecoveries: otherRecoveries as number,
        tds: tds as number,
        remarks: figures.remarks,
      };
      // The client takes a loose record; the payload above is the typed shape
      // the backend DTO validates.
      const res = await settlementApi.update(
        settlement.id,
        payload as Record<string, unknown>,
      );
      applySettlement(res.data);
      toast.success('Entered figures saved');
    } catch (error: unknown) {
      if (await handleConflict(error, 'The settlement is no longer a draft')) return;
      toast.error(serverMessage(error, 'Failed to save the entered figures'));
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!settlement) return;
    setBusy(true);
    try {
      const res = await settlementApi.approve(settlement.id);
      applySettlement(res.data);
      toast.success('Settlement approved');
    } catch (error: unknown) {
      if (await handleConflict(error, 'The settlement is no longer a draft')) return;
      toast.error(serverMessage(error, 'Failed to approve the settlement'));
    } finally {
      setBusy(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!settlement) return;
    setBusy(true);
    try {
      const res = await settlementApi.markAsPaid(settlement.id);
      applySettlement(res.data);
      toast.success('Settlement marked as paid');
    } catch (error: unknown) {
      if (await handleConflict(error, 'The settlement is no longer approved')) return;
      toast.error(serverMessage(error, 'Failed to mark the settlement as paid'));
    } finally {
      setBusy(false);
    }
  };

  const isDraft = settlement?.status === SettlementStatus.DRAFT;
  const employee = settlement?.employee ?? separation?.employee;
  const lastWorkingDate = settlement?.lastWorkingDate ?? separation?.lastWorkingDate;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/settlements"
              className="mb-2 inline-flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700"
            >
              <ArrowLeft className="w-4 h-4" />
              All settlements
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-warm-900">
              <BadgeIndianRupee className="w-7 h-7 text-primary-600" />
              Full &amp; Final Settlement
            </h1>
            <p className="mt-1 text-warm-600">
              {employee
                ? `${employee.firstName} ${employee.lastName} · ${employee.employeeCode}`
                : 'Employee details unavailable'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warm-500">
              <span>Last working date: {formatDate(lastWorkingDate)}</span>
              {separation && (
                <Badge variant="gray">{separation.status.replace(/_/g, ' ')}</Badge>
              )}
              {settlement && (
                <Badge variant={statusVariants[settlement.status] ?? 'gray'}>
                  {settlement.status}
                </Badge>
              )}
            </div>
          </div>

          {/* Only the transitions the current status allows are offered. */}
          <div className="flex flex-wrap gap-3">
            {settlement && isDraft && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setRecomputeModalOpen(true)}
                  disabled={busy}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Recompute
                </Button>
                <Button onClick={handleApprove} loading={busy} disabled={busy}>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve
                </Button>
              </>
            )}
            {settlement?.status === SettlementStatus.APPROVED && (
              <Button onClick={handleMarkAsPaid} loading={busy} disabled={busy}>
                <BadgeIndianRupee className="w-4 h-4 mr-2" />
                Mark as Paid
              </Button>
            )}
          </div>
        </div>

        {loadFailed && (
          <Card>
            <CardContent className="py-6">
              <p className="flex items-center gap-2 text-sm text-red-600">
                <AlertTriangle className="w-4 h-4" />
                {loadFailed}
              </p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Try again
              </Button>
            </CardContent>
          </Card>
        )}

        {/* No settlement yet — an absence, not a failure. */}
        {!settlement && !loadFailed && (
          <Card>
            <CardContent className="py-10 text-center">
              <Calculator className="mx-auto mb-4 h-14 w-14 text-warm-300" />
              <h2 className="mb-2 text-lg font-semibold text-warm-900">
                No settlement has been computed for this separation yet
              </h2>
              <p className="mx-auto mb-6 max-w-xl text-sm text-warm-600">
                Computing draws pro-rata salary, leave encashment, gratuity and notice
                recovery from the employee&apos;s salary and leave records as they stand
                now. The result is a draft you can still edit.
              </p>

              <div className="mx-auto mb-6 max-w-xl rounded-lg bg-amber-50 p-4 text-left">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={waiveMinimumService}
                    onChange={(e) => setWaiveMinimumService(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-amber-900">
                    <span className="font-medium">
                      Waive the five-year qualifying period for gratuity
                    </span>
                    <span className="mt-1 block text-xs">
                      The Payment of Gratuity Act 1972 permits this only on death or
                      permanent disablement of the employee. Do not tick it for any other
                      separation.
                    </span>
                  </span>
                </label>
              </div>

              <Button onClick={runCompute} loading={busy} disabled={busy}>
                <Calculator className="w-4 h-4 mr-2" />
                Compute Settlement
              </Button>
            </CardContent>
          </Card>
        )}

        {settlement && (
          <>
            {/* Totals */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="py-4">
                  <p className="text-sm text-warm-500">Gross payable</p>
                  <p className="text-xl font-bold text-warm-900">
                    {formatMoney(settlement.grossPayable)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <p className="text-sm text-warm-500">Recoveries and TDS</p>
                  <p className="text-xl font-bold text-red-600">
                    {formatMoney(settlement.totalRecoveries)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="py-4">
                  <p className="text-sm text-warm-500">Net payable</p>
                  <p className="text-xl font-bold text-emerald-700">
                    {formatMoney(settlement.netPayable)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* The working */}
            {settlement.breakdown ? (
              <SettlementWorking breakdown={settlement.breakdown} />
            ) : (
              <Card>
                <CardContent className="py-6">
                  <p className="text-sm text-warm-600">
                    This settlement was stored without a breakdown, so the working behind
                    its figures cannot be shown. Recompute it to produce one.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Entered figures */}
            <div className="rounded-lg border border-warm-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-warm-200 px-4 py-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-warm-900">
                  <FileText className="w-4 h-4 text-primary-600" />
                  Entered figures
                </h3>
                {!isDraft && <Badge variant="gray">Locked</Badge>}
              </div>
              <div className="space-y-4 px-4 py-4">
                <p className="text-xs text-warm-500">
                  These four cannot be derived from the employee&apos;s records. They are
                  entered by whoever processes the exit and are editable only while the
                  settlement is a draft.
                </p>

                {isDraft ? (
                  <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <Input
                        label="Other earnings (₹)"
                        type="number"
                        min={0}
                        step="0.01"
                        value={figures.otherEarnings}
                        onChange={(e) =>
                          setFigures({ ...figures, otherEarnings: e.target.value })
                        }
                      />
                      <Input
                        label="Other recoveries (₹)"
                        type="number"
                        min={0}
                        step="0.01"
                        value={figures.otherRecoveries}
                        onChange={(e) =>
                          setFigures({ ...figures, otherRecoveries: e.target.value })
                        }
                      />
                      <Input
                        label="TDS (₹)"
                        type="number"
                        min={0}
                        step="0.01"
                        value={figures.tds}
                        onChange={(e) => setFigures({ ...figures, tds: e.target.value })}
                      />
                    </div>
                    <p className="text-xs text-warm-500">
                      TDS on a settlement is supplied, not computed. Nothing here works it
                      out from the leaver&apos;s position for the year — enter the figure
                      your tax computation gives.
                    </p>

                    <div>
                      <label
                        htmlFor="settlement-remarks"
                        className="mb-1 block text-sm font-medium text-warm-700"
                      >
                        Remarks
                      </label>
                      <textarea
                        id="settlement-remarks"
                        rows={3}
                        value={figures.remarks}
                        onChange={(e) => setFigures({ ...figures, remarks: e.target.value })}
                        placeholder="Anything the leaver should see alongside these figures..."
                        className="w-full resize-none rounded-lg border border-warm-300 px-3 py-2 focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <Button onClick={handleSaveFigures} loading={busy} disabled={busy}>
                      <Save className="w-4 h-4 mr-2" />
                      Save entered figures
                    </Button>
                  </>
                ) : (
                  <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-warm-500">Other earnings</dt>
                      <dd className="font-medium text-warm-900">
                        {formatMoney(settlement.otherEarnings)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-warm-500">Other recoveries</dt>
                      <dd className="font-medium text-warm-900">
                        {formatMoney(settlement.otherRecoveries)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-warm-500">TDS</dt>
                      <dd className="font-medium text-warm-900">
                        {formatMoney(settlement.tds)}
                      </dd>
                    </div>
                    <div className="sm:col-span-3">
                      <dt className="text-warm-500">Remarks</dt>
                      <dd className="font-medium text-warm-900">
                        {settlement.remarks || 'None recorded'}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            </div>

            {/* Trail */}
            <p className="text-xs text-warm-400">
              Computed {formatDate(settlement.createdAt)}
              {settlement.approvedAt && ` · Approved ${formatDate(settlement.approvedAt)}`}
              {settlement.paidAt && ` · Paid ${formatDate(settlement.paidAt)}`}
            </p>
          </>
        )}
      </div>

      {/* Recompute confirmation — a recompute silently discards entered figures. */}
      <Modal
        isOpen={recomputeModalOpen}
        onClose={() => setRecomputeModalOpen(false)}
        title="Recompute this settlement?"
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-900">
              Recomputing replaces the draft, and the four figures a person entered are
              discarded with it. You will have to enter them again.
            </p>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-warm-500">
              These are the current entered figures, and they will be lost:
            </p>
            <ul className="divide-y divide-warm-100 rounded-lg bg-warm-50 px-3 text-sm">
              <li className="flex justify-between gap-3 py-2">
                <span className="text-warm-600">Other earnings</span>
                <span className="font-medium text-warm-900">
                  {formatMoney(settlement?.otherEarnings)}
                </span>
              </li>
              <li className="flex justify-between gap-3 py-2">
                <span className="text-warm-600">Other recoveries</span>
                <span className="font-medium text-warm-900">
                  {formatMoney(settlement?.otherRecoveries)}
                </span>
              </li>
              <li className="flex justify-between gap-3 py-2">
                <span className="text-warm-600">TDS</span>
                <span className="font-medium text-warm-900">
                  {formatMoney(settlement?.tds)}
                </span>
              </li>
              <li className="flex justify-between gap-3 py-2">
                <span className="text-warm-600">Remarks</span>
                <span className="font-medium text-warm-900">
                  {settlement?.remarks || 'None'}
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-lg bg-amber-50 p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={waiveMinimumService}
                onChange={(e) => setWaiveMinimumService(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-warm-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-amber-900">
                <span className="font-medium">
                  Waive the five-year qualifying period for gratuity
                </span>
                <span className="mt-1 block text-xs">
                  The Payment of Gratuity Act 1972 permits this only on death or permanent
                  disablement of the employee. Do not tick it for any other separation.
                </span>
              </span>
            </label>
          </div>
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setRecomputeModalOpen(false)}
            disabled={busy}
          >
            Keep the current draft
          </Button>
          <Button variant="danger" onClick={runCompute} loading={busy} disabled={busy}>
            Recompute anyway
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
