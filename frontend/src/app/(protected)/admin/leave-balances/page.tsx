'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { leaveApi, employeesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    RefreshCw,
    Users,
    Calendar,
    Search,
    Edit2,
    Download,
    Zap,
    Filter,
} from 'lucide-react';

interface LeaveBalance {
    id: string;
    year: number;
    totalDays: number;
    usedDays: number;
    pendingDays: number;
    carriedOver: number;
    leaveType: { id: string; name: string; code: string };
    employee: {
        id: string;
        firstName: string;
        lastName: string;
        employeeCode: string;
        department?: { name: string };
    };
}

interface LeaveType {
    id: string;
    name: string;
    code: string;
}

interface GroupedBalance {
    employee: LeaveBalance['employee'];
    balances: LeaveBalance[];
}

export default function LeaveBalancesAdminPage() {
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [initModalOpen, setInitModalOpen] = useState(false);
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingBalance, setEditingBalance] = useState<LeaveBalance | null>(null);
    const [initYear, setInitYear] = useState(new Date().getFullYear());
    const [saving, setSaving] = useState(false);
    const [editFormData, setEditFormData] = useState({
        totalDays: 0,
        usedDays: 0,
        pendingDays: 0,
        carriedOver: 0,
    });

    useEffect(() => {
        loadData();
    }, [selectedYear]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [balancesRes, typesRes] = await Promise.all([
                leaveApi.getAllBalances(selectedYear),
                leaveApi.getTypes(),
            ]);
            setBalances(balancesRes.data);
            setLeaveTypes(typesRes.data);
        } catch (error) {
            console.error('Failed to load balances:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleInitialize = async () => {
        setSaving(true);
        try {
            await leaveApi.initializeBalances({ year: initYear });
            setInitModalOpen(false);
            if (initYear === selectedYear) {
                await loadData();
            }
        } catch (error) {
            console.error('Failed to initialize balances:', error);
        } finally {
            setSaving(false);
        }
    };

    const openEditModal = (balance: LeaveBalance) => {
        setEditingBalance(balance);
        setEditFormData({
            totalDays: balance.totalDays,
            usedDays: balance.usedDays,
            pendingDays: balance.pendingDays,
            carriedOver: balance.carriedOver,
        });
        setEditModalOpen(true);
    };

    const handleEditSave = async () => {
        if (!editingBalance) return;
        setSaving(true);
        try {
            await leaveApi.updateEmployeeBalance(
                editingBalance.employee.id,
                editingBalance.leaveType.id,
                selectedYear,
                editFormData
            );
            setEditModalOpen(false);
            await loadData();
        } catch (error) {
            console.error('Failed to update balance:', error);
        } finally {
            setSaving(false);
        }
    };

    // Group balances by employee
    const groupedBalances: GroupedBalance[] = [];
    const employeeMap = new Map<string, GroupedBalance>();

    balances.forEach(balance => {
        const existing = employeeMap.get(balance.employee.id);
        if (existing) {
            existing.balances.push(balance);
        } else {
            const group = { employee: balance.employee, balances: [balance] };
            employeeMap.set(balance.employee.id, group);
            groupedBalances.push(group);
        }
    });

    // Filter by search
    const filteredGroups = groupedBalances.filter(group =>
        `${group.employee.firstName} ${group.employee.lastName} ${group.employee.employeeCode}`
            .toLowerCase()
            .includes(searchTerm.toLowerCase())
    );

    const years = [
        new Date().getFullYear() - 1,
        new Date().getFullYear(),
        new Date().getFullYear() + 1,
    ];

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Users className="w-7 h-7 text-primary-600" />
                            Leave Balances Management
                        </h1>
                        <p className="text-gray-600 mt-1">
                            View and manage employee leave balances
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={() => setInitModalOpen(true)}>
                            <Zap className="w-4 h-4 mr-2" />
                            Initialize Balances
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by employee name or code..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                            className="border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        >
                            {years.map(year => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="flex items-center gap-4">
                            <div className="p-3 bg-blue-100 rounded-lg">
                                <Users className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-gray-900">{groupedBalances.length}</div>
                                <div className="text-sm text-gray-500">Employees with Balances</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-4">
                            <div className="p-3 bg-green-100 rounded-lg">
                                <Calendar className="w-6 h-6 text-green-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-gray-900">{leaveTypes.length}</div>
                                <div className="text-sm text-gray-500">Leave Types</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="flex items-center gap-4">
                            <div className="p-3 bg-purple-100 rounded-lg">
                                <Filter className="w-6 h-6 text-purple-600" />
                            </div>
                            <div>
                                <div className="text-2xl font-bold text-gray-900">{selectedYear}</div>
                                <div className="text-sm text-gray-500">Selected Year</div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Balances Table */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredGroups.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                {balances.length === 0 ? 'No Balances Found' : 'No Matching Results'}
                            </h3>
                            <p className="text-gray-600 mb-4">
                                {balances.length === 0
                                    ? 'Initialize balances to set up employee leave allocations.'
                                    : 'Try adjusting your search criteria.'}
                            </p>
                            {balances.length === 0 && (
                                <Button onClick={() => setInitModalOpen(true)}>
                                    <Zap className="w-4 h-4 mr-2" />
                                    Initialize Balances
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <Card padding="none">
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                                            Employee
                                        </th>
                                        {leaveTypes.map(type => (
                                            <th key={type.id} className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">
                                                {type.code}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white">
                                    {filteredGroups.map((group) => (
                                        <tr key={group.employee.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-semibold">
                                                        {group.employee.firstName.charAt(0)}{group.employee.lastName.charAt(0)}
                                                    </div>
                                                    <div className="ml-3">
                                                        <div className="font-medium text-gray-900">
                                                            {group.employee.firstName} {group.employee.lastName}
                                                        </div>
                                                        <div className="text-sm text-gray-500">
                                                            {group.employee.employeeCode}
                                                            {group.employee.department && ` • ${group.employee.department.name}`}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            {leaveTypes.map(type => {
                                                const balance = group.balances.find(b => b.leaveType.id === type.id);
                                                if (!balance) {
                                                    return (
                                                        <td key={type.id} className="px-4 py-4 text-center text-gray-400">
                                                            —
                                                        </td>
                                                    );
                                                }
                                                const available = balance.totalDays + balance.carriedOver - balance.usedDays - balance.pendingDays;
                                                return (
                                                    <td key={type.id} className="px-4 py-4">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <div className="text-center">
                                                                <div className={cn(
                                                                    'text-lg font-bold',
                                                                    available > 0 ? 'text-green-600' : 'text-red-600'
                                                                )}>
                                                                    {available}
                                                                </div>
                                                                <div className="text-xs text-gray-500">
                                                                    of {balance.totalDays + balance.carriedOver}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => openEditModal(balance)}
                                                                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                                                            >
                                                                <Edit2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}
            </div>

            {/* Initialize Modal */}
            <Modal
                isOpen={initModalOpen}
                onClose={() => setInitModalOpen(false)}
                title="Initialize Leave Balances"
                size="md"
            >
                <div className="space-y-4">
                    <p className="text-gray-600">
                        This will create leave balance entries for all active employees based on
                        the default days configured for each leave type.
                    </p>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Year
                        </label>
                        <select
                            value={initYear}
                            onChange={(e) => setInitYear(parseInt(e.target.value))}
                            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500"
                        >
                            {years.map(year => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                        <strong>Note:</strong> Existing balances will not be overwritten.
                        Only missing entries will be created.
                    </div>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setInitModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleInitialize} loading={saving}>
                        Initialize
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Edit Balance Modal */}
            <Modal
                isOpen={editModalOpen}
                onClose={() => setEditModalOpen(false)}
                title="Edit Leave Balance"
                size="md"
            >
                {editingBalance && (
                    <div className="space-y-4">
                        <div className="p-4 bg-gray-50 rounded-lg">
                            <div className="font-medium text-gray-900">
                                {editingBalance.employee.firstName} {editingBalance.employee.lastName}
                            </div>
                            <div className="text-sm text-gray-500">
                                {editingBalance.leaveType.name} ({editingBalance.leaveType.code}) • {selectedYear}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Total Days
                                </label>
                                <input
                                    type="number"
                                    value={editFormData.totalDays}
                                    onChange={(e) => setEditFormData({ ...editFormData, totalDays: parseFloat(e.target.value) || 0 })}
                                    min={0}
                                    step={0.5}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Carried Over
                                </label>
                                <input
                                    type="number"
                                    value={editFormData.carriedOver}
                                    onChange={(e) => setEditFormData({ ...editFormData, carriedOver: parseFloat(e.target.value) || 0 })}
                                    min={0}
                                    step={0.5}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Used Days
                                </label>
                                <input
                                    type="number"
                                    value={editFormData.usedDays}
                                    onChange={(e) => setEditFormData({ ...editFormData, usedDays: parseFloat(e.target.value) || 0 })}
                                    min={0}
                                    step={0.5}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Pending Days
                                </label>
                                <input
                                    type="number"
                                    value={editFormData.pendingDays}
                                    onChange={(e) => setEditFormData({ ...editFormData, pendingDays: parseFloat(e.target.value) || 0 })}
                                    min={0}
                                    step={0.5}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                        </div>

                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                            <div className="flex justify-between">
                                <span className="text-blue-700">Available:</span>
                                <span className="font-medium text-blue-900">
                                    {(editFormData.totalDays + editFormData.carriedOver - editFormData.usedDays - editFormData.pendingDays).toFixed(1)} days
                                </span>
                            </div>
                        </div>
                    </div>
                )}
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setEditModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleEditSave} loading={saving}>
                        Save Changes
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
