'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { leaveApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    Calendar,
    Check,
    X,
    Settings,
} from 'lucide-react';

interface LeaveType {
    id: string;
    name: string;
    code: string;
    description?: string;
    defaultDays: number;
    carryForward: boolean;
    maxCarryForward?: number;
    isPaid: boolean;
    isActive: boolean;
}

const emptyFormData = {
    name: '',
    code: '',
    description: '',
    defaultDays: 0,
    carryForward: false,
    maxCarryForward: 0,
    isPaid: true,
};

export default function LeaveTypesAdminPage() {
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editingType, setEditingType] = useState<LeaveType | null>(null);
    const [deletingType, setDeletingType] = useState<LeaveType | null>(null);
    const [formData, setFormData] = useState(emptyFormData);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await leaveApi.getTypes();
            setLeaveTypes(res.data);
        } catch (error) {
            console.error('Failed to load leave types:', error);
        } finally {
            setLoading(false);
        }
    };

    const openCreateModal = () => {
        setEditingType(null);
        setFormData(emptyFormData);
        setModalOpen(true);
    };

    const openEditModal = (type: LeaveType) => {
        setEditingType(type);
        setFormData({
            name: type.name,
            code: type.code,
            description: type.description || '',
            defaultDays: type.defaultDays,
            carryForward: type.carryForward,
            maxCarryForward: type.maxCarryForward || 0,
            isPaid: type.isPaid,
        });
        setModalOpen(true);
    };

    const openDeleteModal = (type: LeaveType) => {
        setDeletingType(type);
        setDeleteModalOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            if (editingType) {
                await leaveApi.updateLeaveType(editingType.id, formData);
            } else {
                await leaveApi.createLeaveType(formData);
            }
            setModalOpen(false);
            await loadData();
        } catch (error) {
            console.error('Failed to save leave type:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingType) return;
        setSaving(true);
        try {
            await leaveApi.deleteLeaveType(deletingType.id);
            setDeleteModalOpen(false);
            setDeletingType(null);
            await loadData();
        } catch (error) {
            console.error('Failed to delete leave type:', error);
        } finally {
            setSaving(false);
        }
    };

    const getTypeColor = (code: string): string => {
        const colors: Record<string, string> = {
            'CL': 'bg-blue-500',
            'SL': 'bg-red-500',
            'PL': 'bg-emerald-500',
            'LOP': 'bg-warm-500',
            'ML': 'bg-pink-500',
            'PFL': 'bg-purple-500',
        };
        return colors[code] || 'bg-indigo-500';
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
                            <Settings className="w-7 h-7 text-primary-600" />
                            Leave Types Configuration
                        </h1>
                        <p className="text-warm-600 mt-1">
                            Manage leave types available to employees
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreateModal}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Leave Type
                        </Button>
                    </div>
                </div>

                {/* Leave Types Grid */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : leaveTypes.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Calendar className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-warm-900 mb-2">
                                No Leave Types Configured
                            </h3>
                            <p className="text-warm-600 mb-4">
                                Start by creating your first leave type.
                            </p>
                            <Button onClick={openCreateModal}>
                                <Plus className="w-4 h-4 mr-2" />
                                Create Leave Type
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {leaveTypes.map((type) => (
                            <Card key={type.id} className={cn(!type.isActive && 'opacity-60')}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={cn(
                                                'w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold',
                                                getTypeColor(type.code)
                                            )}>
                                                {type.code.substring(0, 2)}
                                            </div>
                                            <div>
                                                <CardTitle className="text-base">{type.name}</CardTitle>
                                                <span className="text-xs text-warm-500">{type.code}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => openEditModal(type)}
                                                className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => openDeleteModal(type)}
                                                className="p-2 text-warm-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {type.description && (
                                        <p className="text-sm text-warm-600 mb-3">{type.description}</p>
                                    )}
                                    <div className="grid grid-cols-2 gap-2 text-sm">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-4 h-4 text-warm-400" />
                                            <span className="text-warm-600">{type.defaultDays} days/year</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {type.isPaid ? (
                                                <>
                                                    <Check className="w-4 h-4 text-emerald-500" />
                                                    <span className="text-emerald-600">Paid</span>
                                                </>
                                            ) : (
                                                <>
                                                    <X className="w-4 h-4 text-warm-400" />
                                                    <span className="text-warm-500">Unpaid</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {type.carryForward ? (
                                                <>
                                                    <Check className="w-4 h-4 text-emerald-500" />
                                                    <span className="text-emerald-600">Carry Forward</span>
                                                </>
                                            ) : (
                                                <>
                                                    <X className="w-4 h-4 text-warm-400" />
                                                    <span className="text-warm-500">No Carry</span>
                                                </>
                                            )}
                                        </div>
                                        {type.carryForward && type.maxCarryForward && (
                                            <div className="text-warm-600">
                                                Max: {type.maxCarryForward} days
                                            </div>
                                        )}
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
                title={editingType ? 'Edit Leave Type' : 'Create Leave Type'}
                size="lg"
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">
                                Name *
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g., Casual Leave"
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">
                                Code *
                            </label>
                            <input
                                type="text"
                                value={formData.code}
                                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                placeholder="e.g., CL"
                                maxLength={5}
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                            Description
                        </label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Brief description of this leave type..."
                            rows={2}
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">
                                Default Days Per Year
                            </label>
                            <input
                                type="number"
                                value={formData.defaultDays}
                                onChange={(e) => setFormData({ ...formData, defaultDays: parseInt(e.target.value) || 0 })}
                                min={0}
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">
                                Max Carry Forward Days
                            </label>
                            <input
                                type="number"
                                value={formData.maxCarryForward}
                                onChange={(e) => setFormData({ ...formData, maxCarryForward: parseInt(e.target.value) || 0 })}
                                min={0}
                                disabled={!formData.carryForward}
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-warm-100"
                            />
                        </div>
                    </div>

                    <div className="flex gap-6">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.isPaid}
                                onChange={(e) => setFormData({ ...formData, isPaid: e.target.checked })}
                                className="w-4 h-4 text-primary-600 border-warm-300 rounded focus:ring-primary-500"
                            />
                            <span className="text-sm text-warm-700">Paid Leave</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.carryForward}
                                onChange={(e) => setFormData({ ...formData, carryForward: e.target.checked })}
                                className="w-4 h-4 text-primary-600 border-warm-300 rounded focus:ring-primary-500"
                            />
                            <span className="text-sm text-warm-700">Allow Carry Forward</span>
                        </label>
                    </div>
                </div>

                <ModalFooter>
                    <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} loading={saving} disabled={!formData.name || !formData.code}>
                        {editingType ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Confirmation Modal */}
            <Modal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete Leave Type"
                size="sm"
            >
                <p className="text-warm-600">
                    Are you sure you want to delete <strong>{deletingType?.name}</strong>?
                    This will deactivate the leave type. Existing leave records will not be affected.
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
