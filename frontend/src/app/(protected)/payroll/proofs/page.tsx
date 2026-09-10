'use client';

/**
 * Payroll's review of the evidence behind declared deductions.
 *
 * A person decides here. Nothing on this page is checked automatically, and
 * none of its wording should suggest otherwise: a reviewer opens the document,
 * looks at it beside what the employee declared and what has already been
 * accepted, and records what they accept and why.
 *
 * The role gate lives in the /payroll layout, so there is none here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  FileSearch,
  Inbox,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { employeesApi, proofsApi } from '@/lib/api';
import type { Employee } from '@/types';
import {
  InvestmentProofStatus,
  PROOF_SECTION_LABELS,
  type InvestmentProof,
  type ProofSummary,
} from '@/types/proofs';

import {
  currentFinancialYear,
  financialYearLabel,
  financialYearOptions,
} from '@/components/form16/financialYear';
import { formatINR } from '@/components/form16/money';
import { ProofClaimContext } from '@/components/proof-review/ProofClaimContext';
import {
  checkAcceptedAmount,
  checkReviewNote,
  toPayloadAmount,
} from '@/components/proof-review/amount';

const httpStatus = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } })?.response?.status;

const serverMessage = (error: unknown, fallback: string): string =>
  (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

const statusVariants: Record<InvestmentProofStatus, 'warning' | 'success' | 'danger'> = {
  [InvestmentProofStatus.PENDING]: 'warning',
  [InvestmentProofStatus.APPROVED]: 'success',
  [InvestmentProofStatus.REJECTED]: 'danger',
};

const statusLabels: Record<InvestmentProofStatus, string> = {
  [InvestmentProofStatus.PENDING]: 'Awaiting review',
  [InvestmentProofStatus.APPROVED]: 'Approved',
  [InvestmentProofStatus.REJECTED]: 'Rejected',
};

const statusOptions = [
  { value: InvestmentProofStatus.PENDING, label: 'Awaiting review' },
  { value: InvestmentProofStatus.APPROVED, label: 'Approved' },
  { value: InvestmentProofStatus.REJECTED, label: 'Rejected' },
  { value: 'ALL', label: 'Every status' },
];

/**
 * Dates are read in India, whatever zone the reviewer's browser sits in: a
 * decision recorded at 09:00 in Mumbai should not be dated the day before
 * because the page was opened in New York.
 */
const formatDecisionDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const fileNameOf = (proof: InvestmentProof): string =>
  proof.upload?.fileName || `investment-proof-${proof.id}`;

const employeeNameOf = (proof: InvestmentProof): string =>
  proof.employee ? `${proof.employee.firstName} ${proof.employee.lastName}` : 'Unknown employee';

type ReviewAction = 'approve' | 'reject';

export default function ProofReviewPage() {
  const [proofs, setProofs] = useState<InvestmentProof[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [financialYear, setFinancialYear] = useState<number>(() => currentFinancialYear());
  const [status, setStatus] = useState<string>(InvestmentProofStatus.PENDING);
  const [employeeId, setEmployeeId] = useState('');

  /**
   * Which documents this reviewer has actually opened. A decision recorded
   * without reading the evidence is not a review, so the form will not take
   * one until the file has been opened.
   */
  const [opened, setOpened] = useState<Record<string, true>>({});
  const [downloading, setDownloading] = useState<string | null>(null);

  const [reviewing, setReviewing] = useState<InvestmentProof | null>(null);
  const [action, setAction] = useState<ReviewAction>('approve');
  const [acceptedAmount, setAcceptedAmount] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [summary, setSummary] = useState<ProofSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryFailed, setSummaryFailed] = useState(false);
  /** Generation counter identifying the newest in-flight summary read. */
  const summaryRequest = useRef(0);

  const yearOptions = useMemo(() => financialYearOptions(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await employeesApi.getAll({ limit: 1000, status: 'ACTIVE' });
        if (cancelled) return;
        // The list endpoint pages its results; older callers see a bare array.
        const payload = response.data;
        setEmployees((payload?.data ?? payload ?? []) as Employee[]);
      } catch {
        if (cancelled) return;
        setEmployees([]);
        toast.error('The employee list could not be loaded, so the queue cannot be filtered by person.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const employeeOptions = useMemo(
    () =>
      employees.map((employee) => ({
        value: employee.id,
        label: `${employee.firstName} ${employee.lastName} (${employee.employeeCode})`,
      })),
    [employees],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { financialYear };
      if (status && status !== 'ALL') params.status = status;
      if (employeeId) params.employeeId = employeeId;

      const response = await proofsApi.listForReview(params);
      const payload = response.data;
      setProofs((payload?.data ?? payload ?? []) as InvestmentProof[]);
    } catch (error: unknown) {
      setProofs([]);
      toast.error(serverMessage(error, 'The proofs could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [financialYear, status, employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = proofs.filter(
    (proof) => proof.status === InvestmentProofStatus.PENDING,
  ).length;

  const openDocument = async (proof: InvestmentProof) => {
    setDownloading(proof.id);
    try {
      await proofsApi.download(proof.id, fileNameOf(proof));
      setOpened((current) => ({ ...current, [proof.id]: true }));
    } catch (error: unknown) {
      toast.error(serverMessage(error, 'That document could not be opened.'));
    } finally {
      setDownloading(null);
    }
  };

  const startReview = (proof: InvestmentProof, next: ReviewAction) => {
    setReviewing(proof);
    setAction(next);
    // Defaults to the claimed figure, which is the only figure anyone has
    // asserted. The reviewer may lower it; the form will not let them raise it.
    setAcceptedAmount(proof.claimedAmount);
    setReviewNote('');
    setFormError('');

    const request = summaryRequest.current + 1;
    summaryRequest.current = request;
    setSummary(null);
    setSummaryFailed(false);
    setSummaryLoading(true);
    void (async () => {
      try {
        const response = await proofsApi.summaryFor(proof.employeeId, proof.financialYear);
        if (summaryRequest.current !== request) return;
        setSummary((response.data ?? null) as ProofSummary | null);
      } catch {
        if (summaryRequest.current !== request) return;
        setSummary(null);
        setSummaryFailed(true);
      } finally {
        if (summaryRequest.current === request) setSummaryLoading(false);
      }
    })();
  };

  const closeReview = () => {
    setReviewing(null);
    setFormError('');
    summaryRequest.current += 1;
    setSummary(null);
    setSummaryLoading(false);
    setSummaryFailed(false);
  };

  /**
   * Two reviewers can be looking at the same proof. The server guards the
   * transition and answers 409 when the other one got there first; saying
   * "action failed" would leave this reviewer guessing, so say what happened
   * and put the decision that won back on screen.
   */
  const handledConflict = async (error: unknown): Promise<boolean> => {
    if (httpStatus(error) !== 409) return false;
    toast.error(
      `Someone else reviewed this proof first: ${serverMessage(
        error,
        'it already has a decision',
      )}. Reloading the queue so you can see their decision.`,
    );
    closeReview();
    await load();
    return true;
  };

  const recordDecision = async () => {
    if (!reviewing) return;
    if (reviewing.status !== InvestmentProofStatus.PENDING) return;
    if (!opened[reviewing.id]) return;

    if (action === 'approve') {
      const checked = checkAcceptedAmount(acceptedAmount, reviewing.claimedAmount);
      if ('error' in checked) {
        setFormError(checked.error);
        return;
      }
      setFormError('');
      setSaving(true);
      try {
        await proofsApi.approve(reviewing.id, { verifiedAmount: toPayloadAmount(checked.value) });
        toast.success(`Approved ${formatINR(checked.value)} for ${employeeNameOf(reviewing)}.`);
        closeReview();
        await load();
      } catch (error: unknown) {
        if (await handledConflict(error)) return;
        toast.error(serverMessage(error, 'The approval could not be recorded.'));
      } finally {
        setSaving(false);
      }
      return;
    }

    const checked = checkReviewNote(reviewNote);
    if ('error' in checked) {
      setFormError(checked.error);
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await proofsApi.reject(reviewing.id, { reviewNote: checked.value });
      toast.success(`Rejected, and ${employeeNameOf(reviewing)} is told why.`);
      closeReview();
      await load();
    } catch (error: unknown) {
      if (await handledConflict(error)) return;
      toast.error(serverMessage(error, 'The rejection could not be recorded.'));
    } finally {
      setSaving(false);
    }
  };

  const documentRead = reviewing ? Boolean(opened[reviewing.id]) : false;

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-warm-900 sm:text-2xl">
              <FileSearch className="h-6 w-6 text-primary-600" aria-hidden="true" />
              Investment proofs
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-warm-600">
              Open each document, read it against what the employee declared, and record what you
              accept. Every decision here is made by a person and is recorded under their name.
            </p>
          </div>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Select
              label="Financial year"
              value={String(financialYear)}
              onChange={(event) => setFinancialYear(Number(event.target.value))}
              options={yearOptions}
            />
            <Select
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={statusOptions}
            />
            <Select
              label="Employee"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              options={employeeOptions}
              placeholder="Everyone"
            />
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : proofs.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Inbox className="mx-auto mb-4 h-14 w-14 text-warm-300" aria-hidden="true" />
              <h3 className="mb-2 text-lg font-semibold text-warm-900">Nothing to review</h3>
              <p className="mx-auto max-w-xl text-sm text-warm-600">
                No proof matches this year, status and employee. Widen the filters to see proofs
                that have already been decided.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-warm-600">
              {proofs.length} {proofs.length === 1 ? 'proof' : 'proofs'} for{' '}
              {financialYearLabel(financialYear)}
              {pendingCount > 0 ? `, ${pendingCount} still awaiting a decision` : ''}.
            </p>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-warm-200 bg-warm-50">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-warm-500">
                        Employee
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-warm-500">
                        Head
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-warm-500">
                        Claimed
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-warm-500">
                        Decision
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase text-warm-500">
                        Document
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warm-200">
                    {proofs.map((proof) => {
                      const isPending = proof.status === InvestmentProofStatus.PENDING;
                      return (
                        <tr
                          key={proof.id}
                          data-testid={`proof-${proof.id}`}
                          className="align-top hover:bg-warm-50"
                        >
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-warm-900">
                              {employeeNameOf(proof)}
                            </p>
                            <p className="text-xs text-warm-500">
                              {proof.employee?.employeeCode}
                              {proof.employee?.department?.name
                                ? ` · ${proof.employee.department.name}`
                                : ''}
                            </p>
                          </td>

                          <td className="px-4 py-3">
                            <p className="text-sm text-warm-900">
                              {PROOF_SECTION_LABELS[proof.section]}
                            </p>
                            {proof.description ? (
                              <p className="mt-0.5 max-w-xs text-xs text-warm-500">
                                {proof.description}
                              </p>
                            ) : null}
                          </td>

                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-warm-900">
                            {formatINR(proof.claimedAmount)}
                          </td>

                          <td className="px-4 py-3">
                            <Badge variant={statusVariants[proof.status]}>
                              {statusLabels[proof.status]}
                            </Badge>
                            {isPending ? null : (
                              <div className="mt-1.5 space-y-1">
                                <p className="text-xs text-warm-600">
                                  {proof.status === InvestmentProofStatus.APPROVED
                                    ? 'Approved by '
                                    : 'Rejected by '}
                                  {proof.reviewer
                                    ? `${proof.reviewer.firstName} ${proof.reviewer.lastName}`
                                    : 'a reviewer no longer on record'}
                                  {proof.reviewedAt
                                    ? ` on ${formatDecisionDate(proof.reviewedAt)}`
                                    : ''}
                                </p>
                                {proof.status === InvestmentProofStatus.APPROVED ? (
                                  <p className="text-xs text-warm-500">
                                    Accepted{' '}
                                    <span className="font-semibold text-warm-900">
                                      {formatINR(proof.verifiedAmount)}
                                    </span>
                                  </p>
                                ) : null}
                                {proof.reviewNote ? (
                                  <p className="max-w-xs text-xs text-warm-600">
                                    {proof.reviewNote}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>

                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void openDocument(proof)}
                                disabled={downloading === proof.id}
                              >
                                <Paperclip className="mr-1.5 h-4 w-4" aria-hidden="true" />
                                Open document
                              </Button>
                              {isPending ? (
                                <>
                                  <Button size="sm" onClick={() => startReview(proof, 'approve')}>
                                    Approve
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => startReview(proof, 'reject')}
                                  >
                                    Reject
                                  </Button>
                                </>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-warm-500">{fileNameOf(proof)}</p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      <Modal
        isOpen={reviewing !== null}
        onClose={closeReview}
        title={action === 'approve' ? 'Approve this proof' : 'Reject this proof'}
        size="lg"
      >
        {reviewing ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-warm-900">{employeeNameOf(reviewing)}</p>
              <p className="text-xs text-warm-500">{reviewing.employee?.employeeCode}</p>
            </div>

            <ProofClaimContext
              section={reviewing.section}
              financialYear={reviewing.financialYear}
              claimedAmount={reviewing.claimedAmount}
              summary={summary}
              loading={summaryLoading}
              failed={summaryFailed}
            />

            <div className="rounded-lg border border-warm-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-warm-900">{fileNameOf(reviewing)}</p>
                  <p className="text-xs text-warm-500">
                    {reviewing.description || 'No description was given with this proof.'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void openDocument(reviewing)}
                  disabled={downloading === reviewing.id}
                >
                  <Paperclip className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Open document
                </Button>
              </div>
              {documentRead ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  You opened this document.
                </p>
              ) : (
                <p className="mt-2 text-xs text-amber-700">
                  Open the document before recording a decision. Nothing here has been checked for
                  you.
                </p>
              )}
            </div>

            {action === 'approve' ? (
              <div className="space-y-1">
                <Input
                  label="Accepted amount (₹)"
                  inputMode="decimal"
                  value={acceptedAmount}
                  onChange={(event) => {
                    setAcceptedAmount(event.target.value);
                    setFormError('');
                  }}
                />
                <p className="text-xs text-warm-500">
                  Defaults to the claimed {formatINR(reviewing.claimedAmount)}. Lower it if the
                  document supports less; it cannot go higher.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <label
                  htmlFor="proof-review-note"
                  className="block text-sm font-medium text-warm-700"
                >
                  Reason for rejection
                </label>
                <textarea
                  id="proof-review-note"
                  rows={3}
                  value={reviewNote}
                  onChange={(event) => {
                    setReviewNote(event.target.value);
                    setFormError('');
                  }}
                  placeholder="What is wrong with this evidence?"
                  className="w-full resize-none rounded-lg border border-warm-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                />
                <p className="text-xs text-warm-500">
                  This is shown to {employeeNameOf(reviewing)}, so write it for them.
                </p>
              </div>
            )}

            {formError ? (
              <p role="alert" className="text-sm text-red-600">
                {formError}
              </p>
            ) : null}
          </div>
        ) : null}

        <ModalFooter>
          <Button variant="secondary" onClick={closeReview} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={action === 'approve' ? 'primary' : 'danger'}
            onClick={() => void recordDecision()}
            loading={saving}
            disabled={saving || !documentRead}
          >
            {action === 'approve' ? (
              <>
                <CheckCircle2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Record approval
              </>
            ) : (
              <>
                <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Record rejection
              </>
            )}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
