'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { onboardingApi, employeesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    RefreshCw,
    ClipboardList,
    Search,
    ChevronDown,
    ChevronUp,
    XCircle,
    Trash2,
    CheckCircle2,
    Clock,
    Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
    OnboardingProcess,
    OnboardingProcessStatus,
    OnboardingTemplate,
    OnboardingTask,
    OnboardingTaskStatus,
} from '@/types';

const statusColors: Record<OnboardingProcessStatus, string> = {
    NOT_STARTED: 'gray',
    IN_PROGRESS: 'warning',
    COMPLETED: 'success',
    CANCELLED: 'danger',
};

const statusLabels: Record<OnboardingProcessStatus, string> = {
    NOT_STARTED: 'Not Started',
    IN_PROGRESS: 'In Progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
};

const taskStatusColors: Record<OnboardingTaskStatus, string> = {
    PENDING: 'gray',
    IN_PROGRESS: 'warning',
    COMPLETED: 'success',
    SKIPPED: 'info',
};

export default function OnboardingPage() {
    const [processes, setProcesses] = useState<OnboardingProcess[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });

    // Create modal
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
    const [employees, setEmployees] = useState<{ id: string; firstName: string; lastName: string; employeeCode: string }[]>([]);
    const [createForm, setCreateForm] = useState({
        employeeId: '',
        templateId: '',
        startDate: new Date().toISOString().split('T')[0],
        targetDate: '',
        notes: '',
    });
    const [saving, setSaving] = useState(false);

    // Detail/expand
    const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
    const [processDetail, setProcessDetail] = useState<OnboardingProcess | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    useEffect(() => {
        loadData();
    }, [statusFilter]);

    const loadData = async () => {
        setLoading(true);
        try {
            const params: Record<string, string> = {};
            if (statusFilter) params.status = statusFilter;
            const res = await onboardingApi.getProcesses(params);
            setProcesses(res.data.data);
            setMeta(res.data.meta);
        } catch {
            toast.error('Failed to load onboarding processes');
        } finally {
            setLoading(false);
        }
    };

    const loadProcessDetail = async (id: string) => {
        setLoadingDetail(true);
        try {
            const res = await onboardingApi.getProcess(id);
            setProcessDetail(res.data);
        } catch {
            toast.error('Failed to load process details');
        } finally {
            setLoadingDetail(false);
        }
    };

    const toggleExpand = async (processId: string) => {
        if (expandedProcess === processId) {
            setExpandedProcess(null);
            setProcessDetail(null);
        } else {
            setExpandedProcess(processId);
            await loadProcessDetail(processId);
        }
    };

    const openCreateModal = async () => {
        try {
            const [templatesRes, employeesRes] = await Promise.all([
                onboardingApi.getTemplates(),
                employeesApi.getAll(),
            ]);
            setTemplates(templatesRes.data.filter((t: OnboardingTemplate) => t.isActive));
            const empData = employeesRes.data.data || employeesRes.data;
            setEmployees(Array.isArray(empData) ? empData : []);
            setCreateForm({
                employeeId: '',
                templateId: '',
                startDate: new Date().toISOString().split('T')[0],
                targetDate: '',
                notes: '',
            });
            setCreateModalOpen(true);
        } catch {
            toast.error('Failed to load form data');
        }
    };

    const handleCreate = async () => {
        if (!createForm.employeeId || !createForm.templateId) {
            toast.error('Employee and template are required');
            return;
        }
        setSaving(true);
        try {
            await onboardingApi.createProcess({
                employeeId: createForm.employeeId,
                templateId: createForm.templateId,
                startDate: createForm.startDate || undefined,
                targetDate: createForm.targetDate || undefined,
                notes: createForm.notes || undefined,
            });
            toast.success('Onboarding process created');
            setCreateModalOpen(false);
            await loadData();
        } catch {
            toast.error('Failed to create process');
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = async (processId: string) => {
        try {
            await onboardingApi.cancelProcess(processId);
            toast.success('Process cancelled');
            await loadData();
            if (expandedProcess === processId) {
                await loadProcessDetail(processId);
            }
        } catch {
            toast.error('Failed to cancel process');
        }
    };

    const handleDelete = async (processId: string) => {
        try {
            await onboardingApi.deleteProcess(processId);
            toast.success('Process deleted');
            if (expandedProcess === processId) {
                setExpandedProcess(null);
                setProcessDetail(null);
            }
            await loadData();
        } catch {
            toast.error('Failed to delete process. Only NOT_STARTED processes can be deleted.');
        }
    };

    const filteredProcesses = processes.filter((p) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            p.employee?.firstName.toLowerCase().includes(q) ||
            p.employee?.lastName.toLowerCase().includes(q) ||
            p.template?.name.toLowerCase().includes(q) ||
            p.employee?.employeeCode.toLowerCase().includes(q)
        );
    });

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
        });
    };

    const getProgress = (process: OnboardingProcess) => {
        const total = process._count?.tasks || 0;
        const completed = process.completedTaskCount || 0;
        if (total === 0) return 0;
        return Math.round((completed / total) * 100);
    };

    // Stats
    const stats = {
        total: meta.total,
        inProgress: processes.filter((p) => p.status === 'IN_PROGRESS').length,
        completed: processes.filter((p) => p.status === 'COMPLETED').length,
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <ClipboardList className="w-7 h-7 text-primary-600" />
                            Onboarding
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Manage employee onboarding and offboarding processes
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button variant="primary" onClick={openCreateModal}>
                            <Plus className="w-4 h-4 mr-2" />
                            New Process
                        </Button>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-50">
                                    <Users className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
                                    <p className="text-sm text-gray-500">Total Processes</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-orange-50">
                                    <Clock className="w-5 h-5 text-orange-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-orange-600">{stats.inProgress}</p>
                                    <p className="text-sm text-gray-500">In Progress</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-50">
                                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
                                    <p className="text-sm text-gray-500">Completed</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by employee or template..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                        <option value="">All Statuses</option>
                        <option value="NOT_STARTED">Not Started</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="CANCELLED">Cancelled</option>
                    </select>
                </div>

                {/* Processes List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredProcesses.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <ClipboardList className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Processes</h3>
                            <p className="text-gray-600">
                                {searchQuery || statusFilter
                                    ? 'No processes match your filters.'
                                    : 'Start a new onboarding process for an employee.'}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {filteredProcesses.map((process) => (
                            <Card key={process.id}>
                                <CardContent className="py-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h3 className="text-base font-semibold text-gray-900">
                                                    {process.employee?.firstName} {process.employee?.lastName}
                                                </h3>
                                                <Badge variant={statusColors[process.status] as 'success' | 'warning' | 'danger' | 'gray'}>
                                                    {statusLabels[process.status]}
                                                </Badge>
                                                <Badge variant={process.type === 'ONBOARDING' ? 'success' : 'warning'}>
                                                    {process.type}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-4 text-sm text-gray-500">
                                                <span>{process.employee?.designation}</span>
                                                {process.employee?.department?.name && (
                                                    <span>{process.employee.department.name}</span>
                                                )}
                                                <span>Template: {process.template?.name}</span>
                                            </div>
                                            <div className="flex items-center gap-4 text-xs text-gray-400 mt-1">
                                                <span>Started: {formatDate(process.startDate)}</span>
                                                {process.targetDate && <span>Target: {formatDate(process.targetDate)}</span>}
                                                {process.completedAt && <span>Completed: {formatDate(process.completedAt)}</span>}
                                            </div>

                                            {/* Progress bar */}
                                            {process.status !== 'CANCELLED' && (
                                                <div className="mt-2">
                                                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                                                        <span>Progress</span>
                                                        <span>{getProgress(process)}% ({process.completedTaskCount || 0}/{process._count?.tasks || 0} tasks)</span>
                                                    </div>
                                                    <div className="w-full bg-gray-200 rounded-full h-2">
                                                        <div
                                                            className={cn(
                                                                'h-2 rounded-full transition-all',
                                                                getProgress(process) === 100 ? 'bg-green-500' : 'bg-primary-500'
                                                            )}
                                                            style={{ width: `${getProgress(process)}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 ml-4">
                                            {process.status !== 'COMPLETED' && process.status !== 'CANCELLED' && (
                                                <button
                                                    onClick={() => handleCancel(process.id)}
                                                    className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                                                    title="Cancel Process"
                                                >
                                                    <XCircle className="w-4 h-4" />
                                                </button>
                                            )}
                                            {process.status === 'NOT_STARTED' && (
                                                <button
                                                    onClick={() => handleDelete(process.id)}
                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Delete Process"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Expand tasks */}
                                    <button
                                        onClick={() => toggleExpand(process.id)}
                                        className="mt-3 text-sm text-primary-600 hover:underline flex items-center gap-1"
                                    >
                                        {expandedProcess === process.id ? (
                                            <><ChevronUp className="w-4 h-4" /> Hide tasks</>
                                        ) : (
                                            <><ChevronDown className="w-4 h-4" /> View tasks</>
                                        )}
                                    </button>

                                    {expandedProcess === process.id && (
                                        <div className="mt-3 border-t pt-3">
                                            {loadingDetail ? (
                                                <div className="flex justify-center py-4">
                                                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                                                </div>
                                            ) : processDetail?.tasks && processDetail.tasks.length > 0 ? (
                                                <div className="space-y-2">
                                                    {processDetail.tasks.map((task: OnboardingTask) => (
                                                        <div key={task.id} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                                                            <div className={cn(
                                                                'mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs',
                                                                task.status === 'COMPLETED' ? 'bg-green-500' :
                                                                task.status === 'IN_PROGRESS' ? 'bg-orange-500' :
                                                                task.status === 'SKIPPED' ? 'bg-blue-400' : 'bg-gray-300'
                                                            )}>
                                                                {task.status === 'COMPLETED' ? '✓' : task.status === 'SKIPPED' ? '—' : task.sortOrder + 1}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <p className="text-sm font-medium text-gray-900">{task.title}</p>
                                                                    <Badge variant={taskStatusColors[task.status] as 'success' | 'warning' | 'gray' | 'info'}>
                                                                        {task.status.replace('_', ' ')}
                                                                    </Badge>
                                                                </div>
                                                                {task.description && (
                                                                    <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
                                                                )}
                                                                <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                                                                    <span>{task.category.replace('_', ' ')}</span>
                                                                    {task.assignee && (
                                                                        <span>Assignee: {task.assignee.firstName} {task.assignee.lastName}</span>
                                                                    )}
                                                                    {task.dueDate && <span>Due: {formatDate(task.dueDate)}</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="text-sm text-gray-500 text-center py-4">No tasks found</p>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            <Modal
                isOpen={createModalOpen}
                onClose={() => setCreateModalOpen(false)}
                title="Start Onboarding Process"
                size="md"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Employee *</label>
                        <select
                            value={createForm.employeeId}
                            onChange={(e) => setCreateForm({ ...createForm, employeeId: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="">Select employee...</option>
                            {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                    {emp.firstName} {emp.lastName} ({emp.employeeCode})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Template *</label>
                        <select
                            value={createForm.templateId}
                            onChange={(e) => setCreateForm({ ...createForm, templateId: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="">Select template...</option>
                            {templates.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name} ({t.type}) — {t.tasks.length} tasks
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                            <input
                                type="date"
                                value={createForm.startDate}
                                onChange={(e) => setCreateForm({ ...createForm, startDate: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Date</label>
                            <input
                                type="date"
                                value={createForm.targetDate}
                                onChange={(e) => setCreateForm({ ...createForm, targetDate: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea
                            value={createForm.notes}
                            onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                            placeholder="Any special notes..."
                        />
                    </div>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setCreateModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleCreate} loading={saving}>
                        Start Process
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
