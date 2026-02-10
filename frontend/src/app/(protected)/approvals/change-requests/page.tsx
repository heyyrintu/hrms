'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { selfServiceApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    RefreshCw,
    GitPullRequest,
    CheckCircle,
    XCircle,
    Clock,
    Filter,
} from 'lucide-react';
import { ChangeRequestStatus } from '@/types';

interface ChangeRequest {
    id: string;
    employeeId: string;
    fieldName: string;
    oldValue?: string;
    newValue: string;
    reason?: string;
    status: string;
    reviewNote?: string;
    reviewedAt?: string;
    employee?: { firstName: string; lastName: string; employeeCode: string };
    reviewer?: { firstName: string; lastName: string };
    createdAt: string;
}

export default function ChangeRequestsApprovalPage() {
    const [requests, setRequests] = useState<ChangeRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<string>('PENDING');

    // Review modal
    const [reviewModalOpen, setReviewModalOpen] = useState(false);
    const [reviewingRequest, setReviewingRequest] = useState<ChangeRequest | null>(null);
    const [reviewAction, setReviewAction] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
    const [reviewNote, setReviewNote] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadRequests();
    }, [filterStatus]);

    const loadRequests = async () => {
        setLoading(true);
        try {
            const params: Record<string, unknown> = {};
            if (filterStatus) params.status = filterStatus;
            const res = await selfServiceApi.getAllChangeRequests(params);
            setRequests(res.data);
        } catch (error) {
            console.error('Failed to load change requests:', error);
        } finally {
            setLoading(false);
        }
    };

    const openReviewModal = (req: ChangeRequest, action: 'APPROVED' | 'REJECTED') => {
        setReviewingRequest(req);
        setReviewAction(action);
        setReviewNote('');
        setReviewModalOpen(true);
    };

    const handleReview = async () => {
        if (!reviewingRequest) return;
        setSubmitting(true);
        try {
            await selfServiceApi.reviewChangeRequest(reviewingRequest.id, {
                status: reviewAction,
                reviewNote: reviewNote || undefined,
            });
            setReviewModalOpen(false);
            await loadRequests();
        } catch (error) {
            console.error('Failed to review request:', error);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <GitPullRequest className="w-7 h-7 text-primary-600" />
                            Change Requests
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Review employee profile change requests
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="PENDING">Pending</option>
                            <option value="APPROVED">Approved</option>
                            <option value="REJECTED">Rejected</option>
                            <option value="">All</option>
                        </select>
                        <Button variant="secondary" onClick={loadRequests} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                    </div>
                </div>

                {/* Requests */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : requests.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <GitPullRequest className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                No Change Requests
                            </h3>
                            <p className="text-gray-600">
                                {filterStatus === 'PENDING'
                                    ? 'No pending requests to review.'
                                    : 'No requests match the selected filter.'}
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
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Field</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Change</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Reason</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                                        {filterStatus === 'PENDING' && (
                                            <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {requests.map((req) => (
                                        <tr key={req.id} className="hover:bg-gray-50">
                                            <td className="px-4 py-3">
                                                <p className="text-sm font-medium text-gray-900">
                                                    {req.employee
                                                        ? `${req.employee.firstName} ${req.employee.lastName}`
                                                        : '—'}
                                                </p>
                                                <p className="text-xs text-gray-500">{req.employee?.employeeCode}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant="info">{req.fieldName}</Badge>
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="text-xs text-gray-500">{req.oldValue || '(empty)'}</p>
                                                <p className="text-sm font-medium text-gray-900">→ {req.newValue}</p>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                                                {req.reason || '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant={
                                                    req.status === 'APPROVED' ? 'success' :
                                                    req.status === 'REJECTED' ? 'danger' : 'warning'
                                                }>
                                                    {req.status}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500">
                                                {new Date(req.createdAt).toLocaleDateString()}
                                            </td>
                                            {filterStatus === 'PENDING' && (
                                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                                    <button
                                                        onClick={() => openReviewModal(req, 'APPROVED')}
                                                        className="p-2 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                                                        title="Approve"
                                                    >
                                                        <CheckCircle className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => openReviewModal(req, 'REJECTED')}
                                                        className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Reject"
                                                    >
                                                        <XCircle className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            )}
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
                title={reviewAction === 'APPROVED' ? 'Approve Change Request' : 'Reject Change Request'}
                size="md"
            >
                {reviewingRequest && (
                    <div className="space-y-4">
                        <div className="bg-gray-50 rounded-lg p-4">
                            <p className="text-sm text-gray-600">
                                <strong>{reviewingRequest.employee?.firstName} {reviewingRequest.employee?.lastName}</strong> wants to change
                            </p>
                            <p className="text-sm mt-2">
                                <span className="font-medium">{reviewingRequest.fieldName}</span>:{' '}
                                <span className="text-gray-500">{reviewingRequest.oldValue || '(empty)'}</span>
                                {' → '}
                                <span className="font-medium text-primary-600">{reviewingRequest.newValue}</span>
                            </p>
                            {reviewingRequest.reason && (
                                <p className="text-xs text-gray-500 mt-2">Reason: {reviewingRequest.reason}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Review Note (Optional)
                            </label>
                            <textarea
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value)}
                                placeholder="Add a note..."
                                rows={2}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                            />
                        </div>

                        {reviewAction === 'APPROVED' && (
                            <p className="text-xs text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                                Approving will automatically update the employee&apos;s profile field.
                            </p>
                        )}
                    </div>
                )}

                <ModalFooter>
                    <Button variant="secondary" onClick={() => setReviewModalOpen(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        variant={reviewAction === 'APPROVED' ? 'primary' : 'danger'}
                        onClick={handleReview}
                        loading={submitting}
                    >
                        {reviewAction === 'APPROVED' ? 'Approve' : 'Reject'}
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
