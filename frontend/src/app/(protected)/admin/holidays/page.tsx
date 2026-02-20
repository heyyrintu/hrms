'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { holidaysApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    CalendarDays,
    Search,
    Filter,
} from 'lucide-react';
import { HolidayType } from '@/types';

interface Holiday {
    id: string;
    name: string;
    date: string;
    type: HolidayType;
    region?: string;
    isOptional: boolean;
    description?: string;
    isActive: boolean;
}

const holidayTypeOptions: { value: HolidayType; label: string }[] = [
    { value: HolidayType.NATIONAL, label: 'National' },
    { value: HolidayType.REGIONAL, label: 'Regional' },
    { value: HolidayType.COMPANY, label: 'Company' },
    { value: HolidayType.OPTIONAL, label: 'Optional' },
];

const typeColors: Record<HolidayType, string> = {
    [HolidayType.NATIONAL]: 'danger',
    [HolidayType.REGIONAL]: 'warning',
    [HolidayType.COMPANY]: 'info',
    [HolidayType.OPTIONAL]: 'gray',
};

const emptyFormData = {
    name: '',
    date: '',
    type: HolidayType.COMPANY as HolidayType,
    region: '',
    isOptional: false,
    description: '',
};

export default function HolidaysAdminPage() {
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null);
    const [deletingHoliday, setDeletingHoliday] = useState<Holiday | null>(null);
    const [formData, setFormData] = useState(emptyFormData);
    const [saving, setSaving] = useState(false);
    const [filterYear, setFilterYear] = useState(new Date().getFullYear());
    const [filterType, setFilterType] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        loadData();
    }, [filterYear, filterType]);

    const loadData = async () => {
        setLoading(true);
        try {
            const params: Record<string, unknown> = { year: filterYear };
            if (filterType) params.type = filterType;
            const res = await holidaysApi.getAll(params);
            setHolidays(res.data);
        } catch (error) {
            console.error('Failed to load holidays:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredHolidays = holidays.filter((h) =>
        h.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openCreateModal = () => {
        setEditingHoliday(null);
        setFormData(emptyFormData);
        setModalOpen(true);
    };

    const openEditModal = (holiday: Holiday) => {
        setEditingHoliday(holiday);
        setFormData({
            name: holiday.name,
            date: holiday.date.split('T')[0],
            type: holiday.type,
            region: holiday.region || '',
            isOptional: holiday.isOptional,
            description: holiday.description || '',
        });
        setModalOpen(true);
    };

    const openDeleteModal = (holiday: Holiday) => {
        setDeletingHoliday(holiday);
        setDeleteModalOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: formData.name,
                date: formData.date,
                type: formData.type,
                isOptional: formData.isOptional,
                description: formData.description || undefined,
                region: formData.region || undefined,
            };

            if (editingHoliday) {
                await holidaysApi.update(editingHoliday.id, payload);
            } else {
                await holidaysApi.create(payload);
            }
            setModalOpen(false);
            await loadData();
        } catch (error) {
            console.error('Failed to save holiday:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingHoliday) return;
        setSaving(true);
        try {
            await holidaysApi.delete(deletingHoliday.id);
            setDeleteModalOpen(false);
            setDeletingHoliday(null);
            await loadData();
        } catch (error) {
            console.error('Failed to delete holiday:', error);
        } finally {
            setSaving(false);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-IN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const isPastDate = (dateStr: string) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return new Date(dateStr) < today;
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
                            <CalendarDays className="w-7 h-7 text-primary-600" />
                            Holiday Calendar
                        </h1>
                        <p className="text-warm-600 mt-1">
                            Manage company holidays and observances
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreateModal}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Holiday
                        </Button>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
                        <input
                            type="text"
                            placeholder="Search holidays..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <select
                        value={filterYear}
                        onChange={(e) => setFilterYear(Number(e.target.value))}
                        className="px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                        {[0, 1, 2].map((offset) => {
                            const year = new Date().getFullYear() + offset;
                            return (
                                <option key={year} value={year}>
                                    {year}
                                </option>
                            );
                        })}
                    </select>
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                        <option value="">All Types</option>
                        {holidayTypeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-warm-900">{holidays.length}</p>
                            <p className="text-sm text-warm-500">Total Holidays</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-red-600">
                                {holidays.filter((h) => h.type === HolidayType.NATIONAL).length}
                            </p>
                            <p className="text-sm text-warm-500">National</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-blue-600">
                                {holidays.filter((h) => h.type === HolidayType.COMPANY).length}
                            </p>
                            <p className="text-sm text-warm-500">Company</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-warm-600">
                                {holidays.filter((h) => h.isOptional).length}
                            </p>
                            <p className="text-sm text-warm-500">Optional</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Holiday List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredHolidays.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <CalendarDays className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-warm-900 mb-2">
                                No Holidays Found
                            </h3>
                            <p className="text-warm-600 mb-4">
                                {searchQuery
                                    ? 'No holidays match your search.'
                                    : `No holidays configured for ${filterYear}.`}
                            </p>
                            <Button onClick={openCreateModal}>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Holiday
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-warm-200 bg-warm-50">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Date
                                        </th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Holiday
                                        </th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Type
                                        </th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Region
                                        </th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-warm-200">
                                    {filteredHolidays.map((holiday) => (
                                        <tr
                                            key={holiday.id}
                                            className={cn(
                                                'hover:bg-warm-50 transition-colors',
                                                isPastDate(holiday.date) && 'opacity-60'
                                            )}
                                        >
                                            <td className="px-4 py-3 whitespace-nowrap text-sm">
                                                {formatDate(holiday.date)}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div>
                                                    <p className="text-sm font-medium text-warm-900">
                                                        {holiday.name}
                                                    </p>
                                                    {holiday.description && (
                                                        <p className="text-xs text-warm-500 mt-0.5">
                                                            {holiday.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <Badge
                                                    variant={
                                                        typeColors[holiday.type] as
                                                            | 'danger'
                                                            | 'warning'
                                                            | 'info'
                                                            | 'gray'
                                                    }
                                                >
                                                    {holiday.type}
                                                </Badge>
                                                {holiday.isOptional && (
                                                    <Badge variant="gray" className="ml-1">
                                                        Optional
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-warm-500">
                                                {holiday.region || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <button
                                                    onClick={() => openEditModal(holiday)}
                                                    className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => openDeleteModal(holiday)}
                                                    className="p-2 text-warm-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}
            </div>

            {/* Create/Edit Modal */}
            <Modal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editingHoliday ? 'Edit Holiday' : 'Add Holiday'}
                size="lg"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                            Holiday Name *
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="e.g., Republic Day"
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">
                                Date *
                            </label>
                            <input
                                type="date"
                                value={formData.date}
                                onChange={(e) =>
                                    setFormData({ ...formData, date: e.target.value })
                                }
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">
                                Type
                            </label>
                            <select
                                value={formData.type}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        type: e.target.value as HolidayType,
                                    })
                                }
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            >
                                {holidayTypeOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                            Region
                        </label>
                        <input
                            type="text"
                            value={formData.region}
                            onChange={(e) =>
                                setFormData({ ...formData, region: e.target.value })
                            }
                            placeholder="e.g., West Bengal (optional, for regional holidays)"
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                            Description
                        </label>
                        <textarea
                            value={formData.description}
                            onChange={(e) =>
                                setFormData({ ...formData, description: e.target.value })
                            }
                            placeholder="Brief description..."
                            rows={2}
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                        />
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={formData.isOptional}
                            onChange={(e) =>
                                setFormData({ ...formData, isOptional: e.target.checked })
                            }
                            className="w-4 h-4 text-primary-600 border-warm-300 rounded focus:ring-primary-500"
                        />
                        <span className="text-sm text-warm-700">Optional Holiday</span>
                    </label>
                </div>

                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => setModalOpen(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        loading={saving}
                        disabled={!formData.name || !formData.date}
                    >
                        {editingHoliday ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Confirmation */}
            <Modal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete Holiday"
                size="sm"
            >
                <p className="text-warm-600">
                    Are you sure you want to delete{' '}
                    <strong>{deletingHoliday?.name}</strong>? This will deactivate
                    the holiday entry.
                </p>
                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => setDeleteModalOpen(false)}
                        disabled={saving}
                    >
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
