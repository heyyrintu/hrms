'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { payrollApi, employeesApi } from '@/lib/api';
import { Payslip, PayrollRunStatus, Employee } from '@/types';
import toast from 'react-hot-toast';
import { Receipt, Download, ChevronDown, ChevronUp, ArrowLeft, Search } from 'lucide-react';

const monthNames = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const monthShort = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function AdminPayslipsPage() {
    const router = useRouter();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [payslips, setPayslips] = useState<Payslip[]>([]);
    const [loadingEmployees, setLoadingEmployees] = useState(true);
    const [loadingPayslips, setLoadingPayslips] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    useEffect(() => {
        loadEmployees();
    }, []);

    const loadEmployees = async () => {
        setLoadingEmployees(true);
        try {
            const res = await employeesApi.getAll({ limit: 200 });
            setEmployees(res.data.data || []);
        } catch {
            toast.error('Failed to load employees');
        } finally {
            setLoadingEmployees(false);
        }
    };

    const loadPayslips = async (employeeId: string) => {
        setLoadingPayslips(true);
        setPayslips([]);
        setExpandedId(null);
        try {
            const res = await payrollApi.getEmployeePayslips(employeeId);
            setPayslips(res.data);
        } catch {
            toast.error('Failed to load payslips');
        } finally {
            setLoadingPayslips(false);
        }
    };

    const handleSelectEmployee = (employeeId: string) => {
        setSelectedEmployee(employeeId);
        if (employeeId) loadPayslips(employeeId);
        else setPayslips([]);
    };

    const handleDownload = async (slip: Payslip) => {
        setDownloading(slip.id);
        try {
            const m = slip.payrollRun?.month ?? 0;
            const y = slip.payrollRun?.year ?? '';
            const emp = employees.find(e => e.id === selectedEmployee);
            const code = emp?.employeeCode ?? 'emp';
            const filename = `payslip-${code}-${monthShort[m]}-${y}.pdf`;
            await payrollApi.downloadPayslip(slip.id, filename);
        } catch {
            toast.error('Failed to download payslip');
        } finally {
            setDownloading(null);
        }
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(val);

    const selectedEmp = employees.find(e => e.id === selectedEmployee);

    const filteredEmployees = search.trim()
        ? employees.filter(e =>
            `${e.firstName} ${e.lastName} ${e.employeeCode}`.toLowerCase().includes(search.toLowerCase())
          )
        : employees;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <button
                        onClick={() => router.push('/payroll')}
                        className="flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700 mb-2"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back to Payroll
                    </button>
                    <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
                        <Receipt className="w-7 h-7 text-primary-600" />
                        Employee Payslips
                    </h1>
                    <p className="text-warm-600 mt-1">View and download payslips for any employee</p>
                </div>
            </div>

            {/* Employee Selector */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
                            <input
                                type="text"
                                placeholder="Search employees..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 border border-warm-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                        </div>
                        <div className="flex-1">
                            <select
                                value={selectedEmployee}
                                onChange={(e) => handleSelectEmployee(e.target.value)}
                                disabled={loadingEmployees}
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
                            >
                                <option value="">
                                    {loadingEmployees ? 'Loading employees...' : '— Select an employee —'}
                                </option>
                                {filteredEmployees.map(emp => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.firstName} {emp.lastName} ({emp.employeeCode})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Selected Employee Info */}
            {selectedEmp && (
                <div className="flex items-center gap-3 px-1">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                        {selectedEmp.firstName.charAt(0)}{selectedEmp.lastName.charAt(0)}
                    </div>
                    <div>
                        <p className="font-semibold text-warm-900">
                            {selectedEmp.firstName} {selectedEmp.lastName}
                        </p>
                        <p className="text-xs text-warm-500">
                            {selectedEmp.employeeCode} · {(selectedEmp as any).designation ?? ''} · {(selectedEmp as any).department?.name ?? ''}
                        </p>
                    </div>
                </div>
            )}

            {/* Payslips List */}
            {!selectedEmployee ? (
                <Card>
                    <CardContent className="py-16 text-center">
                        <Receipt className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-warm-900 mb-2">Select an Employee</h3>
                        <p className="text-warm-600">Choose an employee above to view their payslips.</p>
                    </CardContent>
                </Card>
            ) : loadingPayslips ? (
                <div className="flex items-center justify-center py-20">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                </div>
            ) : payslips.length === 0 ? (
                <Card>
                    <CardContent className="py-12 text-center">
                        <Receipt className="w-12 h-12 text-warm-300 mx-auto mb-3" />
                        <p className="text-warm-600">No approved or paid payslips for this employee.</p>
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
                                    <div className="flex items-center justify-between">
                                        <button
                                            onClick={() => setExpandedId(isExpanded ? null : slip.id)}
                                            className="flex items-center gap-4 flex-1 text-left"
                                        >
                                            <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                                                <Receipt className="w-5 h-5 text-primary-600" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-warm-900">
                                                    {monthNames[slip.payrollRun?.month || 0]} {slip.payrollRun?.year}
                                                </p>
                                                <p className="text-xs text-warm-500">
                                                    {slip.presentDays}/{slip.workingDays} days worked
                                                    {slip.lopDays > 0 && ` | ${slip.lopDays} LOP`}
                                                </p>
                                            </div>
                                        </button>

                                        <div className="flex items-center gap-3">
                                            <div className="text-right">
                                                <p className="text-lg font-bold text-emerald-700">
                                                    {formatCurrency(Number(slip.netPay))}
                                                </p>
                                                <Badge
                                                    variant={slip.payrollRun?.status === PayrollRunStatus.PAID ? 'success' : 'info'}
                                                >
                                                    {slip.payrollRun?.status === PayrollRunStatus.PAID ? 'Paid' : 'Approved'}
                                                </Badge>
                                            </div>
                                            <button
                                                onClick={() => handleDownload(slip)}
                                                disabled={downloading === slip.id}
                                                className="p-2 text-warm-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50"
                                                title="Download PDF"
                                            >
                                                {downloading === slip.id ? (
                                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                                                ) : (
                                                    <Download className="w-5 h-5" />
                                                )}
                                            </button>
                                            <button
                                                onClick={() => setExpandedId(isExpanded ? null : slip.id)}
                                                className="p-1 text-warm-400"
                                            >
                                                {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    </div>

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
                                                            <span className="font-medium">{formatCurrency(Number(slip.basePay))}</span>
                                                        </div>
                                                        {earnings.map((e, i) => (
                                                            <div key={i} className="flex justify-between text-sm">
                                                                <span className="text-warm-600">{e.name}</span>
                                                                <span className="font-medium">{formatCurrency(e.amount)}</span>
                                                            </div>
                                                        ))}
                                                        {Number(slip.otPay) > 0 && (
                                                            <div className="flex justify-between text-sm">
                                                                <span className="text-warm-600">OT Pay ({Number(slip.otHours)}h)</span>
                                                                <span className="font-medium text-blue-600">{formatCurrency(Number(slip.otPay))}</span>
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
                                                                    <span className="font-medium text-red-600">{formatCurrency(d.amount)}</span>
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <p className="text-sm text-warm-400">No deductions</p>
                                                        )}
                                                        <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-warm-200">
                                                            <span>Total Deductions</span>
                                                            <span className="text-red-600">{formatCurrency(Number(slip.totalDeductions))}</span>
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
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
