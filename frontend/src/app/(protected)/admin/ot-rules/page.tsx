'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { adminApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    Clock,
    Timer,
    Shield,
    AlertCircle,
} from 'lucide-react';

interface OtRule {
    id: string;
    name: string;
    employmentType?: string;
    dailyThresholdMinutes: number;
    weeklyThresholdMinutes?: number;
    roundingIntervalMinutes: number;
    requiresManagerApproval: boolean;
    maxOtPerDayMinutes?: number;
    maxOtPerMonthMinutes?: number;
    isActive: boolean;
    createdAt: string;
}

const emptyForm = {
    name: '',
    employmentType: '',
    dailyThresholdMinutes: 480,
    weeklyThresholdMinutes: '',
    roundingIntervalMinutes: 15,
    requiresManagerApproval: true,
    maxOtPerDayMinutes: '',
    maxOtPerMonthMinutes: '',
};

export default function OtRulesPage() {
    const [rules, setRules] = useState<OtRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<OtRule | null>(null);
    const [deletingRule, setDeletingRule] = useState<OtRule | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadRules();
    }, []);

    const loadRules = async () => {
        setLoading(true);
        try {
            const res = await adminApi.getOtRules();
            setRules(res.data);
        } catch (error) {
            console.error('Failed to load OT rules:', error);
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditingRule(null);
        setForm(emptyForm);
        setModalOpen(true);
    };

    const openEdit = (rule: OtRule) => {
        setEditingRule(rule);
        setForm({
            name: rule.name,
            employmentType: rule.employmentType || '',
            dailyThresholdMinutes: rule.dailyThresholdMinutes,
            weeklyThresholdMinutes: rule.weeklyThresholdMinutes?.toString() || '',
            roundingIntervalMinutes: rule.roundingIntervalMinutes,
            requiresManagerApproval: rule.requiresManagerApproval,
            maxOtPerDayMinutes: rule.maxOtPerDayMinutes?.toString() || '',
            maxOtPerMonthMinutes: rule.maxOtPerMonthMinutes?.toString() || '',
        });
        setModalOpen(true);
    };

    const openDelete = (rule: OtRule) => {
        setDeletingRule(rule);
        setDeleteModalOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: form.name,
                dailyThresholdMinutes: form.dailyThresholdMinutes,
                roundingIntervalMinutes: form.roundingIntervalMinutes,
                requiresManagerApproval: form.requiresManagerApproval,
            };
            if (form.employmentType) payload.employmentType = form.employmentType;
            if (form.weeklyThresholdMinutes) payload.weeklyThresholdMinutes = parseInt(form.weeklyThresholdMinutes);
            if (form.maxOtPerDayMinutes) payload.maxOtPerDayMinutes = parseInt(form.maxOtPerDayMinutes);
            if (form.maxOtPerMonthMinutes) payload.maxOtPerMonthMinutes = parseInt(form.maxOtPerMonthMinutes);

            if (editingRule) {
                await adminApi.updateOtRule(editingRule.id, payload);
                toast.success('OT rule updated');
            } else {
                await adminApi.createOtRule(payload);
                toast.success('OT rule created');
            }
            setModalOpen(false);
            await loadRules();
        } catch (error: any) {
            const message = error.response?.data?.message || 'Failed to save OT rule';
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingRule) return;
        setSaving(true);
        try {
            await adminApi.deleteOtRule(deletingRule.id);
            toast.success('OT rule deleted');
            setDeleteModalOpen(false);
            setDeletingRule(null);
            await loadRules();
        } catch (error: any) {
            const message = error.response?.data?.message || 'Failed to delete OT rule';
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const formatMinutes = (minutes: number) => {
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
                            Overtime Rules
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Configure overtime thresholds and approval policies
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadRules} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreate}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Rule
                        </Button>
                    </div>
                </div>

                {/* Rules Grid */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : rules.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Timer className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                No OT Rules Configured
                            </h3>
                            <p className="text-gray-600 mb-4">
                                Create your first overtime rule to get started.
                            </p>
                            <Button onClick={openCreate}>
                                <Plus className="w-4 h-4 mr-2" />
                                Create Rule
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {rules.map((rule) => (
                            <Card key={rule.id}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                                                <Clock className="w-5 h-5 text-primary-700" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">{rule.name}</CardTitle>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    {rule.employmentType && (
                                                        <Badge variant="info">{rule.employmentType}</Badge>
                                                    )}
                                                    <Badge variant={rule.isActive ? 'success' : 'gray'}>
                                                        {rule.isActive ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => openEdit(rule)}
                                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => openDelete(rule)}
                                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-3 text-sm">
                                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                                            <div className="text-center">
                                                <p className="text-xs text-gray-500">Daily Threshold</p>
                                                <p className="font-medium text-gray-900">
                                                    {formatMinutes(rule.dailyThresholdMinutes)}
                                                </p>
                                            </div>
                                            <div className="text-center">
                                                <p className="text-xs text-gray-500">Weekly Threshold</p>
                                                <p className="font-medium text-gray-900">
                                                    {rule.weeklyThresholdMinutes
                                                        ? formatMinutes(rule.weeklyThresholdMinutes)
                                                        : '—'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-2">
                                            <div className="text-center">
                                                <p className="text-xs text-gray-500">Rounding</p>
                                                <p className="font-medium text-gray-900">
                                                    {rule.roundingIntervalMinutes}m
                                                </p>
                                            </div>
                                            <div className="text-center">
                                                <p className="text-xs text-gray-500">Max/Day</p>
                                                <p className="font-medium text-gray-900">
                                                    {rule.maxOtPerDayMinutes
                                                        ? formatMinutes(rule.maxOtPerDayMinutes)
                                                        : '—'}
                                                </p>
                                            </div>
                                            <div className="text-center">
                                                <p className="text-xs text-gray-500">Max/Month</p>
                                                <p className="font-medium text-gray-900">
                                                    {rule.maxOtPerMonthMinutes
                                                        ? formatMinutes(rule.maxOtPerMonthMinutes)
                                                        : '—'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100">
                                            <Shield className={cn(
                                                'w-4 h-4',
                                                rule.requiresManagerApproval ? 'text-amber-500' : 'text-gray-300'
                                            )} />
                                            <span className="text-xs text-gray-600">
                                                {rule.requiresManagerApproval
                                                    ? 'Manager approval required'
                                                    : 'No approval required'}
                                            </span>
                                        </div>
                                    </div>
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
                title={editingRule ? 'Edit OT Rule' : 'Create OT Rule'}
                size="lg"
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Rule Name *
                            </label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="e.g., Standard OT Policy"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Employment Type
                            </label>
                            <select
                                value={form.employmentType}
                                onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            >
                                <option value="">All Types</option>
                                <option value="PERMANENT">Permanent</option>
                                <option value="CONTRACT">Contract</option>
                                <option value="INTERN">Intern</option>
                                <option value="PROBATION">Probation</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Daily Threshold (minutes) *
                            </label>
                            <input
                                type="number"
                                value={form.dailyThresholdMinutes}
                                onChange={(e) =>
                                    setForm({ ...form, dailyThresholdMinutes: parseInt(e.target.value) || 0 })
                                }
                                min={0}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                OT starts after this many minutes of work per day
                            </p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Weekly Threshold (minutes)
                            </label>
                            <input
                                type="number"
                                value={form.weeklyThresholdMinutes}
                                onChange={(e) =>
                                    setForm({ ...form, weeklyThresholdMinutes: e.target.value })
                                }
                                min={0}
                                placeholder="Optional"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Rounding Interval (min)
                            </label>
                            <input
                                type="number"
                                value={form.roundingIntervalMinutes}
                                onChange={(e) =>
                                    setForm({ ...form, roundingIntervalMinutes: parseInt(e.target.value) || 0 })
                                }
                                min={1}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">OT rounded to nearest interval</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Max OT/Day (minutes)
                            </label>
                            <input
                                type="number"
                                value={form.maxOtPerDayMinutes}
                                onChange={(e) =>
                                    setForm({ ...form, maxOtPerDayMinutes: e.target.value })
                                }
                                min={0}
                                placeholder="No limit"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Max OT/Month (minutes)
                            </label>
                            <input
                                type="number"
                                value={form.maxOtPerMonthMinutes}
                                onChange={(e) =>
                                    setForm({ ...form, maxOtPerMonthMinutes: e.target.value })
                                }
                                min={0}
                                placeholder="No limit"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                        <input
                            type="checkbox"
                            id="requiresApproval"
                            checked={form.requiresManagerApproval}
                            onChange={(e) =>
                                setForm({ ...form, requiresManagerApproval: e.target.checked })
                            }
                            className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-2 focus:ring-primary-500"
                        />
                        <label htmlFor="requiresApproval" className="text-sm text-gray-700">
                            Requires manager approval for overtime
                        </label>
                    </div>

                    <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-700">
                            Daily threshold is the number of work minutes after which overtime begins counting.
                            For example, 480 minutes = 8 hours standard work day.
                        </p>
                    </div>
                </div>

                <ModalFooter>
                    <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} loading={saving} disabled={!form.name}>
                        {editingRule ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Confirmation */}
            <Modal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete OT Rule"
                size="sm"
            >
                <p className="text-gray-600">
                    Are you sure you want to delete <strong>{deletingRule?.name}</strong>?
                    This action cannot be undone.
                </p>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setDeleteModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDelete} loading={saving}>
                        Delete
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
