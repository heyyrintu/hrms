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
import {
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
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

/**
 * The queue only shows what is still waiting on HR: pending requests and
 * approved loans that have not had the money paid out yet. Everything else
 * lives on the payroll loan register.
 */
const QUEUE_FILTERS: { key: LoanStatus; label: string }[] = [
  { key: 'REQUESTED', label: 'Pending' },
  { key: 'APPROVED', label: 'Awaiting disbursement' },
];

const borrowerName = (loan: Loan) =>
  loan.employee
    ? `${loan.employee.firstName} ${loan.employee.lastName}`
    : 'Unknown employee';

export default function LoanApprovalsPage() {
  const [status, setStatus] = useState<LoanStatus>('REQUESTED');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [rejecting, setRejecting] = useState<Loan | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loansApi.getAll({ status });
      setLoans(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load loan requests');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (
    run: () => Promise<unknown>,
    successMessage: string,
    failureMessage: string,
  ) => {
    setSaving(true);
    try {
      await run();
      toast.success(successMessage);
      await load();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || failureMessage);
    } finally {
      setSaving(false);
    }
  };

  const approve = (loan: Loan) =>
    act(
      () => loansApi.approve(loan.id),
      'Loan approved',
      'Failed to approve the loan',
    );

  const disburse = (loan: Loan) =>
    act(
      () => loansApi.disburse(loan.id),
      'Marked as disbursed',
      'Failed to mark the loan as disbursed',
    );

  const confirmReject = async () => {
    if (!rejecting) return;
    if (!reason.trim()) {
      toast.error('Give the employee a reason');
      return;
    }
    await act(
      () => loansApi.reject(rejecting.id, reason.trim()),
      'Loan rejected',
      'Failed to reject the loan',
    );
    setRejecting(null);
    setReason('');
  };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
              <ClipboardCheck className="h-6 w-6 text-primary-600" />
              Loan Approvals
            </h1>
            <p className="mt-1 text-warm-600">
              Approve, reject and disburse staff loans and salary advances
            </p>
          </div>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-warm-200">
          {QUEUE_FILTERS.map((filter) => (
            <button
              key={filter.key}
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
                Nothing to action
              </h3>
              <p className="text-warm-600">
                {status === 'REQUESTED'
                  ? 'No loan requests are waiting for a decision.'
                  : 'No approved loans are waiting to be disbursed.'}
              </p>
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
                          {borrowerName(loan)}
                        </span>
                        {loan.employee?.employeeCode && (
                          <span className="text-sm text-warm-500">
                            ({loan.employee.employeeCode})
                          </span>
                        )}
                        <Badge variant={statusColors[loan.status]}>
                          {statusLabels[loan.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-warm-700">
                        {typeLabels[loan.type]} ·{' '}
                        {formatCurrency(loan.principal)} over{' '}
                        {loan.tenureMonths} months at {loan.interestRate}%
                      </p>
                      <p className="mt-1 text-sm text-warm-500">
                        EMI {formatCurrency(loan.emiAmount)} · total{' '}
                        {formatCurrency(loan.totalPayable)} · first instalment{' '}
                        {formatPeriod(loan.startMonth, loan.startYear)}
                      </p>
                      {loan.purpose && (
                        <p className="mt-1 text-sm text-warm-600">
                          Purpose: {loan.purpose}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {loan.status === 'REQUESTED' && (
                        <>
                          <Button onClick={() => approve(loan)} disabled={saving}>
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => {
                              setRejecting(loan);
                              setReason('');
                            }}
                            disabled={saving}
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Reject
                          </Button>
                        </>
                      )}
                      {loan.status === 'APPROVED' && (
                        <Button onClick={() => disburse(loan)} disabled={saving}>
                          <Send className="mr-2 h-4 w-4" />
                          Mark Disbursed
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

      <Modal
        isOpen={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject Loan Request"
        size="md"
      >
        <div className="space-y-3">
          <p className="text-warm-600">
            {rejecting ? borrowerName(rejecting) : ''} will see this reason, so
            make it specific.
          </p>
          <div>
            <label
              htmlFor="reject-reason"
              className="mb-1 block text-sm font-medium text-warm-700"
            >
              Reason *
            </label>
            <textarea
              id="reject-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full resize-none rounded-lg border border-warm-300 px-3 py-2"
            />
          </div>
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setRejecting(null)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={confirmReject}
            loading={saving}
            disabled={!reason.trim()}
          >
            Reject
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
