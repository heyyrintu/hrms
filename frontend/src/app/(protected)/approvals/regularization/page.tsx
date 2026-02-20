'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { regularizationApi } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import {
  RefreshCw,
  ClipboardEdit,
  Search,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AttendanceRegularization } from '@/types';

export default function RegularizationApprovalsPage() {
  const [requests, setRequests] = useState<AttendanceRegularization[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Review modal state
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject'>('approve');
  const [reviewingRequest, setReviewingRequest] = useState<AttendanceRegularization | null>(null);
  const [approverNote, setApproverNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await regularizationApi.getPendingApprovals();
      setRequests(res.data || []);
    } catch {
      toast.error('Failed to load pending regularization requests');
    } finally {
      setLoading(false);
    }
  };

  const filteredRequests = requests.filter(
    (r) =>
      r.employee?.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.employee?.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.employee?.employeeCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.reason.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const openReviewModal = (request: AttendanceRegularization, action: 'approve' | 'reject') => {
    setReviewingRequest(request);
    setReviewAction(action);
    setApproverNote('');
    setReviewModalOpen(true);
  };

  const handleReview = async () => {
    if (!reviewingRequest) return;
    setSaving(true);
    try {
      if (reviewAction === 'approve') {
        await regularizationApi.approve(reviewingRequest.id, approverNote || undefined);
        toast.success('Regularization request approved');
      } else {
        await regularizationApi.reject(reviewingRequest.id, approverNote || undefined);
        toast.success('Regularization request rejected');
      }
      setReviewModalOpen(false);
      await loadData();
    } catch {
      toast.error(`Failed to ${reviewAction} regularization request`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
              <ClipboardCheck className="w-7 h-7 text-primary-600" />
              Regularization Approvals
            </h1>
            <p className="text-warm-600 mt-1">
              Review and approve attendance regularization requests
            </p>
          </div>
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <ClipboardEdit className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-600">{requests.length}</p>
                <p className="text-sm text-warm-500">Pending Regularization Requests</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
          <input
            type="text"
            placeholder="Search by employee name, code, or reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Requests Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : filteredRequests.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <CheckCircle2 className="w-16 h-16 text-emerald-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-warm-900 mb-2">All Caught Up</h3>
              <p className="text-warm-600">
                {searchQuery
                  ? 'No requests match your search.'
                  : 'No pending regularization requests to review.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-warm-200 bg-warm-50">
                    <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                      Employee
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                      Requested Time
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                      Reason
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                      Status
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-200">
                  {filteredRequests.map((request) => (
                    <tr key={request.id} className="hover:bg-warm-50 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-warm-900">
                            {request.employee?.firstName} {request.employee?.lastName}
                          </p>
                          <p className="text-xs text-warm-500">
                            {request.employee?.employeeCode}
                            {request.employee?.department?.name
                              ? ` - ${request.employee.department.name}`
                              : ''}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-warm-900 whitespace-nowrap">
                        {formatDate(request.date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-warm-600 whitespace-nowrap">
                        {request.requestedClockIn} — {request.requestedClockOut}
                      </td>
                      <td className="px-4 py-3 text-sm text-warm-600 max-w-xs truncate">
                        {request.reason}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={getStatusBadgeVariant(request.status)}>
                          {request.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => openReviewModal(request, 'approve')}
                          className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Approve"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openReviewModal(request, 'reject')}
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
        title={
          reviewAction === 'approve'
            ? 'Approve Regularization Request'
            : 'Reject Regularization Request'
        }
        size="md"
      >
        {reviewingRequest && (
          <div className="space-y-4">
            <div className="bg-warm-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-warm-500">Employee</span>
                <span className="text-sm font-medium">
                  {reviewingRequest.employee?.firstName}{' '}
                  {reviewingRequest.employee?.lastName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-warm-500">Date</span>
                <span className="text-sm font-medium">
                  {formatDate(reviewingRequest.date)}
                </span>
              </div>
              {reviewingRequest.originalClockIn && (
                <div className="flex justify-between">
                  <span className="text-sm text-warm-500">Original Time</span>
                  <span className="text-sm font-medium">
                    {reviewingRequest.originalClockIn} — {reviewingRequest.originalClockOut || 'N/A'}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-sm text-warm-500">Requested Time</span>
                <span className="text-sm font-bold">
                  {reviewingRequest.requestedClockIn} — {reviewingRequest.requestedClockOut}
                </span>
              </div>
              <div className="pt-2 border-t">
                <p className="text-sm text-warm-500">Reason</p>
                <p className="text-sm text-warm-900 mt-1">
                  {reviewingRequest.reason}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Note (optional)
              </label>
              <textarea
                value={approverNote}
                onChange={(e) => setApproverNote(e.target.value)}
                placeholder={
                  reviewAction === 'reject'
                    ? 'Reason for rejection...'
                    : 'Any comments...'
                }
                rows={2}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
          </div>
        )}

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setReviewModalOpen(false)}
            disabled={saving}
          >
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
