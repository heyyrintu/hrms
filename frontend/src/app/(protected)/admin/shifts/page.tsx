'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { shiftsApi, employeesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    Timer,
    Users,
    UserPlus,
    Clock,
} from 'lucide-react';

interface Shift {
    id: string;
    name: string;
    code: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    standardWorkMinutes: number;
    graceMinutes: number;
    isActive: boolean;
}

interface ShiftAssignment {
    id: string;
    employeeId: string;
    shiftId: string;
    startDate: string;
    endDate?: string;
    isActive: boolean;
    employee?: { firstName: string; lastName: string; employeeCode: string };
    shift?: { name: string; code: string; startTime?: string; endTime?: string };
}

interface Employee {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
}

type TabType = 'shifts' | 'assignments';

const emptyShiftForm = {
    name: '',
    code: '',
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 60,
    standardWorkMinutes: 480,
    graceMinutes: 15,
};

const emptyAssignForm = {
    employeeId: '',
    shiftId: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
};

export default function ShiftsAdminPage() {
    const [activeTab, setActiveTab] = useState<TabType>('shifts');
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);

    // Shift CRUD modals
    const [shiftModalOpen, setShiftModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editingShift, setEditingShift] = useState<Shift | null>(null);
    const [deletingShift, setDeletingShift] = useState<Shift | null>(null);
    const [shiftForm, setShiftForm] = useState(emptyShiftForm);
    const [saving, setSaving] = useState(false);

    // Assignment modal
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [assignForm, setAssignForm] = useState(emptyAssignForm);

    useEffect(() => {
        loadShifts();
    }, []);

    useEffect(() => {
        if (activeTab === 'assignments') {
            loadAssignments();
            loadEmployees();
        }
    }, [activeTab]);

    const loadShifts = async () => {
        setLoading(true);
        try {
            const res = await shiftsApi.getAll();
            setShifts(res.data);
        } catch (error) {
            console.error('Failed to load shifts:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadAssignments = async () => {
        try {
            const res = await shiftsApi.getAssignments(true);
            setAssignments(res.data);
        } catch (error) {
            console.error('Failed to load assignments:', error);
        }
    };

    const loadEmployees = async () => {
        try {
            const res = await employeesApi.getAll({ limit: 1000 });
            const data = res.data;
            setEmployees(Array.isArray(data) ? data : data.data || []);
        } catch (error) {
            console.error('Failed to load employees:', error);
        }
    };

    // ---- Shift CRUD ----

    const openCreateShift = () => {
        setEditingShift(null);
        setShiftForm(emptyShiftForm);
        setShiftModalOpen(true);
    };

    const openEditShift = (shift: Shift) => {
        setEditingShift(shift);
        setShiftForm({
            name: shift.name,
            code: shift.code,
            startTime: shift.startTime,
            endTime: shift.endTime,
            breakMinutes: shift.breakMinutes,
            standardWorkMinutes: shift.standardWorkMinutes,
            graceMinutes: shift.graceMinutes,
        });
        setShiftModalOpen(true);
    };

    const openDeleteShift = (shift: Shift) => {
        setDeletingShift(shift);
        setDeleteModalOpen(true);
    };

    const handleSaveShift = async () => {
        setSaving(true);
        try {
            if (editingShift) {
                await shiftsApi.update(editingShift.id, shiftForm);
            } else {
                await shiftsApi.create(shiftForm);
            }
            setShiftModalOpen(false);
            await loadShifts();
        } catch (error) {
            console.error('Failed to save shift:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteShift = async () => {
        if (!deletingShift) return;
        setSaving(true);
        try {
            await shiftsApi.delete(deletingShift.id);
            setDeleteModalOpen(false);
            setDeletingShift(null);
            await loadShifts();
        } catch (error) {
            console.error('Failed to delete shift:', error);
        } finally {
            setSaving(false);
        }
    };

    // ---- Assignments ----

    const openAssignModal = () => {
        setAssignForm({
            ...emptyAssignForm,
            shiftId: shifts.length > 0 ? shifts[0].id : '',
        });
        setAssignModalOpen(true);
    };

    const handleAssignShift = async () => {
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                employeeId: assignForm.employeeId,
                shiftId: assignForm.shiftId,
                startDate: assignForm.startDate,
            };
            if (assignForm.endDate) payload.endDate = assignForm.endDate;

            await shiftsApi.assignShift(payload);
            setAssignModalOpen(false);
            await loadAssignments();
        } catch (error) {
            console.error('Failed to assign shift:', error);
        } finally {
            setSaving(false);
        }
    };

    const formatTime = (time: string) => {
        const [h, m] = time.split(':');
        const hour = parseInt(h);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${displayHour}:${m} ${ampm}`;
    };

    const calcHours = (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Timer className="w-7 h-7 text-primary-600" />
                            Shift Management
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Configure work shifts and assign employees
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => {
                                loadShifts();
                                if (activeTab === 'assignments') loadAssignments();
                            }}
                            disabled={loading}
                        >
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        {activeTab === 'shifts' ? (
                            <Button onClick={openCreateShift}>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Shift
                            </Button>
                        ) : (
                            <Button onClick={openAssignModal}>
                                <UserPlus className="w-4 h-4 mr-2" />
                                Assign Shift
                            </Button>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-200">
                    <div className="flex gap-4">
                        <button
                            onClick={() => setActiveTab('shifts')}
                            className={cn(
                                'pb-3 px-1 text-sm font-medium border-b-2 transition-colors',
                                activeTab === 'shifts'
                                    ? 'border-primary-600 text-primary-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                            )}
                        >
                            <Timer className="w-4 h-4 inline mr-2" />
                            Shifts ({shifts.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('assignments')}
                            className={cn(
                                'pb-3 px-1 text-sm font-medium border-b-2 transition-colors',
                                activeTab === 'assignments'
                                    ? 'border-primary-600 text-primary-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                            )}
                        >
                            <Users className="w-4 h-4 inline mr-2" />
                            Assignments
                        </button>
                    </div>
                </div>

                {/* Shifts Tab */}
                {activeTab === 'shifts' && (
                    <>
                        {loading ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                            </div>
                        ) : shifts.length === 0 ? (
                            <Card>
                                <CardContent className="py-16 text-center">
                                    <Timer className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                        No Shifts Configured
                                    </h3>
                                    <p className="text-gray-600 mb-4">
                                        Create your first shift to get started.
                                    </p>
                                    <Button onClick={openCreateShift}>
                                        <Plus className="w-4 h-4 mr-2" />
                                        Create Shift
                                    </Button>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {shifts.map((shift) => (
                                    <Card key={shift.id}>
                                        <CardHeader className="pb-2">
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm">
                                                        {shift.code.substring(0, 3)}
                                                    </div>
                                                    <div>
                                                        <CardTitle className="text-base">
                                                            {shift.name}
                                                        </CardTitle>
                                                        <span className="text-xs text-gray-500">
                                                            {shift.code}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={() => openEditShift(shift)}
                                                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => openDeleteShift(shift)}
                                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-2 text-sm">
                                                <div className="flex items-center gap-2 text-gray-600">
                                                    <Clock className="w-4 h-4 text-gray-400" />
                                                    <span>
                                                        {formatTime(shift.startTime)} -{' '}
                                                        {formatTime(shift.endTime)}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
                                                    <div className="text-center">
                                                        <p className="text-xs text-gray-500">
                                                            Work
                                                        </p>
                                                        <p className="font-medium text-gray-900">
                                                            {calcHours(shift.standardWorkMinutes)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs text-gray-500">
                                                            Break
                                                        </p>
                                                        <p className="font-medium text-gray-900">
                                                            {calcHours(shift.breakMinutes)}
                                                        </p>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-xs text-gray-500">
                                                            Grace
                                                        </p>
                                                        <p className="font-medium text-gray-900">
                                                            {shift.graceMinutes}m
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* Assignments Tab */}
                {activeTab === 'assignments' && (
                    <>
                        {assignments.length === 0 ? (
                            <Card>
                                <CardContent className="py-16 text-center">
                                    <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                        No Active Assignments
                                    </h3>
                                    <p className="text-gray-600 mb-4">
                                        Assign employees to shifts to get started.
                                    </p>
                                    <Button onClick={openAssignModal}>
                                        <UserPlus className="w-4 h-4 mr-2" />
                                        Assign Shift
                                    </Button>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-gray-200 bg-gray-50">
                                                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                                                    Employee
                                                </th>
                                                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                                                    Shift
                                                </th>
                                                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                                                    Timing
                                                </th>
                                                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                                                    Start Date
                                                </th>
                                                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                                                    Status
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {assignments.map((assignment) => (
                                                <tr
                                                    key={assignment.id}
                                                    className="hover:bg-gray-50 transition-colors"
                                                >
                                                    <td className="px-4 py-3">
                                                        <div>
                                                            <p className="text-sm font-medium text-gray-900">
                                                                {assignment.employee
                                                                    ? `${assignment.employee.firstName} ${assignment.employee.lastName}`
                                                                    : '—'}
                                                            </p>
                                                            <p className="text-xs text-gray-500">
                                                                {assignment.employee?.employeeCode}
                                                            </p>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Badge variant="info">
                                                            {assignment.shift?.name ||
                                                                assignment.shiftId}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-gray-600">
                                                        {assignment.shift?.startTime &&
                                                        assignment.shift?.endTime
                                                            ? `${formatTime(assignment.shift.startTime)} - ${formatTime(assignment.shift.endTime)}`
                                                            : '—'}
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-gray-600">
                                                        {new Date(
                                                            assignment.startDate
                                                        ).toLocaleDateString()}
                                                        {assignment.endDate &&
                                                            ` to ${new Date(assignment.endDate).toLocaleDateString()}`}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Badge
                                                            variant={
                                                                assignment.isActive
                                                                    ? 'success'
                                                                    : 'gray'
                                                            }
                                                        >
                                                            {assignment.isActive
                                                                ? 'Active'
                                                                : 'Inactive'}
                                                        </Badge>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        )}
                    </>
                )}
            </div>

            {/* Create/Edit Shift Modal */}
            <Modal
                isOpen={shiftModalOpen}
                onClose={() => setShiftModalOpen(false)}
                title={editingShift ? 'Edit Shift' : 'Create Shift'}
                size="lg"
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Shift Name *
                            </label>
                            <input
                                type="text"
                                value={shiftForm.name}
                                onChange={(e) =>
                                    setShiftForm({ ...shiftForm, name: e.target.value })
                                }
                                placeholder="e.g., Morning Shift"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Code *
                            </label>
                            <input
                                type="text"
                                value={shiftForm.code}
                                onChange={(e) =>
                                    setShiftForm({
                                        ...shiftForm,
                                        code: e.target.value.toUpperCase(),
                                    })
                                }
                                placeholder="e.g., MS"
                                maxLength={10}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Start Time *
                            </label>
                            <input
                                type="time"
                                value={shiftForm.startTime}
                                onChange={(e) =>
                                    setShiftForm({ ...shiftForm, startTime: e.target.value })
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                End Time *
                            </label>
                            <input
                                type="time"
                                value={shiftForm.endTime}
                                onChange={(e) =>
                                    setShiftForm({ ...shiftForm, endTime: e.target.value })
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Break (minutes)
                            </label>
                            <input
                                type="number"
                                value={shiftForm.breakMinutes}
                                onChange={(e) =>
                                    setShiftForm({
                                        ...shiftForm,
                                        breakMinutes: parseInt(e.target.value) || 0,
                                    })
                                }
                                min={0}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Standard Work (min)
                            </label>
                            <input
                                type="number"
                                value={shiftForm.standardWorkMinutes}
                                onChange={(e) =>
                                    setShiftForm({
                                        ...shiftForm,
                                        standardWorkMinutes: parseInt(e.target.value) || 0,
                                    })
                                }
                                min={0}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Grace (minutes)
                            </label>
                            <input
                                type="number"
                                value={shiftForm.graceMinutes}
                                onChange={(e) =>
                                    setShiftForm({
                                        ...shiftForm,
                                        graceMinutes: parseInt(e.target.value) || 0,
                                    })
                                }
                                min={0}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>
                </div>

                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => setShiftModalOpen(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSaveShift}
                        loading={saving}
                        disabled={
                            !shiftForm.name ||
                            !shiftForm.code ||
                            !shiftForm.startTime ||
                            !shiftForm.endTime
                        }
                    >
                        {editingShift ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Shift Confirmation */}
            <Modal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete Shift"
                size="sm"
            >
                <p className="text-gray-600">
                    Are you sure you want to delete{' '}
                    <strong>{deletingShift?.name}</strong>? This will deactivate
                    the shift. Existing assignments will not be affected.
                </p>
                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => setDeleteModalOpen(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDeleteShift} loading={saving}>
                        Delete
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Assign Shift Modal */}
            <Modal
                isOpen={assignModalOpen}
                onClose={() => setAssignModalOpen(false)}
                title="Assign Shift to Employee"
                size="lg"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Employee *
                        </label>
                        <select
                            value={assignForm.employeeId}
                            onChange={(e) =>
                                setAssignForm({ ...assignForm, employeeId: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="">Select Employee</option>
                            {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.firstName} {emp.lastName} ({emp.employeeCode})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Shift *
                        </label>
                        <select
                            value={assignForm.shiftId}
                            onChange={(e) =>
                                setAssignForm({ ...assignForm, shiftId: e.target.value })
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="">Select Shift</option>
                            {shifts.map((shift) => (
                                <option key={shift.id} value={shift.id}>
                                    {shift.name} ({shift.code}) — {formatTime(shift.startTime)} to{' '}
                                    {formatTime(shift.endTime)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Start Date *
                            </label>
                            <input
                                type="date"
                                value={assignForm.startDate}
                                onChange={(e) =>
                                    setAssignForm({ ...assignForm, startDate: e.target.value })
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                End Date (Optional)
                            </label>
                            <input
                                type="date"
                                value={assignForm.endDate}
                                onChange={(e) =>
                                    setAssignForm({ ...assignForm, endDate: e.target.value })
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <p className="text-xs text-gray-500">
                        Note: Assigning a new shift will automatically deactivate any current
                        active shift assignment for this employee.
                    </p>
                </div>

                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => setAssignModalOpen(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleAssignShift}
                        loading={saving}
                        disabled={
                            !assignForm.employeeId ||
                            !assignForm.shiftId ||
                            !assignForm.startDate
                        }
                    >
                        Assign
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
