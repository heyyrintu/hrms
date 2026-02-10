'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { expensesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    RefreshCw,
    Wallet,
    Search,
    CheckCircle2,
    XCircle,
    IndianRupee,
    ClipboardCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ExpenseClaim, ExpenseClaimStatus } from '@/types';

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

export default function ExpenseApprovalsPage() {
    const [claims, setClaims] = useState<ExpenseClaim[]>([]);
    const [loading, setLoading] = useState(true);
    const [reviewModalOpen, setReviewModalOpen] = useState(false);
    const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
    const [reviewingClaim, setReviewingClaim] = useState<ExpenseClaim | null>(null);
    const [approverNote, setApproverNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await expensesApi.getPendingApprovals();
            setClaims(res.data.data);
            setMeta(res.data.meta);
        } catch {
            toast.error('Failed to load pending claims');
        } finally {
            setLoading(false);
        }
    };

    const filteredClaims = claims.filter((c) =>
        c.employee?.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.employee?.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.category?.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openReviewModal = (claim: ExpenseClaim, action: 'approve' | 'reject') => {
        setReviewingClaim(claim);
        setReviewAction(action);
        setApproverNote('');
        setReviewModalOpen(true);
    };

    const handleReview = async () => {
        if (!reviewingClaim) return;
        setSaving(true);
        try {
            const payload = approverNote ? { approverNote } : {};
            if (reviewAction === 'approve') {
                await expensesApi.approveClaim(reviewingClaim.id, payload);
                toast.success('Claim approved');
            } else {
                await expensesApi.rejectClaim(reviewingClaim.id, payload);
                toast.success('Claim rejected');
            }
            setReviewModalOpen(false);
            await loadData();
        } catch {
            toast.error(`Failed to ${reviewAction} claim`);
        } finally {
            setSaving(false);
        }
    };

    const handleReimburse = async (claimId: string) => {
        try {
            await expensesApi.markReimbursed(claimId);
            toast.success('Claim marked as reimbursed');
            await loadData();
        } catch {
            toast.error('Failed to mark as reimbursed');
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

    const totalPendingAmount = claims.reduce((sum, c) => sum + Number(c.amount), 0);

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <ClipboardCheck className="w-7 h-7 text-primary-600" />
                            Expense Approvals
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Review and approve expense claims
                        </p>
                    </div>
                    <Button variant="secondary" onClick={loadData} disabled={loading}>
                        <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                        Refresh
                    </Button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-orange-50">
                                    <Wallet className="w-5 h-5 text-orange-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-orange-600">{meta.total}</p>
                                    <p className="text-sm text-gray-500">Pending Claims</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-blue-50">
                                    <IndianRupee className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold text-blue-600">{formatCurrency(totalPendingAmount)}</p>
                                    <p className="text-sm text-gray-500">Total Pending Amount</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search by employee name, description, or category..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                </div>

                {/* Claims List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredClaims.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <CheckCircle2 className="w-16 h-16 text-green-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">All Caught Up</h3>
                            <p className="text-gray-600">
                                {searchQuery ? 'No claims match your search.' : 'No pending expense claims to review.'}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-200 bg-gray-50">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Employee</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Category</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Description</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Amount</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {filteredClaims.map((claim) => (
                                        <tr key={claim.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3">
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">
                                                        {claim.employee?.firstName} {claim.employee?.lastName}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {claim.employee?.designation} {claim.employee?.department?.name ? `- ${claim.employee.department.name}` : ''}
                                                    </p>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-900">
                                                {claim.category?.name || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                                                {claim.description}
                                            </td>
                                            <td className="px-4 py-3 text-sm whitespace-nowrap">
                                                {formatDate(claim.expenseDate)}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right whitespace-nowrap">
                                                {formatCurrency(Number(claim.amount))}
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <button
                                                    onClick={() => openReviewModal(claim, 'approve')}
                                                    className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                    title="Approve"
                                                >
                                                    <CheckCircle2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => openReviewModal(claim, 'reject')}
                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Reject"
                                                >
                                                    <XCircle className="w-4 h-4" />
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

            {/* Review Modal */}
            <Modal
                isOpen={reviewModalOpen}
                onClose={() => setReviewModalOpen(false)}
                title={reviewAction === 'approve' ? 'Approve Expense Claim' : 'Reject Expense Claim'}
                size="md"
            >
                {reviewingClaim && (
                    <div className="space-y-4">
                        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-500">Employee</span>
                                <span className="text-sm font-medium">
                                    {reviewingClaim.employee?.firstName} {reviewingClaim.employee?.lastName}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-500">Category</span>
                                <span className="text-sm font-medium">{reviewingClaim.category?.name}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-500">Amount</span>
                                <span className="text-sm font-bold">{formatCurrency(Number(reviewingClaim.amount))}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-gray-500">Date</span>
                                <span className="text-sm font-medium">{formatDate(reviewingClaim.expenseDate)}</span>
                            </div>
                            <div className="pt-2 border-t">
                                <p className="text-sm text-gray-500">Description</p>
                                <p className="text-sm text-gray-900 mt-1">{reviewingClaim.description}</p>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Note (optional)
                            </label>
                            <textarea
                                value={approverNote}
                                onChange={(e) => setApproverNote(e.target.value)}
                                placeholder={reviewAction === 'reject' ? 'Reason for rejection...' : 'Any comments...'}
                                rows={2}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                            />
                        </div>
                    </div>
                )}

                <ModalFooter>
                    <Button variant="secondary" onClick={() => setReviewModalOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        variant={reviewAction === 'approve' ? 'primary' : 'danger'}
                        onClick={handleReview}
                        loading={saving}
                    >
                        {reviewAction === 'approve' ? 'Approve' : 'Reject'}
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
