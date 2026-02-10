'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { payrollApi } from '@/lib/api';
import { PayrollRun, Payslip, PayrollRunStatus } from '@/types';
import toast from 'react-hot-toast';
import {
    ArrowLeft,
    Play,
    CheckCircle,
    CreditCard,
    FileText,
} from 'lucide-react';

const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const statusColors: Record<PayrollRunStatus, string> = {
    [PayrollRunStatus.DRAFT]: 'gray',
    [PayrollRunStatus.PROCESSING]: 'warning',
    [PayrollRunStatus.COMPUTED]: 'info',
    [PayrollRunStatus.APPROVED]: 'success',
    [PayrollRunStatus.PAID]: 'success',
};

export default function PayrollRunDetailPage() {
    const params = useParams();
    const router = useRouter();
    const runId = params.id as string;
    const [run, setRun] = useState<PayrollRun | null>(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        loadRun();
    }, [runId]);

    const loadRun = async () => {
        setLoading(true);
        try {
            const res = await payrollApi.getRun(runId);
            setRun(res.data);
        } catch {
            toast.error('Failed to load payroll run');
        } finally {
            setLoading(false);
        }
    };

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

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(val);

    if (loading) {
        return (
            <>
                <div className="flex items-center justify-center py-20">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                </div>
            </>
        );
    }

    if (!run) {
        return (
            <>
                <Card>
                    <CardContent className="py-16 text-center">
                        <p className="text-gray-600">Payroll run not found.</p>
                        <Button variant="secondary" onClick={() => router.push('/payroll')} className="mt-4">
                            Back to Payroll
                        </Button>
                    </CardContent>
                </Card>
            </>
        );
    }

    const payslips = run.payslips || [];

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <button
                            onClick={() => router.push('/payroll')}
                            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2"
                        >
                            <ArrowLeft className="w-4 h-4" /> Back to Payroll
                        </button>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <FileText className="w-7 h-7 text-primary-600" />
                            {monthNames[run.month]} {run.year}
                            <Badge variant={statusColors[run.status] as any}>
                                {run.status}
                            </Badge>
                        </h1>
                        {run.remarks && (
                            <p className="text-gray-600 mt-1">{run.remarks}</p>
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

                {/* Summary Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-gray-500">Employees</p>
                            <p className="text-2xl font-bold text-gray-900">{payslips.length}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-gray-500">Total Gross</p>
                            <p className="text-2xl font-bold text-gray-900">
                                {formatCurrency(Number(run.totalGross))}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-gray-500">Total Deductions</p>
                            <p className="text-2xl font-bold text-red-600">
                                {formatCurrency(Number(run.totalDeductions))}
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-gray-500">Total Net Pay</p>
                            <p className="text-2xl font-bold text-green-600">
                                {formatCurrency(Number(run.totalNet))}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Payslips Table */}
                {payslips.length === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <p className="text-gray-600">
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
                                    <tr className="border-b border-gray-200 bg-gray-50">
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Employee</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Department</th>
                                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Days</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Base Pay</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">OT Pay</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Gross</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Deductions</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Net Pay</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {payslips.map((slip: Payslip) => (
                                        <tr key={slip.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-gray-900 text-sm">
                                                    {slip.employee?.firstName} {slip.employee?.lastName}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    {slip.employee?.employeeCode}
                                                </p>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {slip.employee?.department?.name || '-'}
                                            </td>
                                            <td className="px-4 py-3 text-center text-sm">
                                                <span className="text-gray-900">{slip.presentDays}</span>
                                                <span className="text-gray-400">/{slip.workingDays}</span>
                                                {slip.lopDays > 0 && (
                                                    <span className="text-red-500 text-xs ml-1">
                                                        ({slip.lopDays} LOP)
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm">
                                                {formatCurrency(Number(slip.basePay))}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm text-blue-600">
                                                {Number(slip.otPay) > 0
                                                    ? formatCurrency(Number(slip.otPay))
                                                    : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm font-medium">
                                                {formatCurrency(Number(slip.grossPay))}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm text-red-600">
                                                {formatCurrency(Number(slip.totalDeductions))}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm font-bold text-green-700">
                                                {formatCurrency(Number(slip.netPay))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}
            </div>
        </>
    );
}
