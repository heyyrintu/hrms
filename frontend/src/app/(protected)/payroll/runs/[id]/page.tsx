'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { payrollApi } from '@/lib/api';
import { payrollDepthApi, PayrollRunType, SalaryHold } from '@/lib/api-payroll-depth';
import { formatCurrency, isPositiveMoney } from '@/lib/salaryCalculations';
import { PayrollRun, Payslip, PayrollRunStatus } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { RunAdjustmentsTabs } from '@/components/payroll/adjustments/RunAdjustmentsTabs';
import { RunTypeBadge } from '@/components/payroll/adjustments/RunTypeBadge';
import { PAYROLL_ADMIN_ROLES } from '@/components/payroll/adjustments/shared';
import type { RunContext, RunEmployee } from '@/components/payroll/adjustments/types';
import toast from 'react-hot-toast';
import {
    AlertTriangle,
    ArrowLeft,
    Play,
    CheckCircle,
    CreditCard,
    FileText,
    Download,
} from 'lucide-react';

const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const monthShort = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const statusColors: Record<PayrollRunStatus, string> = {
    [PayrollRunStatus.DRAFT]: 'gray',
    [PayrollRunStatus.PROCESSING]: 'warning',
    [PayrollRunStatus.COMPUTED]: 'info',
    [PayrollRunStatus.APPROVED]: 'success',
    [PayrollRunStatus.PAID]: 'success',
};

/** A payslip with the Keka wave C money columns (decimal strings; absent on old rows). */
type DetailPayslip = Payslip & {
    nonTaxableEarnings?: string;
    arrearsAmount?: string;
    reimbursementAmount?: string;
};

/** A run with the Keka wave C fields (absent on old rows). */
type DetailRun = Omit<PayrollRun, 'payslips'> & {
    runType?: PayrollRunType;
    sequence?: number;
    needsRecompute?: boolean;
    offCycleReason?: string | null;
    scopeEmployeeIds?: string[];
    payslips?: DetailPayslip[];
};

export default function PayrollRunDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { hasRole } = useAuth();
    const canAdjust = hasRole(...PAYROLL_ADMIN_ROLES);
    const runId = params.id as string;
    const [run, setRun] = useState<DetailRun | null>(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [holds, setHolds] = useState<SalaryHold[]>([]);
    const [holdsLoading, setHoldsLoading] = useState(true);
    const [holdsError, setHoldsError] = useState(false);

    /** `silent` keeps the page mounted (tabs keep their state) while refetching. */
    const loadRun = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await payrollApi.getRun(runId);
            setRun(res.data);
        } catch {
            toast.error('Failed to load payroll run');
        } finally {
            if (!silent) setLoading(false);
        }
    }, [runId]);

    const loadHolds = useCallback(async () => {
        setHoldsLoading(true);
        setHoldsError(false);
        try {
            const res = await payrollDepthApi.listRunHolds(runId);
            setHolds(res.data ?? []);
        } catch {
            setHoldsError(true);
        } finally {
            setHoldsLoading(false);
        }
    }, [runId]);

    useEffect(() => {
        loadRun();
    }, [loadRun]);

    useEffect(() => {
        if (canAdjust) loadHolds();
    }, [canAdjust, loadHolds]);

    const handleProcess = async () => {
        setProcessing(true);
        try {
            await payrollApi.processRun(runId);
            toast.success('Payroll processed successfully');
            loadRun();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to process');
        } finally {
            setProcessing(false);
        }
    };

    const handleApprove = async () => {
        try {
            await payrollApi.approveRun(runId);
            toast.success('Payroll approved');
            loadRun();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to approve');
        }
    };

    const handleMarkPaid = async () => {
        try {
            await payrollApi.markAsPaid(runId);
            toast.success('Marked as paid');
            loadRun();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to mark as paid');
        }
    };

    const handleDownload = async (slip: Payslip) => {
        setDownloading(slip.id);
        try {
            const m = run?.month ?? 0;
            const y = run?.year ?? '';
            const filename = `payslip-${slip.employee?.employeeCode ?? 'emp'}-${monthShort[m]}-${y}.pdf`;
            await payrollApi.downloadPayslip(slip.id, filename);
        } catch {
            toast.error('Failed to download payslip');
        } finally {
            setDownloading(null);
        }
    };

    // HELD and VOIDED salaries are both withheld from this run's transfer.
    const heldEmployeeIds = useMemo(
        () => new Set(holds.filter((h) => h.status === 'HELD' || h.status === 'VOIDED').map((h) => h.employee.id)),
        [holds],
    );

    const payslips = useMemo(() => run?.payslips || [], [run]);

    const payslipEmployees = useMemo<RunEmployee[]>(
        () =>
            payslips
                .filter((s) => s.employee)
                .map((s) => ({
                    id: s.employee!.id,
                    employeeCode: s.employee!.employeeCode,
                    firstName: s.employee!.firstName,
                    lastName: s.employee!.lastName,
                })),
        [payslips],
    );

    const runContext = useMemo<RunContext | null>(
        () =>
            run
                ? {
                      id: run.id,
                      month: run.month,
                      year: run.year,
                      status: String(run.status) as RunContext['status'],
                      runType: run.runType ?? 'REGULAR',
                      sequence: run.sequence ?? 0,
                  }
                : null,
        [run],
    );

    if (loading) {
        return (
            <>
                <div className="flex items-center justify-center py-20">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                </div>
            </>
        );
    }

    if (!run || !runContext) {
        return (
            <>
                <Card>
                    <CardContent className="py-16 text-center">
                        <p className="text-warm-600">Payroll run not found.</p>
                        <Button variant="secondary" onClick={() => router.push('/payroll')} className="mt-4">
                            Back to Payroll
                        </Button>
                    </CardContent>
                </Card>
            </>
        );
    }

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                    <div>
                        <button
                            onClick={() => router.push('/payroll')}
                            className="flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700 mb-2"
                        >
                            <ArrowLeft className="w-4 h-4" /> Back to Payroll
                        </button>
                        <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex flex-wrap items-center gap-2">
                            <FileText className="w-7 h-7 text-primary-600" />
                            {monthNames[run.month]} {run.year}
                            <Badge variant={statusColors[run.status] as any}>
                                {run.status}
                            </Badge>
                            <RunTypeBadge runType={run.runType} sequence={run.sequence} />
                        </h1>
                        {run.offCycleReason && (
                            <p className="text-warm-600 mt-1">{run.offCycleReason}</p>
                        )}
                        {run.remarks && (
                            <p className="text-warm-600 mt-1">{run.remarks}</p>
                        )}
                    </div>
                    <div className="flex gap-2">
                        {run.status === PayrollRunStatus.DRAFT && (
                            <Button onClick={handleProcess} loading={processing}>
                                <Play className="w-4 h-4 mr-2" /> Process
                            </Button>
                        )}
                        {run.status === PayrollRunStatus.COMPUTED && (
                            <Button onClick={handleApprove}>
                                <CheckCircle className="w-4 h-4 mr-2" /> Approve
                            </Button>
                        )}
                        {run.status === PayrollRunStatus.APPROVED && (
                            <Button onClick={handleMarkPaid}>
                                <CreditCard className="w-4 h-4 mr-2" /> Mark Paid
                            </Button>
                        )}
                    </div>
                </div>

                {run.needsRecompute && (
                    <div
                        role="status"
                        className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                    >
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>Inputs changed since this run was computed — recompute before approval</span>
                    </div>
                )}

                {/* Summary Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-warm-500">Employees</p>
                            <p className="text-2xl font-bold text-warm-900">{payslips.length}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-warm-500">Total Gross</p>
                            <p className="text-2xl font-bold text-warm-900">
                                {formatCurrency(run.totalGross)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-warm-500">Total Deductions</p>
                            <p className="text-2xl font-bold text-red-600">
                                {formatCurrency(run.totalDeductions)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-warm-500">Total Net Pay</p>
                            <p className="text-2xl font-bold text-emerald-600">
                                {formatCurrency(run.totalNet)}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Payslips Table */}
                {payslips.length === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <p className="text-warm-600">
                                {run.status === PayrollRunStatus.DRAFT
                                    ? 'No payslips yet. Process this run to generate payslips.'
                                    : 'No payslips found for this run.'}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-warm-200 bg-warm-50">
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase">Employee</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-warm-600 uppercase">Department</th>
                                        <th className="px-4 py-3 text-center text-xs font-semibold text-warm-600 uppercase">Days</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase">Base Pay</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase">OT Pay</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase">Gross</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase">Other</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase">Deductions</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-warm-600 uppercase">Net Pay</th>
                                        <th className="px-4 py-3 text-center text-xs font-semibold text-warm-600 uppercase">PDF</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-warm-100">
                                    {payslips.map((slip) => {
                                        const extras = [
                                            isPositiveMoney(slip.arrearsAmount ?? '0') && `Arrears ${formatCurrency(slip.arrearsAmount!)}`,
                                            isPositiveMoney(slip.reimbursementAmount ?? '0') && `Reimb. ${formatCurrency(slip.reimbursementAmount!)}`,
                                            isPositiveMoney(slip.nonTaxableEarnings ?? '0') && `Non-taxable ${formatCurrency(slip.nonTaxableEarnings!)}`,
                                        ].filter(Boolean) as string[];
                                        return (
                                            <tr key={slip.id} className="hover:bg-warm-50">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-medium text-warm-900 text-sm">
                                                            {slip.employee?.firstName} {slip.employee?.lastName}
                                                        </p>
                                                        {heldEmployeeIds.has(slip.employeeId) && (
                                                            <Badge variant="warning">Held</Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-warm-500">
                                                        {slip.employee?.employeeCode}
                                                    </p>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-warm-600">
                                                    {slip.employee?.department?.name || '-'}
                                                </td>
                                                <td className="px-4 py-3 text-center text-sm">
                                                    <span className="text-warm-900">{slip.presentDays}</span>
                                                    <span className="text-warm-400">/{slip.workingDays}</span>
                                                    {slip.lopDays > 0 && (
                                                        <span className="text-red-500 text-xs ml-1">
                                                            ({slip.lopDays} LOP)
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right text-sm">
                                                    {formatCurrency(slip.basePay)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-sm text-blue-600">
                                                    {isPositiveMoney(slip.otPay)
                                                        ? formatCurrency(slip.otPay)
                                                        : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-right text-sm font-medium">
                                                    {formatCurrency(slip.grossPay)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-xs text-warm-600">
                                                    {extras.length === 0
                                                        ? '-'
                                                        : extras.map((line) => <p key={line}>{line}</p>)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-sm text-red-600">
                                                    {formatCurrency(slip.totalDeductions)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-sm font-bold text-emerald-700">
                                                    {formatCurrency(slip.netPay)}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={() => handleDownload(slip)}
                                                        disabled={downloading === slip.id}
                                                        className="p-1.5 text-warm-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50"
                                                        title="Download payslip PDF"
                                                    >
                                                        {downloading === slip.id ? (
                                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                                                        ) : (
                                                            <Download className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}

                {canAdjust && (
                    <RunAdjustmentsTabs
                        run={runContext}
                        scopeEmployeeIds={run.scopeEmployeeIds ?? []}
                        payslipEmployees={payslipEmployees}
                        holds={holds}
                        holdsLoading={holdsLoading}
                        holdsError={holdsError}
                        reloadHolds={loadHolds}
                        onInputsChanged={() => loadRun(true)}
                    />
                )}
            </div>
        </>
    );
}
