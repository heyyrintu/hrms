'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import {
  loansApi,
  type Loan,
  type LoanStatus,
  type LoanType,
} from '@/lib/api-loans';
import { buildSchedule, computeTotalPayable, formatPeriod } from '@/lib/loanSchedule';
import { formatCurrency } from '@/lib/salaryCalculations';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Plus,
  RefreshCw,
  Receipt,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

const statusLabels: Record<LoanStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

const statusColors: Record<LoanStatus, BadgeVariant> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  ACTIVE: 'success',
  CLOSED: 'gray',
  CANCELLED: 'gray',
};

const typeLabels: Record<LoanType, string> = {
  LOAN: 'Loan',
  SALARY_ADVANCE: 'Salary advance',
};

/** Twelve months for an advance, ten years for a loan. Mirrors the API. */
const maxTenureFor = (type: LoanType) => (type === 'SALARY_ADVANCE' ? 12 : 120);

const nextMonth = () => {
  const now = new Date();
  const month = now.getMonth() + 2;
  return month > 12
    ? { startMonth: 1, startYear: now.getFullYear() + 1 }
    : { startMonth: month, startYear: now.getFullYear() };
};

const emptyForm = () => ({
  type: 'LOAN' as LoanType,
  principal: '',
  interestRate: '0',
  tenureMonths: '12',
  ...nextMonth(),
  purpose: '',
});

export default function MyLoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Loan | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [cancelling, setCancelling] = useState<Loan | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loansApi.getMy();
      setLoans(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load your loans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A salary advance is interest free, so the rate field is forced back to
  // zero rather than left showing a number the API would reject.
  const isAdvance = form.type === 'SALARY_ADVANCE';
  const rate = isAdvance ? 0 : Number(form.interestRate) || 0;
  const principal = Number(form.principal) || 0;
  const tenure = Number(form.tenureMonths) || 0;

  /**
   * The preview. Same arithmetic as the server, so the EMI shown here is the
   * EMI that gets stored the moment the request is accepted.
   */
  const preview = useMemo(
    () =>
      buildSchedule({
        principal,
        interestRate: rate,
        tenureMonths: tenure,
        startMonth: form.startMonth,
        startYear: form.startYear,
      }),
    [principal, rate, tenure, form.startMonth, form.startYear],
  );

  const previewTotal =
    preview.length > 0 ? computeTotalPayable(principal, rate, tenure) : 0;

  const tenureTooLong = tenure > maxTenureFor(form.type);

  const openForm = () => {
    setForm(emptyForm());
    setFormOpen(true);
  };

  const submit = async () => {
    if (principal <= 0) {
      toast.error('Enter the amount you need');
      return;
    }
    if (tenure < 1 || tenureTooLong) {
      toast.error(
        `Tenure must be between 1 and ${maxTenureFor(form.type)} months`,
      );
      return;
    }

    setSaving(true);
    try {
      await loansApi.request({
        type: form.type,
        principal,
        interestRate: rate,
        tenureMonths: tenure,
        startMonth: form.startMonth,
        startYear: form.startYear,
        purpose: form.purpose.trim() || undefined,
      });
      toast.success('Request submitted');
      setFormOpen(false);
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(
        axiosError.response?.data?.message || 'Failed to submit the request',
      );
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (loan: Loan) => {
    setDetail(loan);
    setDetailOpen(true);
    try {
      const res = await loansApi.getById(loan.id);
      setDetail(res.data);
    } catch {
      toast.error('Failed to load the schedule');
    }
  };

  const confirmCancel = async () => {
    if (!cancelling) return;
    setSaving(true);
    try {
      await loansApi.cancel(cancelling.id);
      toast.success('Request withdrawn');
      setCancelling(null);
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(
        axiosError.response?.data?.message || 'Failed to withdraw the request',
      );
    } finally {
      setSaving(false);
    }
  };

  const schedule =
    detail?.schedule ??
    (detail
      ? buildSchedule({
          principal: detail.principal,
          interestRate: detail.interestRate,
          tenureMonths: detail.tenureMonths,
          startMonth: detail.startMonth,
          startYear: detail.startYear,
        })
      : []);

  // The post-tenure instalment the server expects payroll to take, if an
  // earlier EMI fell short. Shown so the extra deduction is not a surprise.
  const arrears = detail?.arrears?.instalments ?? [];
  const arrearsTotal = detail?.arrears?.amount ?? 0;

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
              <Banknote className="h-6 w-6 text-primary-600" />
              Loans &amp; Advances
            </h1>
            <p className="mt-1 text-warm-600">
              Request a staff loan or an interest-free salary advance
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={openForm}>
              <Plus className="mr-2 h-4 w-4" />
              New Request
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : loans.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Banknote className="mx-auto mb-4 h-16 w-16 text-warm-300" />
              <h3 className="mb-2 text-lg font-semibold text-warm-900">
                No loans yet
              </h3>
              <p className="mb-4 text-warm-600">
                You have not requested a loan or salary advance.
              </p>
              <Button onClick={openForm}>
                <Plus className="mr-2 h-4 w-4" />
                New Request
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {loans.map((loan) => (
              <Card key={loan.id}>
                <CardContent className="py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-warm-900">
                          {typeLabels[loan.type]} · {formatCurrency(loan.principal)}
                        </span>
                        <Badge variant={statusColors[loan.status]}>
                          {statusLabels[loan.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-warm-600">
                        {loan.tenureMonths} months at {loan.interestRate}% ·
                        EMI {formatCurrency(loan.emiAmount)} · from{' '}
                        {formatPeriod(loan.startMonth, loan.startYear)}
                      </p>
                      <p className="mt-1 text-sm text-warm-500">
                        Outstanding {formatCurrency(loan.outstandingAmount)} of{' '}
                        {formatCurrency(loan.totalPayable)}
                      </p>
                      {loan.status === 'REJECTED' && loan.rejectionReason && (
                        <p className="mt-1 text-sm text-red-600">
                          Reason: {loan.rejectionReason}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => openDetail(loan)}>
                        <CalendarDays className="mr-2 h-4 w-4" />
                        Schedule
                      </Button>
                      {loan.status === 'REQUESTED' && (
                        <Button
                          variant="danger"
                          onClick={() => setCancelling(loan)}
                        >
                          <XCircle className="mr-2 h-4 w-4" />
                          Withdraw
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Request form, with the live EMI preview */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title="Request a Loan or Advance"
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="loan-type" className="mb-1 block text-sm font-medium text-warm-700">
                Type *
              </label>
              <select
                id="loan-type"
                value={form.type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    type: e.target.value as LoanType,
                    interestRate:
                      e.target.value === 'SALARY_ADVANCE' ? '0' : form.interestRate,
                  })
                }
                className="w-full rounded-lg border border-warm-300 px-3 py-2"
              >
                <option value="LOAN">Loan</option>
                <option value="SALARY_ADVANCE">Salary advance</option>
              </select>
            </div>
            <div>
              <label htmlFor="loan-principal" className="mb-1 block text-sm font-medium text-warm-700">
                Amount *
              </label>
              <input
                id="loan-principal"
                type="number"
                min={1}
                value={form.principal}
                onChange={(e) => setForm({ ...form, principal: e.target.value })}
                className="w-full rounded-lg border border-warm-300 px-3 py-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="loan-rate" className="mb-1 block text-sm font-medium text-warm-700">
                Interest rate (%)
              </label>
              <input
                id="loan-rate"
                type="number"
                min={0}
                step="0.01"
                value={isAdvance ? '0' : form.interestRate}
                disabled={isAdvance}
                onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
                className="w-full rounded-lg border border-warm-300 px-3 py-2 disabled:bg-warm-100"
              />
              {isAdvance && (
                <p className="mt-1 text-xs text-warm-500">
                  A salary advance is always interest free.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="loan-tenure" className="mb-1 block text-sm font-medium text-warm-700">
                Tenure (months) *
              </label>
              <input
                id="loan-tenure"
                type="number"
                min={1}
                max={maxTenureFor(form.type)}
                value={form.tenureMonths}
                onChange={(e) => setForm({ ...form, tenureMonths: e.target.value })}
                className="w-full rounded-lg border border-warm-300 px-3 py-2"
              />
              {tenureTooLong && (
                <p className="mt-1 text-xs text-red-600">
                  Maximum {maxTenureFor(form.type)} months for this type.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="loan-start-month" className="mb-1 block text-sm font-medium text-warm-700">
                First instalment *
              </label>
              <div className="flex gap-2">
                <select
                  id="loan-start-month"
                  value={form.startMonth}
                  onChange={(e) =>
                    setForm({ ...form, startMonth: Number(e.target.value) })
                  }
                  className="w-full rounded-lg border border-warm-300 px-3 py-2"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {formatPeriod(m, form.startYear).split(' ')[0]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="First instalment year"
                  type="number"
                  value={form.startYear}
                  onChange={(e) =>
                    setForm({ ...form, startYear: Number(e.target.value) })
                  }
                  className="w-28 rounded-lg border border-warm-300 px-3 py-2"
                />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="loan-purpose" className="mb-1 block text-sm font-medium text-warm-700">
              Purpose
            </label>
            <textarea
              id="loan-purpose"
              rows={3}
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              placeholder="What the money is for"
              className="w-full resize-none rounded-lg border border-warm-300 px-3 py-2"
            />
          </div>

          {preview.length > 0 && (
            <div className="rounded-lg border border-warm-200 bg-warm-50 p-4" data-testid="emi-preview">
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-warm-900">
                <Receipt className="h-4 w-4" />
                Repayment preview
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-warm-500">Monthly EMI</p>
                  <p className="font-semibold text-warm-900">
                    {formatCurrency(preview[0].emi)}
                  </p>
                </div>
                <div>
                  <p className="text-warm-500">Total payable</p>
                  <p className="font-semibold text-warm-900">
                    {formatCurrency(previewTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-warm-500">Total interest</p>
                  <p className="font-semibold text-warm-900">
                    {formatCurrency(Math.max(previewTotal - principal, 0))}
                  </p>
                </div>
                <div>
                  <p className="text-warm-500">Last instalment</p>
                  <p className="font-semibold text-warm-900">
                    {formatPeriod(
                      preview[preview.length - 1].month,
                      preview[preview.length - 1].year,
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setFormOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={principal <= 0 || tenure < 1 || tenureTooLong}
          >
            Submit Request
          </Button>
        </ModalFooter>
      </Modal>

      {/* Instalment schedule */}
      <Modal
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="Repayment Schedule"
        size="lg"
      >
        {detail && (
          <div className="space-y-4">
            <p className="text-sm text-warm-600">
              {typeLabels[detail.type]} of {formatCurrency(detail.principal)} ·
              outstanding {formatCurrency(detail.outstandingAmount)}
            </p>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-warm-100 text-left text-warm-600">
                  <tr>
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2">EMI</th>
                    <th className="px-3 py-2">Principal</th>
                    <th className="px-3 py-2">Interest</th>
                    <th className="px-3 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((row) => (
                    <tr key={`${row.year}-${row.month}`} className="border-b border-warm-100">
                      <td className="px-3 py-2">{formatPeriod(row.month, row.year)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.emi)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.principalComponent)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.interestComponent)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.balanceAfter)}</td>
                    </tr>
                  ))}
                  {arrears.map((row) => (
                    <tr
                      key={`arrears-${row.year}-${row.month}`}
                      data-testid={`arrears-row-${row.year}-${row.month}`}
                      className="border-b border-amber-100 bg-amber-50"
                    >
                      <td className="px-3 py-2">{formatPeriod(row.month, row.year)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.amount)}</td>
                      <td className="px-3 py-2 text-amber-800" colSpan={3}>
                        Arrears — shortfall from earlier months
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {arrearsTotal > 0 && (
              <div
                data-testid="arrears-note"
                className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {formatCurrency(arrearsTotal)} of this{' '}
                  {detail.type === 'SALARY_ADVANCE' ? 'advance' : 'loan'} was not
                  recovered on schedule — in a month where your net pay was too low
                  to cover the full EMI, payroll deducted less rather than leave you
                  with negative pay (or no instalment was taken that month). The
                  shortfall is recovered after your last scheduled instalment, at
                  most one EMI a month:{' '}
                  {arrears
                    .map((r) => `${formatCurrency(r.amount)} in ${formatPeriod(r.month, r.year)}`)
                    .join(', ')}
                  .
                </p>
              </div>
            )}
            {detail.repayments && detail.repayments.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-warm-900">
                  Repayments so far
                </h4>
                <ul className="space-y-1 text-sm text-warm-600">
                  {detail.repayments.map((r) => (
                    <li key={r.id}>
                      {formatPeriod(r.month, r.year)} · {formatCurrency(r.amount)} ·{' '}
                      {r.source}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDetailOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* Withdraw confirmation */}
      <Modal
        isOpen={!!cancelling}
        onClose={() => setCancelling(null)}
        title="Withdraw Request"
        size="sm"
      >
        <p className="text-warm-600">
          Withdraw this request? It cannot be re-opened, but you can submit a new
          one.
        </p>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setCancelling(null)}
            disabled={saving}
          >
            Keep it
          </Button>
          <Button variant="danger" onClick={confirmCancel} loading={saving}>
            Withdraw
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
