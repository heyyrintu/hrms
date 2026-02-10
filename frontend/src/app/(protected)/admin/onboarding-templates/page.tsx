'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { onboardingApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    ClipboardList,
    Search,
    ChevronDown,
    ChevronUp,
    X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingTemplate, TaskDefinition, OnboardingType } from '@/types';

const typeColors: Record<OnboardingType, string> = {
    ONBOARDING: 'success',
    OFFBOARDING: 'warning',
};

const categoryOptions = [
    'IT_SETUP', 'HR_PAPERWORK', 'TRAINING', 'COMPLIANCE', 'FACILITIES', 'GENERAL',
];
const assigneeRoleOptions = ['', 'EMPLOYEE', 'MANAGER', 'HR_ADMIN'];

const emptyTask: TaskDefinition = {
    title: '',
    description: '',
    category: 'GENERAL',
    defaultAssigneeRole: '',
    daysAfterStart: 0,
    sortOrder: 0,
};

const emptyFormData = {
    name: '',
    type: 'ONBOARDING' as string,
    description: '',
    tasks: [{ ...emptyTask, sortOrder: 0 }] as TaskDefinition[],
};

export default function OnboardingTemplatesPage() {
    const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<OnboardingTemplate | null>(null);
    const [formData, setFormData] = useState(emptyFormData);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [deletingTemplate, setDeletingTemplate] = useState<OnboardingTemplate | null>(null);
    const [expandedTasks, setExpandedTasks] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await onboardingApi.getTemplates();
            setTemplates(res.data);
        } catch {
            toast.error('Failed to load templates');
        } finally {
            setLoading(false);
        }
    };

    const filteredTemplates = templates.filter((t) =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openCreate = () => {
        setEditing(null);
        setFormData(emptyFormData);
        setModalOpen(true);
    };

    const openEdit = (template: OnboardingTemplate) => {
        setEditing(template);
        setFormData({
            name: template.name,
            type: template.type,
            description: template.description || '',
            tasks: template.tasks.length > 0 ? template.tasks : [{ ...emptyTask }],
        });
        setModalOpen(true);
    };

    const openDelete = (template: OnboardingTemplate) => {
        setDeletingTemplate(template);
        setDeleteModalOpen(true);
    };

    const addTask = () => {
        setFormData((prev) => ({
            ...prev,
            tasks: [...prev.tasks, { ...emptyTask, sortOrder: prev.tasks.length }],
        }));
    };

    const removeTask = (index: number) => {
        setFormData((prev) => ({
            ...prev,
            tasks: prev.tasks.filter((_, i) => i !== index).map((t, i) => ({ ...t, sortOrder: i })),
        }));
    };

    const updateTask = (index: number, field: keyof TaskDefinition, value: string | number) => {
        setFormData((prev) => ({
            ...prev,
            tasks: prev.tasks.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
        }));
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast.error('Template name is required');
            return;
        }
        if (formData.tasks.length === 0 || !formData.tasks[0].title.trim()) {
            toast.error('At least one task with a title is required');
            return;
        }

        const validTasks = formData.tasks.filter((t) => t.title.trim());
        const payload = {
            name: formData.name.trim(),
            type: formData.type,
            description: formData.description.trim() || undefined,
            tasks: validTasks.map((t, i) => ({
                title: t.title.trim(),
                description: t.description?.trim() || undefined,
                category: t.category || 'GENERAL',
                defaultAssigneeRole: t.defaultAssigneeRole || undefined,
                daysAfterStart: t.daysAfterStart || 0,
                sortOrder: i,
            })),
        };

        setSaving(true);
        try {
            if (editing) {
                await onboardingApi.updateTemplate(editing.id, payload);
                toast.success('Template updated');
            } else {
                await onboardingApi.createTemplate(payload);
                toast.success('Template created');
            }
            setModalOpen(false);
            await loadData();
        } catch {
            toast.error(editing ? 'Failed to update template' : 'Failed to create template');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingTemplate) return;
        try {
            await onboardingApi.deleteTemplate(deletingTemplate.id);
            toast.success('Template deleted');
            setDeleteModalOpen(false);
            await loadData();
        } catch {
            toast.error('Failed to delete template. It may have existing processes.');
        }
    };

    const handleToggleActive = async (template: OnboardingTemplate) => {
        try {
            await onboardingApi.updateTemplate(template.id, { isActive: !template.isActive });
            toast.success(template.isActive ? 'Template deactivated' : 'Template activated');
            await loadData();
        } catch {
            toast.error('Failed to update template');
        }
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <ClipboardList className="w-7 h-7 text-primary-600" />
                            Onboarding Templates
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Manage onboarding and offboarding checklists
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button variant="primary" onClick={openCreate}>
                            <Plus className="w-4 h-4 mr-2" />
                            New Template
                        </Button>
                    </div>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search templates..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                </div>

                {/* Templates List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredTemplates.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <ClipboardList className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Templates</h3>
                            <p className="text-gray-600">
                                {searchQuery ? 'No templates match your search.' : 'Create your first onboarding template to get started.'}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {filteredTemplates.map((template) => (
                            <Card key={template.id}>
                                <CardContent className="py-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h3 className="text-lg font-semibold text-gray-900">{template.name}</h3>
                                                <Badge variant={typeColors[template.type] as 'success' | 'warning'}>
                                                    {template.type}
                                                </Badge>
                                                <Badge variant={template.isActive ? 'success' : 'gray'}>
                                                    {template.isActive ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </div>
                                            {template.description && (
                                                <p className="text-sm text-gray-600 mb-2">{template.description}</p>
                                            )}
                                            <div className="flex items-center gap-4 text-sm text-gray-500">
                                                <span>{template.tasks.length} tasks</span>
                                                <span>{template._count?.processes || 0} processes</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleToggleActive(template)}
                                                className={cn(
                                                    'px-3 py-1 text-xs rounded-lg transition-colors',
                                                    template.isActive
                                                        ? 'text-orange-600 hover:bg-orange-50'
                                                        : 'text-green-600 hover:bg-green-50'
                                                )}
                                            >
                                                {template.isActive ? 'Deactivate' : 'Activate'}
                                            </button>
                                            <button
                                                onClick={() => openEdit(template)}
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Edit"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => openDelete(template)}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Expandable tasks */}
                                    <button
                                        onClick={() => setExpandedTasks(expandedTasks === template.id ? null : template.id)}
                                        className="mt-3 text-sm text-primary-600 hover:underline flex items-center gap-1"
                                    >
                                        {expandedTasks === template.id ? (
                                            <>
                                                <ChevronUp className="w-4 h-4" /> Hide tasks
                                            </>
                                        ) : (
                                            <>
                                                <ChevronDown className="w-4 h-4" /> Show tasks
                                            </>
                                        )}
                                    </button>
                                    {expandedTasks === template.id && (
                                        <div className="mt-3 border-t pt-3 space-y-2">
                                            {template.tasks.map((task, idx) => (
                                                <div key={idx} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                                                    <span className="text-xs font-medium text-gray-400 mt-0.5">
                                                        {idx + 1}.
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-gray-900">{task.title}</p>
                                                        {task.description && (
                                                            <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
                                                        )}
                                                        <div className="flex gap-2 mt-1 flex-wrap">
                                                            <Badge variant="gray">{task.category}</Badge>
                                                            {task.defaultAssigneeRole && (
                                                                <Badge variant="info">{task.defaultAssigneeRole}</Badge>
                                                            )}
                                                            {task.daysAfterStart != null && task.daysAfterStart > 0 && (
                                                                <Badge variant="default">Day +{task.daysAfterStart}</Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* Create/Edit Modal */}
            <Modal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editing ? 'Edit Template' : 'New Template'}
                size="lg"
            >
                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                placeholder="e.g., Standard Onboarding"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                            <select
                                value={formData.type}
                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                                disabled={!!editing}
                            >
                                <option value="ONBOARDING">Onboarding</option>
                                <option value="OFFBOARDING">Offboarding</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                            placeholder="Describe this template..."
                        />
                    </div>

                    {/* Tasks */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium text-gray-700">Tasks *</label>
                            <Button variant="ghost" onClick={addTask}>
                                <Plus className="w-4 h-4 mr-1" /> Add Task
                            </Button>
                        </div>
                        <div className="space-y-3">
                            {formData.tasks.map((task, idx) => (
                                <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-gray-500">Task {idx + 1}</span>
                                        {formData.tasks.length > 1 && (
                                            <button
                                                onClick={() => removeTask(idx)}
                                                className="p-1 text-red-500 hover:bg-red-50 rounded"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                    <input
                                        type="text"
                                        value={task.title}
                                        onChange={(e) => updateTask(idx, 'title', e.target.value)}
                                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                        placeholder="Task title *"
                                    />
                                    <input
                                        type="text"
                                        value={task.description || ''}
                                        onChange={(e) => updateTask(idx, 'description', e.target.value)}
                                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                        placeholder="Description (optional)"
                                    />
                                    <div className="grid grid-cols-3 gap-2">
                                        <select
                                            value={task.category}
                                            onChange={(e) => updateTask(idx, 'category', e.target.value)}
                                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500"
                                        >
                                            {categoryOptions.map((c) => (
                                                <option key={c} value={c}>{c.replace('_', ' ')}</option>
                                            ))}
                                        </select>
                                        <select
                                            value={task.defaultAssigneeRole || ''}
                                            onChange={(e) => updateTask(idx, 'defaultAssigneeRole', e.target.value)}
                                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500"
                                        >
                                            <option value="">No default assignee</option>
                                            {assigneeRoleOptions.filter(Boolean).map((r) => (
                                                <option key={r} value={r}>{r.replace('_', ' ')}</option>
                                            ))}
                                        </select>
                                        <input
                                            type="number"
                                            value={task.daysAfterStart || 0}
                                            onChange={(e) => updateTask(idx, 'daysAfterStart', parseInt(e.target.value) || 0)}
                                            className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-primary-500"
                                            min={0}
                                            placeholder="Days after start"
                                            title="Days after start"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <ModalFooter>
                    <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSave} loading={saving}>
                        {editing ? 'Update' : 'Create'} Template
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Confirmation */}
            <Modal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete Template"
                size="sm"
            >
                <p className="text-gray-600">
                    Are you sure you want to delete <strong>{deletingTemplate?.name}</strong>?
                    This cannot be undone.
                </p>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setDeleteModalOpen(false)}>Cancel</Button>
                    <Button variant="danger" onClick={handleDelete}>Delete</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
