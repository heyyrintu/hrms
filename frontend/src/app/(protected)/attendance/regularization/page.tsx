'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { regularizationApi } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import {
  ClipboardEdit,
  Plus,
  RefreshCw,
  Clock,
  ChevronDown,
  ChevronUp,
  Filter,
  CalendarDays,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AttendanceRegularization, RegularizationStatus } from '@/types';

export default function RegularizationPage() {
  const [requests, setRequests] = useState<AttendanceRegularization[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);

  // Create modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formDate, setFormDate] = useState('');
  const [requestedClockIn, setRequestedClockIn] = useState('');
  const [requestedClockOut, setRequestedClockOut] = useState('');
  const [reason, setReason] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await regularizationApi.getMyRequests();
      setRequests(res.data.data || res.data || []);
    } catch {
      toast.error('Failed to load regularization requests');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formDate || !requestedClockIn || !requestedClockOut || !reason.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    setCreating(true);
    try {
      await regularizationApi.create({
        date: formDate,
        requestedClockIn,
        requestedClockOut,
        reason: reason.trim(),
      });
      toast.success('Regularization request submitted successfully');
      setCreateModalOpen(false);
      setFormDate('');
      setRequestedClockIn('');
      setRequestedClockOut('');
      setReason('');
      await loadData();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to create regularization request');
    } finally {
      setCreating(false);
    }
  };

  const filteredRequests = requests.filter(
    (req) => statusFilter === 'all' || req.status === statusFilter,
  );

  const statusCounts = {
    all: requests.length,
    PENDING: requests.filter((r) => r.status === RegularizationStatus.PENDING).length,
    APPROVED: requests.filter((r) => r.status === RegularizationStatus.APPROVED).length,
    REJECTED: requests.filter((r) => r.status === RegularizationStatus.REJECTED).length,
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent mx-auto" />
          <p className="mt-4 text-warm-600">Loading regularization requests...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
              <ClipboardEdit className="w-6 h-6 text-primary-600" />
              Attendance Regularization
            </h1>
            <p className="text-warm-600 mt-1">
              Request corrections for missed or incorrect clock-in/out entries
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={loadData} disabled={loading}>
              <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              New Request
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-warm-900">{statusCounts.all}</p>
              <p className="text-sm text-warm-500">Total Requests</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{statusCounts.PENDING}</p>
              <p className="text-sm text-warm-500">Pending</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{statusCounts.APPROVED}</p>
              <p className="text-sm text-warm-500">Approved</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-red-600">{statusCounts.REJECTED}</p>
              <p className="text-sm text-warm-500">Rejected</p>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-warm-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary-600" />
            My Requests
          </h2>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-warm-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-sm border border-warm-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">All Status</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>

        {/* Requests List */}
        <Card padding="none">
          <div className="divide-y divide-warm-100">
            {filteredRequests.length === 0 ? (
              <div className="py-12 text-center text-warm-500">
                <CalendarDays className="w-12 h-12 mx-auto mb-4 text-warm-300" />
                <p>No regularization requests found.</p>
                <Button
                  variant="ghost"
                  className="mt-4"
                  onClick={() => setCreateModalOpen(true)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Submit your first request
                </Button>
              </div>
            ) : (
              filteredRequests.map((request) => (
                <div key={request.id} className="p-4 hover:bg-warm-50 transition-colors">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() =>
                      setExpandedRequest(
                        expandedRequest === request.id ? null : request.id,
                      )
                    }
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold bg-gradient-to-r from-blue-500 to-blue-600">
                        AR
                      </div>
                      <div>
                        <div className="font-medium text-warm-900">
                          {formatDate(request.date)}
                        </div>
                        <div className="text-sm text-warm-500">
                          {request.requestedClockIn} — {request.requestedClockOut}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge variant={getStatusBadgeVariant(request.status)}>
                        {request.status}
                      </Badge>
                      {expandedRequest === request.id ? (
                        <ChevronUp className="w-5 h-5 text-warm-400" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-warm-400" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedRequest === request.id && (
                    <div className="mt-4 pt-4 border-t border-warm-100">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        {request.originalClockIn && (
                          <div>
                            <span className="text-warm-500">Original Clock In/Out:</span>
                            <p className="text-warm-900 mt-1">
                              {request.originalClockIn} — {request.originalClockOut || 'N/A'}
                            </p>
                          </div>
                        )}
                        <div>
                          <span className="text-warm-500">Requested Clock In/Out:</span>
                          <p className="text-warm-900 mt-1">
                            {request.requestedClockIn} — {request.requestedClockOut}
                          </p>
                        </div>
                        <div>
                          <span className="text-warm-500">Reason:</span>
                          <p className="text-warm-900 mt-1">{request.reason}</p>
                        </div>
                        <div>
                          <span className="text-warm-500">Submitted on:</span>
                          <p className="text-warm-900 mt-1">
                            {formatDate(request.createdAt)}
                          </p>
                        </div>
                        {request.approver && (
                          <div>
                            <span className="text-warm-500">Reviewed by:</span>
                            <p className="text-warm-900 mt-1">
                              {request.approver.firstName} {request.approver.lastName}
                            </p>
                          </div>
                        )}
                        {request.approverNote && (
                          <div>
                            <span className="text-warm-500">Reviewer Note:</span>
                            <p className="text-warm-900 mt-1">{request.approverNote}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Create Regularization Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Request Attendance Regularization"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Clock In <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={requestedClockIn}
                onChange={(e) => setRequestedClockIn(e.target.value)}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Clock Out <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={requestedClockOut}
                onChange={(e) => setRequestedClockOut(e.target.value)}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this correction is needed..."
              rows={3}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
            />
          </div>
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setCreateModalOpen(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} loading={creating}>
            Submit Request
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
