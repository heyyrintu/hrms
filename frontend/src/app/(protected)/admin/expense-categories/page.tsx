'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { expensesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    Tags,
    Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ExpenseCategory } from '@/types';

const emptyFormData = {
    name: '',
    code: '',
    description: '',
    maxAmount: '',
};

export default function ExpenseCategoriesPage() {
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
    const [deletingCategory, setDeletingCategory] = useState<ExpenseCategory | null>(null);
    const [formData, setFormData] = useState(emptyFormData);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await expensesApi.getCategories();
            setCategories(res.data);
        } catch {
            toast.error('Failed to load categories');
        } finally {
            setLoading(false);
        }
    };

    const filteredCategories = categories.filter((c) =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.code.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openCreateModal = () => {
        setEditingCategory(null);
        setFormData(emptyFormData);
        setModalOpen(true);
    };

    const openEditModal = (category: ExpenseCategory) => {
        setEditingCategory(category);
        setFormData({
            name: category.name,
            code: category.code,
            description: category.description || '',
            maxAmount: category.maxAmount ? String(category.maxAmount) : '',
        });
        setModalOpen(true);
    };

    const openDeleteModal = (category: ExpenseCategory) => {
        setDeletingCategory(category);
        setDeleteModalOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: formData.name,
                code: formData.code,
                description: formData.description || undefined,
                maxAmount: formData.maxAmount ? parseFloat(formData.maxAmount) : undefined,
            };

            if (editingCategory) {
                await expensesApi.updateCategory(editingCategory.id, payload);
                toast.success('Category updated');
            } else {
                await expensesApi.createCategory(payload);
                toast.success('Category created');
            }
            setModalOpen(false);
            await loadData();
        } catch {
            toast.error('Failed to save category');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (category: ExpenseCategory) => {
        try {
            await expensesApi.updateCategory(category.id, { isActive: !category.isActive });
            toast.success(category.isActive ? 'Category deactivated' : 'Category activated');
            await loadData();
        } catch {
            toast.error('Failed to update category');
        }
    };

    const handleDelete = async () => {
        if (!deletingCategory) return;
        setSaving(true);
        try {
            await expensesApi.deleteCategory(deletingCategory.id);
            toast.success('Category deleted');
            setDeleteModalOpen(false);
            setDeletingCategory(null);
            await loadData();
        } catch {
            toast.error('Cannot delete category with existing claims. Deactivate it instead.');
        } finally {
            setSaving(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const activeCount = categories.filter((c) => c.isActive).length;

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Tags className="w-7 h-7 text-primary-600" />
                            Expense Categories
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Manage expense claim categories and limits
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreateModal}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Category
                        </Button>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-gray-900">{categories.length}</p>
                            <p className="text-sm text-gray-500">Total Categories</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-green-600">{activeCount}</p>
                            <p className="text-sm text-gray-500">Active</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-gray-400">{categories.length - activeCount}</p>
                            <p className="text-sm text-gray-500">Inactive</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search categories..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                </div>

                {/* Categories List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredCategories.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Tags className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Categories Found</h3>
                            <p className="text-gray-600 mb-4">
                                {searchQuery ? 'No categories match your search.' : 'No expense categories configured yet.'}
                            </p>
                            <Button onClick={openCreateModal}>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Category
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-200 bg-gray-50">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Code</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Description</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Max Amount</th>
                                        <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {filteredCategories.map((category) => (
                                        <tr
                                            key={category.id}
                                            className={cn(
                                                'hover:bg-gray-50 transition-colors',
                                                !category.isActive && 'opacity-60'
                                            )}
                                        >
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                                {category.name}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500 font-mono">
                                                {category.code}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                                                {category.description || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-900 text-right whitespace-nowrap">
                                                {category.maxAmount ? formatCurrency(Number(category.maxAmount)) : 'No limit'}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <button onClick={() => handleToggleActive(category)}>
                                                    <Badge variant={category.isActive ? 'success' : 'gray'}>
                                                        {category.isActive ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <button
                                                    onClick={() => openEditModal(category)}
                                                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => openDeleteModal(category)}
                                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
                title={editingCategory ? 'Edit Category' : 'Add Category'}
                size="lg"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="e.g., Travel"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                            <input
                                type="text"
                                value={formData.code}
                                onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                placeholder="e.g., TRAVEL"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max Amount</label>
                            <input
                                type="number"
                                value={formData.maxAmount}
                                onChange={(e) => setFormData({ ...formData, maxAmount: e.target.value })}
                                placeholder="No limit"
                                min="0"
                                step="0.01"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Brief description of this category..."
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                        />
                    </div>
                </div>

                <ModalFooter>
                    <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        loading={saving}
                        disabled={!formData.name || !formData.code}
                    >
                        {editingCategory ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Confirmation */}
            <Modal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete Category"
                size="sm"
            >
                <p className="text-gray-600">
                    Are you sure you want to delete{' '}
                    <strong>{deletingCategory?.name}</strong>? If this category has existing
                    claims, it cannot be deleted — deactivate it instead.
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
