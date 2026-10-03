'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { currentEmployeeId } from '@/lib/current-employee';
import {
  reviewsApi,
  type AnswerInput,
  type CycleQuestion,
  type ReviewView,
} from '@/lib/api-performance-reviews';
import { goalsApi, type Goal } from '@/lib/api-performance-goals';
import { QuestionAnswersForm, answersComplete } from '@/components/performance/reviews/QuestionAnswersForm';
import { AnswersReadonly } from '@/components/performance/reviews/AnswersReadonly';
import { ReleasedResults } from '@/components/performance/reviews/ReleasedResults';
import { PeerNominations } from '@/components/performance/peer/PeerNominations';
import toast from 'react-hot-toast';
import { Star, Target, RefreshCw, Eye } from 'lucide-react';

type BadgeVariant = 'gray' | 'warning' | 'info' | 'success';

const reviewStatusColors: Record<string, BadgeVariant> = {
  PENDING: 'gray',
  SELF_REVIEW: 'warning',
  MANAGER_REVIEW: 'info',
  COMPLETED: 'success',
};

const reviewStatusLabels: Record<string, string> = {
  PENDING: 'Pending',
  SELF_REVIEW: 'Self Review',
  MANAGER_REVIEW: 'Manager Review',
  COMPLETED: 'Completed',
};

const goalStatusColors: Record<string, BadgeVariant> = {
  NOT_STARTED: 'gray',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
};

const goalStatusLabels: Record<string, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
};

function renderStars(rating?: number | null) {
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
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-warm-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${value === 100 ? 'bg-emerald-500' : 'bg-primary-500'}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-xs text-warm-500">{value}%</span>
    </div>
  );
}

export default function PerformancePage() {
  const { user } = useAuth();
  const myEmployeeId = currentEmployeeId(user);
  const [activeTab, setActiveTab] = useState<'reviews' | 'goals'>('reviews');

  const [reviews, setReviews] = useState<ReviewView[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(true);

  // Self-review modal
  const [selfReviewModal, setSelfReviewModal] = useState(false);
  const [selectedReview, setSelectedReview] = useState<ReviewView | null>(null);
  const [selfQuestions, setSelfQuestions] = useState<CycleQuestion[]>([]);
  const [selfAnswers, setSelfAnswers] = useState<AnswerInput[]>([]);
  const [selfRating, setSelfRating] = useState(3);
  const [selfComments, setSelfComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // View modal
  const [viewModal, setViewModal] = useState(false);
  const [viewReview, setViewReview] = useState<ReviewView | null>(null);
  const [viewQuestions, setViewQuestions] = useState<CycleQuestion[]>([]);

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true);
    try {
      const res = await reviewsApi.myReviews();
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
      const res = await goalsApi.list({ scope: 'mine' });
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

  const openSelfReview = async (review: ReviewView) => {
    try {
      const [detail, qs] = await Promise.all([reviewsApi.get(review.id), reviewsApi.questions(review.id)]);
      setSelectedReview(detail.data);
      setSelfQuestions(qs.data);
      setSelfAnswers([]);
      setSelfRating(3);
      setSelfComments('');
      setSelfReviewModal(true);
    } catch {
      toast.error('Failed to load review');
    }
  };

  const selfComplete = answersComplete(selfQuestions, 'SELF', selfAnswers);

  const handleSubmitSelfReview = async () => {
    if (!selectedReview || !selfComplete) return;
    setSubmitting(true);
    try {
      await reviewsApi.submitSelf(selectedReview.id, {
        selfRating,
        selfComments: selfComments || undefined,
        answers: selfAnswers.length > 0 ? selfAnswers : undefined,
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

  const openViewReview = async (review: ReviewView) => {
    try {
      const [detail, qs] = await Promise.all([reviewsApi.get(review.id), reviewsApi.questions(review.id)]);
      setViewReview(detail.data);
      setViewQuestions(qs.data);
      setViewModal(true);
    } catch {
      toast.error('Failed to load review details');
    }
  };

  const viewGoals = (viewReview?.goals ?? []) as Array<{ id: string; title: string; progress: number; status: string }>;
  const viewIsOwn =
    !!viewReview && (viewReview.relation === 'SELF' || (!!myEmployeeId && viewReview.employeeId === myEmployeeId));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <Target className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900">My Performance</h1>
            <p className="text-sm text-warm-500">Track your reviews and goals</p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => { loadReviews(); loadGoals(); }}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="border-b border-warm-200">
        <nav className="flex gap-4">
          {(['reviews', 'goals'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-warm-500 hover:text-warm-700'
              }`}
            >
              {tab === 'reviews' ? 'My Reviews' : 'My Goals'}
            </button>
          ))}
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
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Final Rating</th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviews.map((review) => (
                      <tr key={review.id} className="border-b hover:bg-warm-50">
                        <td className="px-4 py-3 font-medium text-warm-900">{review.cycle?.name || '-'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={reviewStatusColors[review.status] ?? 'gray'}>
                            {reviewStatusLabels[review.status] ?? review.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-warm-600">
                          {review.reviewer ? `${review.reviewer.firstName} ${review.reviewer.lastName}` : '-'}
                        </td>
                        <td className="px-4 py-3">{renderStars(review.selfRating)}</td>
                        <td className="px-4 py-3">
                          {review.released ? (
                            renderStars(review.finalRating)
                          ) : (
                            <span className="text-xs text-warm-400">Awaiting release</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {review.status === 'PENDING' && !review.released && (
                              <Button variant="primary" onClick={() => openSelfReview(review)}>
                                Submit Self Review
                              </Button>
                            )}
                            {(review.status !== 'PENDING' || review.cycle?.peerFeedbackEnabled) && (
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
            <Link
              href="/performance/goals"
              className="inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              Manage goals
            </Link>
          </div>
          <Card>
            <CardContent className="p-4">
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
                <div className="space-y-4">
                  {goals.map((goal) => (
                    <div key={goal.id} className="border border-warm-200 rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-warm-900">{goal.title}</p>
                          {goal.description && <p className="text-xs text-warm-500 mt-0.5">{goal.description}</p>}
                        </div>
                        <div className="flex items-center gap-3">
                          <ProgressBar value={goal.progress} />
                          <Badge variant={goalStatusColors[goal.status] ?? 'gray'}>
                            {goalStatusLabels[goal.status] ?? goal.status}
                          </Badge>
                        </div>
                      </div>
                      {goal.keyResults.length > 0 && (
                        <ul className="space-y-1 pl-3 border-l-2 border-warm-100">
                          {goal.keyResults.map((kr) => (
                            <li key={kr.id} className="flex items-center justify-between gap-3 text-sm">
                              <span className="text-warm-700">{kr.title}</span>
                              <span className="flex items-center gap-3">
                                <span className="text-xs text-warm-500">{kr.currentValue} / {kr.targetValue}</span>
                                <ProgressBar value={kr.progress} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
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
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-2">Self Rating *</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} onClick={() => setSelfRating(i)} className="p-1" aria-label={`Self rating ${i}`}>
                  <Star
                    className={`h-8 w-8 transition-colors ${
                      i <= selfRating ? 'text-yellow-400 fill-yellow-400' : 'text-warm-300 hover:text-yellow-300'
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm text-warm-500">{selfRating}/5</span>
            </div>
          </div>
          <QuestionAnswersForm
            questions={selfQuestions}
            audience="SELF"
            value={selfAnswers}
            onChange={(answers) => setSelfAnswers(answers)}
            disabled={submitting}
          />
          <div>
            <label htmlFor="self-comments" className="block text-sm font-medium text-warm-700 mb-1">Comments</label>
            <textarea
              id="self-comments"
              value={selfComments}
              onChange={(e) => setSelfComments(e.target.value)}
              rows={4}
              placeholder="Describe your achievements, challenges, and areas of growth..."
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          {!selfComplete && (
            <p className="text-xs text-amber-600">Answer all required questions (*) to submit.</p>
          )}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setSelfReviewModal(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmitSelfReview} disabled={submitting || !selfComplete}>
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
                <Badge variant={reviewStatusColors[viewReview.status] ?? 'gray'}>
                  {reviewStatusLabels[viewReview.status] ?? viewReview.status}
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
              <div className="border-t pt-4 space-y-2">
                <h4 className="text-sm font-medium text-warm-900">Self Review</h4>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-warm-500">Rating:</span>
                  {renderStars(viewReview.selfRating)}
                </div>
                {viewReview.selfComments && (
                  <p className="text-sm text-warm-600 bg-warm-50 p-3 rounded">{viewReview.selfComments}</p>
                )}
                {viewReview.answers && (
                  <AnswersReadonly questions={viewQuestions} answers={viewReview.answers} audience="SELF" />
                )}
              </div>
            )}

            {viewReview.cycle.peerFeedbackEnabled && viewIsOwn && (
              <div className="border-t pt-4">
                <PeerNominations
                  reviewId={viewReview.id}
                  employeeId={viewReview.employeeId}
                  reviewerId={viewReview.reviewerId}
                  maxPeers={viewReview.cycle.maxPeers}
                  canEdit={viewReview.cycle.status === 'ACTIVE'}
                />
              </div>
            )}

            <div className="border-t pt-4">
              {viewReview.released ? (
                <ReleasedResults review={viewReview} questions={viewQuestions} />
              ) : (
                <p className="text-sm text-warm-500">Submitted — awaiting release</p>
              )}
            </div>

            {viewGoals.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-warm-900 mb-2">Goals ({viewGoals.length})</h4>
                <div className="space-y-2">
                  {viewGoals.map((g) => (
                    <div key={g.id} className="flex items-center justify-between bg-warm-50 p-2 rounded">
                      <span className="text-sm">{g.title}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-warm-500">{g.progress}%</span>
                        <Badge variant={goalStatusColors[g.status] ?? 'gray'}>
                          {goalStatusLabels[g.status] ?? g.status}
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
    </div>
  );
}
