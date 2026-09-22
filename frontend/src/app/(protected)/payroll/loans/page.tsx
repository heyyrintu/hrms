'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { formatPeriod } from '@/lib/loanSchedule';
import { formatCurrency } from '@/lib/salaryCalculations';
import { cn } from '@/lib/utils';
import { Banknote, IndianRupee, RefreshCw, Receipt } from 'lucide-react';
import toast from 'react-hot-toast';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

const statusLabels: Record<LoanStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

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

const STATUS_FILTERS: { key: '' | LoanStatus; label: string }[] = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'CLOSED', label: 'Closed' },
  { key: '', label: 'All' },
];

const borrowerName = (loan: Loan) =>
  loan.employee
    ? `${loan.employee.firstName} ${loan.employee.lastName}`
    : 'Unknown employee';

const thisMonth = () => {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
};

export default function PayrollLoansPage() {
  const [status, setStatus] = useState<'' | LoanStatus>('ACTIVE');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Loan | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [repaying, setRepaying] = useState<Loan | null>(null);
  const [repayment, setRepayment] = useState({
    ...thisMonth(),
    amount: '',
    note: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loansApi.getAll(status ? { status } : undefined);
      setLoans(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load loans');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (loan: Loan) => {
    setDetail(loan);
    setDetailOpen(true);
    try {
      const res = await loansApi.getById(loan.id);
      setDetail(res.data);
    } catch {
      toast.error('Failed to load the repayment history');
    }
  };

  const openRepayment = (loan: Loan) => {
    setRepaying(loan);
    setRepayment({
      ...thisMonth(),
      amount: String(Math.min(loan.emiAmount, loan.outstandingAmount)),
      note: '',
    });
  };

  const submitRepayment = async () => {
    if (!repaying) return;
    const amount = Number(repayment.amount) || 0;
    if (amount <= 0) {
      toast.error('Enter the amount repaid');
      return;
    }

    setSaving(true);
    try {
      await loansApi.recordRepayment(repaying.id, {
        month: repayment.month,
        year: repayment.year,
        amount,
        note: repayment.note.trim() || undefined,
      });
      toast.success('Repayment recorded');
      setRepaying(null);
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(
        axiosError.response?.data?.message || 'Failed to record the repayment',
      );
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
              <Banknote className="h-6 w-6 text-primary-600" />
              Loan Register
            </h1>
            <p className="mt-1 text-warm-600">
              Every loan and advance, its balance and its repayments
            </p>
          </div>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-warm-200">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.label}
              onClick={() => setStatus(filter.key)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                status === filter.key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-warm-500 hover:text-warm-700',
              )}
            >
              {filter.label}
            </button>
          ))}
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
                No loans
              </h3>
              <p className="text-warm-600">
                Nothing matches this filter yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-warm-100 text-left text-warm-600">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Principal</th>
                    <th className="px-4 py-3">EMI</th>
                    <th className="px-4 py-3">Outstanding</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map((loan) => (
                    <tr key={loan.id} className="border-b border-warm-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-warm-900">
                          {borrowerName(loan)}
                        </div>
                        {loan.employee?.employeeCode && (
                          <div className="text-xs text-warm-500">
                            {loan.employee.employeeCode}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">{typeLabels[loan.type]}</td>
                      <td className="px-4 py-3">
                        {formatCurrency(loan.principal)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(loan.emiAmount)}
                      </td>
                      <td className="px-4 py-3">
                        {formatCurrency(loan.outstandingAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusColors[loan.status]}>
                          {statusLabels[loan.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => openDetail(loan)}
                          >
                            <Receipt className="mr-2 h-4 w-4" />
                            History
                          </Button>
                          {loan.status === 'ACTIVE' && (
                            <Button onClick={() => openRepayment(loan)}>
                              <IndianRupee className="mr-2 h-4 w-4" />
                              Record Repayment
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Repayments and schedule */}
      <Modal
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        title="Loan History"
        size="lg"
      >
        {detail && (
          <div className="space-y-4">
            <p className="text-sm text-warm-600">
              {borrowerName(detail)} · {typeLabels[detail.type]} of{' '}
              {formatCurrency(detail.principal)} · outstanding{' '}
              {formatCurrency(detail.outstandingAmount)}
            </p>

            <div>
              <h4 className="mb-2 text-sm font-semibold text-warm-900">
                Repayments
              </h4>
              {detail.repayments && detail.repayments.length > 0 ? (
                <table className="w-full text-sm">
                  <thead className="bg-warm-100 text-left text-warm-600">
                    <tr>
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.repayments.map((r) => (
                      <tr key={r.id} className="border-b border-warm-100">
                        <td className="px-3 py-2">
                          {formatPeriod(r.month, r.year)}
                        </td>
                        <td className="px-3 py-2">{formatCurrency(r.amount)}</td>
                        <td className="px-3 py-2">{r.source}</td>
                        <td className="px-3 py-2">{r.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-warm-500">
                  No repayments recorded yet.
                </p>
              )}
            </div>

            {detail.schedule && detail.schedule.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-warm-900">
                  Schedule
                </h4>
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-warm-100 text-left text-warm-600">
                      <tr>
                        <th className="px-3 py-2">Period</th>
                        <th className="px-3 py-2">EMI</th>
                        <th className="px-3 py-2">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.schedule.map((row) => (
                        <tr
                          key={`${row.year}-${row.month}`}
                          className="border-b border-warm-100"
                        >
                          <td className="px-3 py-2">
                            {formatPeriod(row.month, row.year)}
                          </td>
                          <td className="px-3 py-2">{formatCurrency(row.emi)}</td>
                          <td className="px-3 py-2">
                            {formatCurrency(row.balanceAfter)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

      {/* Manual repayment */}
      <Modal
        isOpen={!!repaying}
        onClose={() => setRepaying(null)}
        title="Record a Repayment"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-warm-600">
            For repayments made outside payroll. Payroll instalments are written
            automatically when the payslip is finalised.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="repayment-month"
                className="mb-1 block text-sm font-medium text-warm-700"
              >
                Month *
              </label>
              <select
                id="repayment-month"
                value={repayment.month}
                onChange={(e) =>
                  setRepayment({ ...repayment, month: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-warm-300 px-3 py-2"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {formatPeriod(m, repayment.year).split(' ')[0]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="repayment-year"
                className="mb-1 block text-sm font-medium text-warm-700"
              >
                Year *
              </label>
              <input
                id="repayment-year"
                type="number"
                value={repayment.year}
                onChange={(e) =>
                  setRepayment({ ...repayment, year: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-warm-300 px-3 py-2"
              />
            </div>
            <div>
              <label
                htmlFor="repayment-amount"
                className="mb-1 block text-sm font-medium text-warm-700"
              >
                Amount *
              </label>
              <input
                id="repayment-amount"
                type="number"
                min={0.01}
                step="0.01"
                value={repayment.amount}
                onChange={(e) =>
                  setRepayment({ ...repayment, amount: e.target.value })
                }
                className="w-full rounded-lg border border-warm-300 px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="repayment-note"
              className="mb-1 block text-sm font-medium text-warm-700"
            >
              Note
            </label>
            <input
              id="repayment-note"
              value={repayment.note}
              onChange={(e) =>
                setRepayment({ ...repayment, note: e.target.value })
              }
              placeholder="Transfer reference"
              className="w-full rounded-lg border border-warm-300 px-3 py-2"
            />
          </div>
          {repaying && (
            <p className="text-sm text-warm-500">
              Outstanding balance{' '}
              {formatCurrency(repaying.outstandingAmount)}
            </p>
          )}
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setRepaying(null)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            onClick={submitRepayment}
            loading={saving}
            disabled={!(Number(repayment.amount) > 0)}
          >
            Save Repayment
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
