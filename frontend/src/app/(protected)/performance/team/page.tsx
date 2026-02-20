'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { performanceApi } from '@/lib/api';
import { PerformanceReview, PerformanceReviewStatus } from '@/types';
import toast from 'react-hot-toast';
import {
  Users,
  RefreshCw,
  Star,
  Eye,
} from 'lucide-react';

const statusColors: Record<PerformanceReviewStatus, string> = {
  PENDING: 'gray',
  SELF_REVIEW: 'warning',
  MANAGER_REVIEW: 'info',
  COMPLETED: 'success',
};

const statusLabels: Record<PerformanceReviewStatus, string> = {
  PENDING: 'Pending',
  SELF_REVIEW: 'Self Review',
  MANAGER_REVIEW: 'Manager Review',
  COMPLETED: 'Completed',
};

export default function TeamReviewsPage() {
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCycleId, setFilterCycleId] = useState('');

  // Manager review modal
  const [reviewModal, setReviewModal] = useState(false);
  const [selectedReview, setSelectedReview] = useState<PerformanceReview | null>(null);
  const [managerRating, setManagerRating] = useState(3);
  const [managerComments, setManagerComments] = useState('');
  const [overallRating, setOverallRating] = useState(3);
  const [submitting, setSubmitting] = useState(false);

  // View modal
  const [viewModal, setViewModal] = useState(false);
  const [viewReview, setViewReview] = useState<PerformanceReview | null>(null);

  const loadReviews = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(meta.limit),
      };
      if (filterStatus) params.status = filterStatus;
      if (filterCycleId) params.cycleId = filterCycleId;
      const res = await performanceApi.getTeamReviews(params);
      setReviews(res.data.data);
      setMeta(res.data.meta);
    } catch {
      toast.error('Failed to load team reviews');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCycleId, meta.limit]);

  useEffect(() => {
    loadReviews(1);
  }, [loadReviews]);

  const openManagerReview = async (review: PerformanceReview) => {
    try {
      const res = await performanceApi.getReview(review.id);
      setSelectedReview(res.data);
      setManagerRating(3);
      setManagerComments('');
      setOverallRating(3);
      setReviewModal(true);
    } catch {
      toast.error('Failed to load review details');
    }
  };

  const handleSubmitManagerReview = async () => {
    if (!selectedReview) return;
    setSubmitting(true);
    try {
      await performanceApi.submitManagerReview(selectedReview.id, {
        managerRating,
        managerComments: managerComments || undefined,
        overallRating,
      });
      toast.success('Manager review submitted');
      setReviewModal(false);
      loadReviews(meta.page);
    } catch {
      toast.error('Failed to submit manager review');
    } finally {
      setSubmitting(false);
    }
  };

  const openViewReview = async (review: PerformanceReview) => {
    try {
      const res = await performanceApi.getReview(review.id);
      setViewReview(res.data);
      setViewModal(true);
    } catch {
      toast.error('Failed to load review details');
    }
  };

  const renderStars = (rating?: number) => {
    if (!rating) return <span className="text-warm-400">-</span>;
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={`h-4 w-4 ${i <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-warm-300'}`}
          />
        ))}
      </div>
    );
  };

  const renderStarPicker = (value: number, onChange: (v: number) => void, label: string) => (
    <div>
      <label className="block text-sm font-medium text-warm-700 mb-2">{label} *</label>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} onClick={() => onChange(i)} className="p-1">
            <Star
              className={`h-8 w-8 transition-colors ${
                i <= value
                  ? 'text-yellow-400 fill-yellow-400'
                  : 'text-warm-300 hover:text-yellow-300'
              }`}
            />
          </button>
        ))}
        <span className="ml-2 text-sm text-warm-500">{value}/5</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Team Reviews</h1>
            <p className="text-sm text-warm-500">
              Review your team members&apos; performance
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => loadReviews(meta.page)}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border border-warm-300 px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="SELF_REVIEW">Self Review</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
            </div>
          ) : reviews.length === 0 ? (
            <div className="text-center py-12 text-warm-500">
              <Users className="h-12 w-12 mx-auto mb-3 text-warm-300" />
              <p className="text-lg font-medium">No team reviews</p>
              <p className="text-sm">Reviews will appear here when a cycle is launched</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-warm-50">
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Employee</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Designation</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Cycle</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Self Rating</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Overall</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => (
                    <tr key={review.id} className="border-b hover:bg-warm-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-warm-900">
                          {review.employee
                            ? `${review.employee.firstName} ${review.employee.lastName}`
                            : '-'}
                        </p>
                        {review.employee?.department && (
                          <p className="text-xs text-warm-500">{review.employee.department.name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-warm-600">
                        {review.employee?.designation || '-'}
                      </td>
                      <td className="px-4 py-3 text-warm-600">
                        {review.cycle?.name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusColors[review.status] as 'gray' | 'warning' | 'info' | 'success'}>
                          {statusLabels[review.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{renderStars(review.selfRating)}</td>
                      <td className="px-4 py-3">{renderStars(review.overallRating)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {review.status === 'SELF_REVIEW' && (
                            <Button
                              variant="primary"
                              onClick={() => openManagerReview(review)}
                            >
                              Review
                            </Button>
                          )}
                          {review.status === 'COMPLETED' && (
                            <button
                              onClick={() => openViewReview(review)}
                              className="text-warm-500 hover:text-warm-700"
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manager Review Modal */}
      <Modal
        isOpen={reviewModal}
        onClose={() => setReviewModal(false)}
        title={`Manager Review - ${selectedReview?.employee ? `${selectedReview.employee.firstName} ${selectedReview.employee.lastName}` : ''}`}
        size="lg"
      >
        {selectedReview && (
          <div className="space-y-4">
            {/* Employee's Self Review */}
            <div className="bg-warm-50 p-4 rounded-lg">
              <h4 className="text-sm font-medium text-warm-900 mb-2">Employee Self Review</h4>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm text-warm-500">Self Rating:</span>
                {renderStars(selectedReview.selfRating)}
              </div>
              {selectedReview.selfComments && (
                <p className="text-sm text-warm-600 mt-2">{selectedReview.selfComments}</p>
              )}
            </div>

            {/* Goals */}
            {selectedReview.goals && selectedReview.goals.length > 0 && (
              <div className="bg-warm-50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-warm-900 mb-2">
                  Goals ({selectedReview.goals.length})
                </h4>
                <div className="space-y-2">
                  {selectedReview.goals.map((g) => (
                    <div key={g.id} className="flex items-center justify-between">
                      <span className="text-sm">{g.title}</span>
                      <span className="text-xs text-warm-500">{g.progress}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Manager Input */}
            <div className="border-t pt-4">
              {renderStarPicker(managerRating, setManagerRating, 'Manager Rating')}
            </div>

            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Comments</label>
              <textarea
                value={managerComments}
                onChange={(e) => setManagerComments(e.target.value)}
                rows={4}
                placeholder="Provide feedback on the employee's performance..."
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {renderStarPicker(overallRating, setOverallRating, 'Overall Rating')}
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setReviewModal(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmitManagerReview} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Manager Review'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* View Review Modal */}
      <Modal
        isOpen={viewModal}
        onClose={() => setViewModal(false)}
        title={`Review Details - ${viewReview?.employee ? `${viewReview.employee.firstName} ${viewReview.employee.lastName}` : ''}`}
        size="lg"
      >
        {viewReview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-warm-500">Cycle</p>
                <p className="text-sm font-medium">{viewReview.cycle?.name || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-warm-500">Status</p>
                <Badge variant={statusColors[viewReview.status] as 'gray' | 'warning' | 'info' | 'success'}>
                  {statusLabels[viewReview.status]}
                </Badge>
              </div>
            </div>
            {viewReview.selfRating && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-warm-900 mb-2">Self Review</h4>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-warm-500">Rating:</span>
                  {renderStars(viewReview.selfRating)}
                </div>
                {viewReview.selfComments && (
                  <p className="text-sm text-warm-600 bg-warm-50 p-3 rounded">{viewReview.selfComments}</p>
                )}
              </div>
            )}
            {viewReview.managerRating && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-warm-900 mb-2">Manager Review</h4>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-warm-500">Manager Rating:</span>
                  {renderStars(viewReview.managerRating)}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm text-warm-500">Overall Rating:</span>
                  {renderStars(viewReview.overallRating)}
                </div>
                {viewReview.managerComments && (
                  <p className="text-sm text-warm-600 bg-warm-50 p-3 rounded">{viewReview.managerComments}</p>
                )}
              </div>
            )}
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setViewModal(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
