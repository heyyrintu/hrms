'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { payrollApi } from '@/lib/api';
import { PayrollRun, PayrollRunStatus } from '@/types';
import toast from 'react-hot-toast';
import {
    DollarSign,
    Plus,
    Play,
    CheckCircle,
    CreditCard,
    Trash2,
    Eye,
    Calculator,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

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

export default function PayrollPage() {
    const router = useRouter();
    const [runs, setRuns] = useState<PayrollRun[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [processing, setProcessing] = useState<string | null>(null);
    const [newMonth, setNewMonth] = useState(new Date().getMonth() + 1);
    const [newYear, setNewYear] = useState(new Date().getFullYear());
    const [filterYear, setFilterYear] = useState('');

    useEffect(() => {
        loadRuns();
    }, [filterYear]);

    const loadRuns = async () => {
        setLoading(true);
        try {
            const params: Record<string, unknown> = {};
            if (filterYear) params.year = filterYear;
            const res = await payrollApi.getRuns(params);
            setRuns(res.data);
        } catch {
            toast.error('Failed to load payroll runs');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        setCreating(true);
        try {
            await payrollApi.createRun({ month: newMonth, year: newYear });
            toast.success('Payroll run created');
            setShowCreate(false);
            loadRuns();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to create run');
        } finally {
            setCreating(false);
        }
    };

    const handleProcess = async (id: string) => {
        setProcessing(id);
        try {
            await payrollApi.processRun(id);
            toast.success('Payroll processed successfully');
            loadRuns();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to process payroll');
        } finally {
            setProcessing(null);
        }
    };

    const handleApprove = async (id: string) => {
        try {
            await payrollApi.approveRun(id);
            toast.success('Payroll approved');
            loadRuns();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to approve');
        }
    };

    const handleMarkPaid = async (id: string) => {
        try {
            await payrollApi.markAsPaid(id);
            toast.success('Marked as paid');
            loadRuns();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to mark as paid');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this payroll run?')) return;
        try {
            await payrollApi.deleteRun(id);
            toast.success('Run deleted');
            loadRuns();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to delete');
        }
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(val);

    // Summary stats
    const totalPaid = runs
        .filter((r) => r.status === PayrollRunStatus.PAID)
        .reduce((sum, r) => sum + Number(r.totalNet), 0);
    const pendingRuns = runs.filter(
        (r) => r.status === PayrollRunStatus.DRAFT || r.status === PayrollRunStatus.COMPUTED,
    ).length;

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <DollarSign className="w-7 h-7 text-primary-600" />
                            Payroll
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Manage payroll runs, process salaries, and generate payslips
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => router.push('/payroll/structures')}
                        >
                            <Calculator className="w-4 h-4 mr-2" />
                            Salary Structures
                        </Button>
                        <Button onClick={() => setShowCreate(true)}>
                            <Plus className="w-4 h-4 mr-2" />
                            New Run
                        </Button>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-gray-500">Total Runs</p>
                            <p className="text-2xl font-bold text-gray-900">{runs.length}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-gray-500">Pending Actions</p>
                            <p className="text-2xl font-bold text-orange-600">{pendingRuns}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <p className="text-sm text-gray-500">Total Paid Out</p>
                            <p className="text-2xl font-bold text-green-600">{formatCurrency(totalPaid)}</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Filter */}
                <div className="flex gap-3 items-center">
                    <select
                        value={filterYear}
                        onChange={(e) => setFilterYear(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                    >
                        <option value="">All Years</option>
                        {[0, 1, 2].map((offset) => {
                            const y = new Date().getFullYear() - offset;
                            return (
                                <option key={y} value={y}>{y}</option>
                            );
                        })}
                    </select>
                </div>

                {/* Runs Table */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : runs.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <DollarSign className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                No Payroll Runs
                            </h3>
                            <p className="text-gray-600">
                                Create your first payroll run to get started.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-200 bg-gray-50">
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Period</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Employees</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Gross</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Deductions</th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Net Pay</th>
                                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {runs.map((run) => (
                                        <tr key={run.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-gray-900">
                                                    {monthNames[run.month]} {run.year}
                                                </p>
                                                {run.remarks && (
                                                    <p className="text-xs text-gray-500">{run.remarks}</p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant={statusColors[run.status] as any}>
                                                    {run.status}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm">
                                                {run.processedCount || run._count?.payslips || 0}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm font-medium">
                                                {formatCurrency(Number(run.totalGross))}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm text-red-600">
                                                {formatCurrency(Number(run.totalDeductions))}
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm font-bold text-green-700">
                                                {formatCurrency(Number(run.totalNet))}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button
                                                        onClick={() => router.push(`/payroll/runs/${run.id}`)}
                                                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                                        title="View payslips"
                                                    >
                                                        <Eye className="w-4 h-4" />
                                                    </button>
                                                    {run.status === PayrollRunStatus.DRAFT && (
                                                        <>
                                                            <button
                                                                onClick={() => handleProcess(run.id)}
                                                                disabled={processing === run.id}
                                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                                                                title="Process payroll"
                                                            >
                                                                <Play className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleDelete(run.id)}
                                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                                title="Delete"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </>
                                                    )}
                                                    {run.status === PayrollRunStatus.COMPUTED && (
                                                        <button
                                                            onClick={() => handleApprove(run.id)}
                                                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                            title="Approve"
                                                        >
                                                            <CheckCircle className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    {run.status === PayrollRunStatus.APPROVED && (
                                                        <button
                                                            onClick={() => handleMarkPaid(run.id)}
                                                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                            title="Mark as paid"
                                                        >
                                                            <CreditCard className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}
            </div>

            {/* Create Run Modal */}
            <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Payroll Run">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                        <select
                            value={newMonth}
                            onChange={(e) => setNewMonth(parseInt(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                        >
                            {monthNames.slice(1).map((name, i) => (
                                <option key={i + 1} value={i + 1}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                        <select
                            value={newYear}
                            onChange={(e) => setNewYear(parseInt(e.target.value))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                        >
                            {[0, 1].map((offset) => {
                                const y = new Date().getFullYear() - offset;
                                return <option key={y} value={y}>{y}</option>;
                            })}
                        </select>
                    </div>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setShowCreate(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreate} loading={creating}>
                        Create
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
