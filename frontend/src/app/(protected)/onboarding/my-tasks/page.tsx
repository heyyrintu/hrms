'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { onboardingApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    RefreshCw,
    ClipboardList,
    Search,
    CheckCircle2,
    Clock,
    AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingTask, OnboardingTaskStatus } from '@/types';

const statusColors: Record<OnboardingTaskStatus, string> = {
    PENDING: 'gray',
    IN_PROGRESS: 'warning',
    COMPLETED: 'success',
    SKIPPED: 'info',
};

const statusLabels: Record<OnboardingTaskStatus, string> = {
    PENDING: 'Pending',
    IN_PROGRESS: 'In Progress',
    COMPLETED: 'Completed',
    SKIPPED: 'Skipped',
};

export default function MyOnboardingTasksPage() {
    const [tasks, setTasks] = useState<OnboardingTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });

    // Note modal
    const [noteModalOpen, setNoteModalOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState<OnboardingTask | null>(null);
    const [noteText, setNoteText] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadData();
    }, [statusFilter]);

    const loadData = async () => {
        setLoading(true);
        try {
            const params: Record<string, string> = {};
            if (statusFilter) params.status = statusFilter;
            const res = await onboardingApi.getMyTasks(params);
            setTasks(res.data.data);
            setMeta(res.data.meta);
        } catch {
            toast.error('Failed to load your tasks');
        } finally {
            setLoading(false);
        }
    };

    const handleStartTask = async (task: OnboardingTask) => {
        try {
            await onboardingApi.updateTask(task.id, { status: 'IN_PROGRESS' });
            toast.success('Task started');
            await loadData();
        } catch {
            toast.error('Failed to start task');
        }
    };

    const handleCompleteTask = async (taskId: string) => {
        try {
            await onboardingApi.completeTask(taskId);
            toast.success('Task completed');
            await loadData();
        } catch {
            toast.error('Failed to complete task');
        }
    };

    const openNoteModal = (task: OnboardingTask) => {
        setSelectedTask(task);
        setNoteText(task.notes || '');
        setNoteModalOpen(true);
    };

    const handleSaveNote = async () => {
        if (!selectedTask) return;
        setSaving(true);
        try {
            await onboardingApi.updateTask(selectedTask.id, { notes: noteText });
            toast.success('Note saved');
            setNoteModalOpen(false);
            await loadData();
        } catch {
            toast.error('Failed to save note');
        } finally {
            setSaving(false);
        }
    };

    const filteredTasks = tasks.filter((t) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (
            t.title.toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q) ||
            t.category.toLowerCase().includes(q)
        );
    });

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '—';
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
        });
    };

    const isOverdue = (task: OnboardingTask) => {
        if (!task.dueDate || task.status === 'COMPLETED' || task.status === 'SKIPPED') return false;
        return new Date(task.dueDate) < new Date();
    };

    // Stats
    const pendingCount = tasks.filter((t) => t.status === 'PENDING').length;
    const inProgressCount = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
    const completedCount = tasks.filter((t) => t.status === 'COMPLETED').length;

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <ClipboardList className="w-7 h-7 text-primary-600" />
                            My Onboarding Tasks
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Tasks assigned to you as part of onboarding processes
                        </p>
                    </div>
                    <Button variant="secondary" onClick={loadData} disabled={loading}>
                        <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                        Refresh
                    </Button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-gray-100">
                                    <AlertCircle className="w-5 h-5 text-gray-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-gray-600">{pendingCount}</p>
                                    <p className="text-sm text-gray-500">Pending</p>
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
                                    <p className="text-2xl font-bold text-orange-600">{inProgressCount}</p>
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
                                    <p className="text-2xl font-bold text-green-600">{completedCount}</p>
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
                            placeholder="Search tasks..."
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
                        <option value="PENDING">Pending</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="SKIPPED">Skipped</option>
                    </select>
                </div>

                {/* Tasks List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredTasks.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <CheckCircle2 className="w-16 h-16 text-green-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                {statusFilter || searchQuery ? 'No Matching Tasks' : 'No Tasks Assigned'}
                            </h3>
                            <p className="text-gray-600">
                                {statusFilter || searchQuery
                                    ? 'No tasks match your filters.'
                                    : 'You have no onboarding tasks assigned to you.'}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {filteredTasks.map((task) => (
                            <Card key={task.id} className={cn(isOverdue(task) && 'border-red-200')}>
                                <CardContent className="py-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="text-base font-semibold text-gray-900">{task.title}</h3>
                                                <Badge variant={statusColors[task.status] as 'success' | 'warning' | 'gray' | 'info'}>
                                                    {statusLabels[task.status]}
                                                </Badge>
                                                <Badge variant="gray">{task.category.replace('_', ' ')}</Badge>
                                                {isOverdue(task) && (
                                                    <Badge variant="danger">Overdue</Badge>
                                                )}
                                            </div>
                                            {task.description && (
                                                <p className="text-sm text-gray-600 mb-1">{task.description}</p>
                                            )}
                                            <div className="flex items-center gap-4 text-xs text-gray-400">
                                                {task.process && (
                                                    <span>
                                                        {task.process.type}: {task.process.employee?.firstName} {task.process.employee?.lastName}
                                                    </span>
                                                )}
                                                {task.dueDate && (
                                                    <span className={cn(isOverdue(task) && 'text-red-500 font-medium')}>
                                                        Due: {formatDate(task.dueDate)}
                                                    </span>
                                                )}
                                                {task.completedAt && <span>Done: {formatDate(task.completedAt)}</span>}
                                            </div>
                                            {task.notes && (
                                                <p className="text-xs text-gray-500 mt-1 bg-gray-50 rounded px-2 py-1">
                                                    Note: {task.notes}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 ml-4">
                                            {task.status === 'PENDING' && (
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => handleStartTask(task)}
                                                >
                                                    Start
                                                </Button>
                                            )}
                                            {(task.status === 'PENDING' || task.status === 'IN_PROGRESS') && (
                                                <Button
                                                    variant="primary"
                                                    onClick={() => handleCompleteTask(task.id)}
                                                >
                                                    <CheckCircle2 className="w-4 h-4 mr-1" />
                                                    Complete
                                                </Button>
                                            )}
                                            {task.status !== 'COMPLETED' && task.status !== 'SKIPPED' && (
                                                <button
                                                    onClick={() => openNoteModal(task)}
                                                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                                >
                                                    Add Note
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Note Modal */}
            <Modal
                isOpen={noteModalOpen}
                onClose={() => setNoteModalOpen(false)}
                title={`Note — ${selectedTask?.title || ''}`}
                size="sm"
            >
                <div>
                    <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                        placeholder="Add a note about this task..."
                    />
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setNoteModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSaveNote} loading={saving}>
                        Save Note
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
