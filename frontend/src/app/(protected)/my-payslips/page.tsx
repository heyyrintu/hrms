'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { payrollApi } from '@/lib/api';
import { Payslip, PayrollRunStatus } from '@/types';
import toast from 'react-hot-toast';
import { Receipt, ChevronDown, ChevronUp, Download } from 'lucide-react';

const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

export default function MyPayslipsPage() {
    const [payslips, setPayslips] = useState<Payslip[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);

    useEffect(() => {
        loadPayslips();
    }, []);

    const loadPayslips = async () => {
        setLoading(true);
        try {
            const res = await payrollApi.getMyPayslips();
            setPayslips(res.data);
        } catch {
            toast.error('Failed to load payslips');
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(val);

    const handleDownload = async (slip: Payslip) => {
        setDownloading(slip.id);
        try {
            const month = slip.payrollRun?.month ?? 0;
            const year = slip.payrollRun?.year ?? '';
            const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const filename = `payslip-${monthNames[month]}-${year}.pdf`;
            await payrollApi.downloadPayslip(slip.id, filename);
        } catch {
            toast.error('Failed to download payslip');
        } finally {
            setDownloading(null);
        }
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
                        <Receipt className="w-7 h-7 text-primary-600" />
                        My Payslips
                    </h1>
                    <p className="text-warm-600 mt-1">
                        View your salary breakdown and payment history
                    </p>
                </div>

                {/* Payslips */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : payslips.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Receipt className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-warm-900 mb-2">
                                No Payslips Yet
                            </h3>
                            <p className="text-warm-600">
                                Your payslips will appear here once payroll is processed.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {payslips.map((slip) => {
                            const isExpanded = expandedId === slip.id;
                            const earnings = (slip.earnings || []) as { name: string; amount: number }[];
                            const deductions = (slip.deductions || []) as { name: string; amount: number }[];

                            return (
                                <Card key={slip.id}>
                                    <CardContent className="py-4">
                                        {/* Summary row */}
                                        <button
                                            onClick={() => setExpandedId(isExpanded ? null : slip.id)}
                                            className="w-full flex items-center justify-between"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                                                    <Receipt className="w-5 h-5 text-primary-600" />
                                                </div>
                                                <div className="text-left">
                                                    <p className="font-semibold text-warm-900">
                                                        {monthNames[slip.payrollRun?.month || 0]} {slip.payrollRun?.year}
                                                    </p>
                                                    <p className="text-xs text-warm-500">
                                                        {slip.presentDays}/{slip.workingDays} days worked
                                                        {slip.lopDays > 0 && ` | ${slip.lopDays} LOP`}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="text-right">
                                                    <p className="text-lg font-bold text-emerald-700">
                                                        {formatCurrency(Number(slip.netPay))}
                                                    </p>
                                                    <Badge
                                                        variant={
                                                            slip.payrollRun?.status === PayrollRunStatus.PAID
                                                                ? 'success'
                                                                : 'info'
                                                        }
                                                    >
                                                        {slip.payrollRun?.status === PayrollRunStatus.PAID
                                                            ? 'Paid'
                                                            : 'Approved'}
                                                    </Badge>
                                                </div>
                                                {isExpanded ? (
                                                    <ChevronUp className="w-5 h-5 text-warm-400" />
                                                ) : (
                                                    <ChevronDown className="w-5 h-5 text-warm-400" />
                                                )}
                                            </div>
                                        </button>

                                        {/* Expanded details */}
                                        {isExpanded && (
                                            <div className="mt-4 pt-4 border-t border-warm-100">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                    {/* Earnings */}
                                                    <div>
                                                        <h4 className="text-sm font-semibold text-warm-700 mb-2">Earnings</h4>
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between text-sm">
                                                                <span className="text-warm-600">Base Pay</span>
                                                                <span className="font-medium">
                                                                    {formatCurrency(Number(slip.basePay))}
                                                                </span>
                                                            </div>
                                                            {earnings.map((e, i) => (
                                                                <div key={i} className="flex justify-between text-sm">
                                                                    <span className="text-warm-600">{e.name}</span>
                                                                    <span className="font-medium">
                                                                        {formatCurrency(e.amount)}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                            {Number(slip.otPay) > 0 && (
                                                                <div className="flex justify-between text-sm">
                                                                    <span className="text-warm-600">
                                                                        OT Pay ({Number(slip.otHours)}h)
                                                                    </span>
                                                                    <span className="font-medium text-blue-600">
                                                                        {formatCurrency(Number(slip.otPay))}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-warm-200">
                                                                <span>Gross Pay</span>
                                                                <span>{formatCurrency(Number(slip.grossPay))}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Deductions */}
                                                    <div>
                                                        <h4 className="text-sm font-semibold text-warm-700 mb-2">Deductions</h4>
                                                        <div className="space-y-1.5">
                                                            {deductions.length > 0 ? (
                                                                deductions.map((d, i) => (
                                                                    <div key={i} className="flex justify-between text-sm">
                                                                        <span className="text-warm-600">{d.name}</span>
                                                                        <span className="font-medium text-red-600">
                                                                            {formatCurrency(d.amount)}
                                                                        </span>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <p className="text-sm text-warm-400">No deductions</p>
                                                            )}
                                                            <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-warm-200">
                                                                <span>Total Deductions</span>
                                                                <span className="text-red-600">
                                                                    {formatCurrency(Number(slip.totalDeductions))}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Net Pay */}
                                                <div className="mt-4 p-3 bg-emerald-50 rounded-lg flex justify-between items-center">
                                                    <span className="font-semibold text-emerald-900">Net Pay</span>
                                                    <span className="text-xl font-bold text-emerald-700">
                                                        {formatCurrency(Number(slip.netPay))}
                                                    </span>
                                                </div>

                                                {/* Download */}
                                                <div className="mt-3 flex justify-end">
                                                    <button
                                                        onClick={() => handleDownload(slip)}
                                                        disabled={downloading === slip.id}
                                                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50"
                                                    >
                                                        {downloading === slip.id ? (
                                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                                                        ) : (
                                                            <Download className="w-4 h-4" />
                                                        )}
                                                        Download PDF
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
}
