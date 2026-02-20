'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { performanceApi } from '@/lib/api';
import { PerformanceReview, Goal, PerformanceReviewStatus, GoalStatus } from '@/types';
import toast from 'react-hot-toast';
import {
  Star,
  Target,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Eye,
} from 'lucide-react';

const reviewStatusColors: Record<PerformanceReviewStatus, string> = {
  PENDING: 'gray',
  SELF_REVIEW: 'warning',
  MANAGER_REVIEW: 'info',
  COMPLETED: 'success',
};

const reviewStatusLabels: Record<PerformanceReviewStatus, string> = {
  PENDING: 'Pending',
  SELF_REVIEW: 'Self Review',
  MANAGER_REVIEW: 'Manager Review',
  COMPLETED: 'Completed',
};

const goalStatusColors: Record<GoalStatus, string> = {
  NOT_STARTED: 'gray',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
};

const goalStatusLabels: Record<GoalStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
};

export default function PerformancePage() {
  const [activeTab, setActiveTab] = useState<'reviews' | 'goals'>('reviews');

  // Reviews state
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);

  // Goals state
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(true);

  // Self-review modal
  const [selfReviewModal, setSelfReviewModal] = useState(false);
  const [selectedReview, setSelectedReview] = useState<PerformanceReview | null>(null);
  const [selfRating, setSelfRating] = useState(3);
  const [selfComments, setSelfComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // View review modal
  const [viewModal, setViewModal] = useState(false);
  const [viewReview, setViewReview] = useState<PerformanceReview | null>(null);

  // Goal modal
  const [goalModal, setGoalModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [goalForm, setGoalForm] = useState({
    reviewId: '',
    title: '',
    description: '',
    targetDate: '',
    status: 'NOT_STARTED' as GoalStatus,
    progress: 0,
    weight: 1.0,
  });
  const [savingGoal, setSavingGoal] = useState(false);

  // Delete goal
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true);
    try {
      const res = await performanceApi.getMyReviews();
      setReviews(res.data.data);
    } catch {
      toast.error('Failed to load reviews');
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  const loadGoals = useCallback(async () => {
    setGoalsLoading(true);
    try {
      const res = await performanceApi.getMyGoals();
      setGoals(res.data);
    } catch {
      toast.error('Failed to load goals');
    } finally {
      setGoalsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReviews();
    loadGoals();
  }, [loadReviews, loadGoals]);

  // Self Review
  const openSelfReview = (review: PerformanceReview) => {
    setSelectedReview(review);
    setSelfRating(3);
    setSelfComments('');
    setSelfReviewModal(true);
  };

  const handleSubmitSelfReview = async () => {
    if (!selectedReview) return;
    setSubmitting(true);
    try {
      await performanceApi.submitSelfReview(selectedReview.id, {
        selfRating,
        selfComments: selfComments || undefined,
      });
      toast.success('Self-review submitted successfully');
      setSelfReviewModal(false);
      loadReviews();
    } catch {
      toast.error('Failed to submit self-review');
    } finally {
      setSubmitting(false);
    }
  };

  // View Review Detail
  const openViewReview = async (review: PerformanceReview) => {
    try {
      const res = await performanceApi.getReview(review.id);
      setViewReview(res.data);
      setViewModal(true);
    } catch {
      toast.error('Failed to load review details');
    }
  };

  // Goal CRUD
  const openGoalModal = (goal?: Goal) => {
    if (goal) {
      setEditingGoal(goal);
      setGoalForm({
        reviewId: goal.reviewId,
        title: goal.title,
        description: goal.description || '',
        targetDate: goal.targetDate.split('T')[0],
        status: goal.status,
        progress: goal.progress,
        weight: goal.weight,
      });
    } else {
      setEditingGoal(null);
      setGoalForm({
        reviewId: reviews.length > 0 ? reviews[0].id : '',
        title: '',
        description: '',
        targetDate: '',
        status: 'NOT_STARTED',
        progress: 0,
        weight: 1.0,
      });
    }
    setGoalModal(true);
  };

  const handleSaveGoal = async () => {
    setSavingGoal(true);
    try {
      if (editingGoal) {
        await performanceApi.updateGoal(editingGoal.id, {
          title: goalForm.title,
          description: goalForm.description || undefined,
          targetDate: goalForm.targetDate,
          status: goalForm.status,
          progress: goalForm.progress,
          weight: goalForm.weight,
        });
        toast.success('Goal updated');
      } else {
        await performanceApi.createGoal({
          reviewId: goalForm.reviewId,
          title: goalForm.title,
          description: goalForm.description || undefined,
          targetDate: goalForm.targetDate,
          weight: goalForm.weight,
        });
        toast.success('Goal created');
      }
      setGoalModal(false);
      loadGoals();
    } catch {
      toast.error('Failed to save goal');
    } finally {
      setSavingGoal(false);
    }
  };

  const handleDeleteGoal = async () => {
    if (!deletingGoal) return;
    try {
      await performanceApi.deleteGoal(deletingGoal.id);
      toast.success('Goal deleted');
      setDeleteModal(false);
      setDeletingGoal(null);
      loadGoals();
    } catch {
      toast.error('Failed to delete goal');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <Target className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900">My Performance</h1>
            <p className="text-sm text-warm-500">
              Track your reviews and goals
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={() => { loadReviews(); loadGoals(); }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="border-b border-warm-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('reviews')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'reviews'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-warm-500 hover:text-warm-700'
            }`}
          >
            My Reviews
          </button>
          <button
            onClick={() => setActiveTab('goals')}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'goals'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-warm-500 hover:text-warm-700'
            }`}
          >
            My Goals
          </button>
        </nav>
      </div>

      {/* Reviews Tab */}
      {activeTab === 'reviews' && (
        <Card>
          <CardContent className="p-0">
            {reviewsLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
              </div>
            ) : reviews.length === 0 ? (
              <div className="text-center py-12 text-warm-500">
                <Star className="h-12 w-12 mx-auto mb-3 text-warm-300" />
                <p className="text-lg font-medium">No reviews yet</p>
                <p className="text-sm">Reviews will appear here when a cycle is launched</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-warm-50">
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Cycle</th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Reviewer</th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Self Rating</th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Manager Rating</th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Overall</th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviews.map((review) => (
                      <tr key={review.id} className="border-b hover:bg-warm-50">
                        <td className="px-4 py-3 font-medium text-warm-900">
                          {review.cycle?.name || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={reviewStatusColors[review.status] as 'gray' | 'warning' | 'info' | 'success'}>
                            {reviewStatusLabels[review.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-warm-600">
                          {review.reviewer ? `${review.reviewer.firstName} ${review.reviewer.lastName}` : '-'}
                        </td>
                        <td className="px-4 py-3">{renderStars(review.selfRating)}</td>
                        <td className="px-4 py-3">{renderStars(review.managerRating)}</td>
                        <td className="px-4 py-3">{renderStars(review.overallRating)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {review.status === 'PENDING' && (
                              <Button variant="primary" onClick={() => openSelfReview(review)}>
                                Submit Self Review
                              </Button>
                            )}
                            {(review.status === 'COMPLETED' || review.status === 'SELF_REVIEW' || review.status === 'MANAGER_REVIEW') && (
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
      )}

      {/* Goals Tab */}
      {activeTab === 'goals' && (
        <>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => openGoalModal()} disabled={reviews.length === 0}>
              <Plus className="h-4 w-4 mr-2" />
              Add Goal
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {goalsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
                </div>
              ) : goals.length === 0 ? (
                <div className="text-center py-12 text-warm-500">
                  <Target className="h-12 w-12 mx-auto mb-3 text-warm-300" />
                  <p className="text-lg font-medium">No goals yet</p>
                  <p className="text-sm">Add goals to track your performance objectives</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-warm-50">
                        <th className="text-left px-4 py-3 font-medium text-warm-600">Title</th>
                        <th className="text-left px-4 py-3 font-medium text-warm-600">Cycle</th>
                        <th className="text-left px-4 py-3 font-medium text-warm-600">Target Date</th>
                        <th className="text-left px-4 py-3 font-medium text-warm-600">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-warm-600">Progress</th>
                        <th className="text-left px-4 py-3 font-medium text-warm-600">Weight</th>
                        <th className="text-left px-4 py-3 font-medium text-warm-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goals.map((goal) => (
                        <tr key={goal.id} className="border-b hover:bg-warm-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-warm-900">{goal.title}</p>
                            {goal.description && (
                              <p className="text-xs text-warm-500 mt-0.5">{goal.description}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-warm-600">
                            {goal.review?.cycle?.name || '-'}
                          </td>
                          <td className="px-4 py-3 text-warm-600">
                            {new Date(goal.targetDate).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={goalStatusColors[goal.status] as 'gray' | 'warning' | 'success'}>
                              {goalStatusLabels[goal.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-warm-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full transition-all ${goal.progress === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
                                  style={{ width: `${goal.progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-warm-500">{goal.progress}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-warm-600">{goal.weight}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => openGoalModal(goal)}
                                className="text-warm-500 hover:text-warm-700"
                                title="Edit"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              {goal.review?.status !== 'COMPLETED' && (
                                <button
                                  onClick={() => { setDeletingGoal(goal); setDeleteModal(true); }}
                                  className="text-red-500 hover:text-red-700"
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
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
        </>
      )}

      {/* Self Review Modal */}
      <Modal
        isOpen={selfReviewModal}
        onClose={() => setSelfReviewModal(false)}
        title={`Self Review - ${selectedReview?.cycle?.name || ''}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-2">
              Self Rating *
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  onClick={() => setSelfRating(i)}
                  className="p-1"
                >
                  <Star
                    className={`h-8 w-8 transition-colors ${
                      i <= selfRating
                        ? 'text-yellow-400 fill-yellow-400'
                        : 'text-warm-300 hover:text-yellow-300'
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm text-warm-500">{selfRating}/5</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Comments
            </label>
            <textarea
              value={selfComments}
              onChange={(e) => setSelfComments(e.target.value)}
              rows={4}
              placeholder="Describe your achievements, challenges, and areas of growth..."
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setSelfReviewModal(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmitSelfReview} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Self Review'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* View Review Modal */}
      <Modal
        isOpen={viewModal}
        onClose={() => setViewModal(false)}
        title={`Review Details - ${viewReview?.cycle?.name || ''}`}
        size="lg"
      >
        {viewReview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-warm-500">Status</p>
                <Badge variant={reviewStatusColors[viewReview.status] as 'gray' | 'warning' | 'info' | 'success'}>
                  {reviewStatusLabels[viewReview.status]}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-warm-500">Reviewer</p>
                <p className="text-sm font-medium">
                  {viewReview.reviewer ? `${viewReview.reviewer.firstName} ${viewReview.reviewer.lastName}` : '-'}
                </p>
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
            {viewReview.goals && viewReview.goals.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-warm-900 mb-2">Goals ({viewReview.goals.length})</h4>
                <div className="space-y-2">
                  {viewReview.goals.map((g) => (
                    <div key={g.id} className="flex items-center justify-between bg-warm-50 p-2 rounded">
                      <span className="text-sm">{g.title}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-warm-500">{g.progress}%</span>
                        <Badge variant={goalStatusColors[g.status] as 'gray' | 'warning' | 'success'}>
                          {goalStatusLabels[g.status]}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
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

      {/* Goal Modal */}
      <Modal
        isOpen={goalModal}
        onClose={() => setGoalModal(false)}
        title={editingGoal ? 'Edit Goal' : 'Add Goal'}
      >
        <div className="space-y-4">
          {!editingGoal && (
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Review Cycle *</label>
              <select
                value={goalForm.reviewId}
                onChange={(e) => setGoalForm({ ...goalForm, reviewId: e.target.value })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select review...</option>
                {reviews
                  .filter((r) => r.status !== 'COMPLETED')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.cycle?.name || r.id}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Title *</label>
            <input
              type="text"
              value={goalForm.title}
              onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
              placeholder="e.g. Complete AWS certification"
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Description</label>
            <textarea
              value={goalForm.description}
              onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Target Date *</label>
              <input
                type="date"
                value={goalForm.targetDate}
                onChange={(e) => setGoalForm({ ...goalForm, targetDate: e.target.value })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Weight (0-1)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={goalForm.weight}
                onChange={(e) => setGoalForm({ ...goalForm, weight: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          {editingGoal && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">Status</label>
                <select
                  value={goalForm.status}
                  onChange={(e) => setGoalForm({ ...goalForm, status: e.target.value as GoalStatus })}
                  className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="NOT_STARTED">Not Started</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1">
                  Progress ({goalForm.progress}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={goalForm.progress}
                  onChange={(e) => setGoalForm({ ...goalForm, progress: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setGoalModal(false)} disabled={savingGoal}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSaveGoal}
            disabled={savingGoal || !goalForm.title || !goalForm.targetDate || (!editingGoal && !goalForm.reviewId)}
          >
            {savingGoal ? 'Saving...' : editingGoal ? 'Update Goal' : 'Create Goal'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Goal Modal */}
      <Modal
        isOpen={deleteModal}
        onClose={() => setDeleteModal(false)}
        title="Delete Goal"
      >
        <p className="text-sm text-warm-600">
          Are you sure you want to delete &quot;{deletingGoal?.title}&quot;? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteGoal}>
            Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
