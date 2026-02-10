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
    Wallet,
    Search,
    Send,
    IndianRupee,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ExpenseClaim, ExpenseCategory, ExpenseClaimStatus } from '@/types';

const statusColors: Record<ExpenseClaimStatus, string> = {
    DRAFT: 'gray',
    SUBMITTED: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    REIMBURSED: 'info',
};

const statusLabels: Record<ExpenseClaimStatus, string> = {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    REIMBURSED: 'Reimbursed',
};

const emptyFormData = {
    categoryId: '',
    amount: '',
    description: '',
    expenseDate: new Date().toISOString().split('T')[0],
};

export default function ExpensesPage() {
    const [claims, setClaims] = useState<ExpenseClaim[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editingClaim, setEditingClaim] = useState<ExpenseClaim | null>(null);
    const [deletingClaim, setDeletingClaim] = useState<ExpenseClaim | null>(null);
    const [formData, setFormData] = useState(emptyFormData);
    const [saving, setSaving] = useState(false);
    const [filterStatus, setFilterStatus] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });

    useEffect(() => {
        loadData();
    }, [filterStatus]);

    const loadData = async () => {
        setLoading(true);
        try {
            const params: Record<string, string> = {};
            if (filterStatus) params.status = filterStatus;
            const [claimsRes, categoriesRes] = await Promise.all([
                expensesApi.getMyClaims(params),
                expensesApi.getCategories(),
            ]);
            setClaims(claimsRes.data.data);
            setMeta(claimsRes.data.meta);
            setCategories(categoriesRes.data.filter((c: ExpenseCategory) => c.isActive));
        } catch {
            toast.error('Failed to load expense data');
        } finally {
            setLoading(false);
        }
    };

    const filteredClaims = claims.filter((c) =>
        c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.category?.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openCreateModal = () => {
        setEditingClaim(null);
        setFormData(emptyFormData);
        setModalOpen(true);
    };

    const openEditModal = (claim: ExpenseClaim) => {
        setEditingClaim(claim);
        setFormData({
            categoryId: claim.categoryId,
            amount: String(claim.amount),
            description: claim.description,
            expenseDate: claim.expenseDate.split('T')[0],
        });
        setModalOpen(true);
    };

    const openDeleteModal = (claim: ExpenseClaim) => {
        setDeletingClaim(claim);
        setDeleteModalOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload = {
                categoryId: formData.categoryId,
                amount: parseFloat(formData.amount),
                description: formData.description,
                expenseDate: formData.expenseDate,
            };

            if (editingClaim) {
                await expensesApi.updateClaim(editingClaim.id, payload);
                toast.success('Claim updated');
            } else {
                await expensesApi.createClaim(payload);
                toast.success('Claim created');
            }
            setModalOpen(false);
            await loadData();
        } catch {
            toast.error('Failed to save claim');
        } finally {
            setSaving(false);
        }
    };

    const handleSubmit = async (claimId: string) => {
        try {
            await expensesApi.submitClaim(claimId);
            toast.success('Claim submitted for approval');
            await loadData();
        } catch {
            toast.error('Failed to submit claim');
        }
    };

    const handleDelete = async () => {
        if (!deletingClaim) return;
        setSaving(true);
        try {
            await expensesApi.deleteClaim(deletingClaim.id);
            toast.success('Claim deleted');
            setDeleteModalOpen(false);
            setDeletingClaim(null);
            await loadData();
        } catch {
            toast.error('Failed to delete claim');
        } finally {
            setSaving(false);
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
        }).format(amount);
    };

    const totalClaimed = claims.reduce((sum, c) => sum + Number(c.amount), 0);
    const totalApproved = claims
        .filter((c) => c.status === 'APPROVED' || c.status === 'REIMBURSED')
        .reduce((sum, c) => sum + Number(c.amount), 0);
    const pendingCount = claims.filter((c) => c.status === 'SUBMITTED').length;

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Wallet className="w-7 h-7 text-primary-600" />
                            My Expenses
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Submit and track your expense claims
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreateModal}>
                            <Plus className="w-4 h-4 mr-2" />
                            New Claim
                        </Button>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-50">
                                    <IndianRupee className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalClaimed)}</p>
                                    <p className="text-sm text-gray-500">Total Claimed</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-green-50">
                                    <IndianRupee className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-green-600">{formatCurrency(totalApproved)}</p>
                                    <p className="text-sm text-gray-500">Approved / Reimbursed</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-orange-50">
                                    <Send className="w-5 h-5 text-orange-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-orange-600">{pendingCount}</p>
                                    <p className="text-sm text-gray-500">Pending Approval</p>
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
                            placeholder="Search claims..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    >
                        <option value="">All Statuses</option>
                        <option value="DRAFT">Draft</option>
                        <option value="SUBMITTED">Submitted</option>
                        <option value="APPROVED">Approved</option>
                        <option value="REJECTED">Rejected</option>
                        <option value="REIMBURSED">Reimbursed</option>
                    </select>
                </div>

                {/* Claims List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredClaims.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Wallet className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Expense Claims</h3>
                            <p className="text-gray-600 mb-4">
                                {searchQuery ? 'No claims match your search.' : 'You have not submitted any expense claims yet.'}
                            </p>
                            <Button onClick={openCreateModal}>
                                <Plus className="w-4 h-4 mr-2" />
                                New Claim
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-200 bg-gray-50">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Description</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                                        <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {filteredClaims.map((claim) => (
                                        <tr key={claim.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 text-sm whitespace-nowrap">
                                                {formatDate(claim.expenseDate)}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                                {claim.category?.name || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                                                {claim.description}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right whitespace-nowrap">
                                                {formatCurrency(Number(claim.amount))}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <Badge variant={statusColors[claim.status] as 'gray' | 'warning' | 'success' | 'danger' | 'info'}>
                                                    {statusLabels[claim.status]}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                {claim.status === 'DRAFT' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleSubmit(claim.id)}
                                                            className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                                            title="Submit for approval"
                                                        >
                                                            <Send className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => openEditModal(claim)}
                                                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => openDeleteModal(claim)}
                                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                )}
                                                {claim.approverNote && (
                                                    <span className="text-xs text-gray-500 ml-2" title={claim.approverNote}>
                                                        Note
                                                    </span>
                                                )}
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
                title={editingClaim ? 'Edit Expense Claim' : 'New Expense Claim'}
                size="lg"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
                        <select
                            value={formData.categoryId}
                            onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="">Select category</option>
                            {categories.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                    {cat.name} {cat.maxAmount ? `(Max: ${formatCurrency(Number(cat.maxAmount))})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
                            <input
                                type="number"
                                value={formData.amount}
                                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                                placeholder="0.00"
                                min="0.01"
                                step="0.01"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Expense Date *</label>
                            <input
                                type="date"
                                value={formData.expenseDate}
                                onChange={(e) => setFormData({ ...formData, expenseDate: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Describe the expense..."
                            rows={3}
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
                        disabled={!formData.categoryId || !formData.amount || !formData.description || !formData.expenseDate}
                    >
                        {editingClaim ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Confirmation */}
            <Modal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete Expense Claim"
                size="sm"
            >
                <p className="text-gray-600">
                    Are you sure you want to delete this expense claim of{' '}
                    <strong>{deletingClaim ? formatCurrency(Number(deletingClaim.amount)) : ''}</strong>?
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
