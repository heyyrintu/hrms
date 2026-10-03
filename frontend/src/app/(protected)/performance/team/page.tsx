'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import {
  reviewsApi,
  type AnswerInput,
  type CycleQuestion,
  type ReviewView,
} from '@/lib/api-performance-reviews';
import { QuestionAnswersForm, answersComplete, cleanAnswers } from '@/components/performance/reviews/QuestionAnswersForm';
import { AnswersReadonly } from '@/components/performance/reviews/AnswersReadonly';
import {
  CompetencyRatingsForm,
  competenciesComplete,
  type CompetencyRatingValue,
} from '@/components/performance/reviews/CompetencyRatingsForm';
import { RatingButtons } from '@/components/performance/reviews/RatingButtons';
import { PeerApprovals } from '@/components/performance/peer/PeerApprovals';
import toast from 'react-hot-toast';
import { Users, RefreshCw, Star, Eye } from 'lucide-react';

type BadgeVariant = 'gray' | 'warning' | 'info' | 'success';

const statusColors: Record<string, BadgeVariant> = {
  PENDING: 'gray',
  SELF_REVIEW: 'warning',
  MANAGER_REVIEW: 'info',
  COMPLETED: 'success',
};

const statusLabels: Record<string, string> = {
  PENDING: 'Pending',
  SELF_REVIEW: 'Self Review',
  MANAGER_REVIEW: 'Manager Review',
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

function renderStarPicker(value: number, onChange: (v: number) => void, label: string) {
  return (
    <div>
      <label className="block text-sm font-medium text-warm-700 mb-2">{label} *</label>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} onClick={() => onChange(i)} className="p-1" aria-label={`${label} ${i}`}>
            <Star
              className={`h-8 w-8 transition-colors ${
                i <= value ? 'text-yellow-400 fill-yellow-400' : 'text-warm-300 hover:text-yellow-300'
              }`}
            />
          </button>
        ))}
        <span className="ml-2 text-sm text-warm-500">{value}/5</span>
      </div>
    </div>
  );
}

const fullName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : '-');

export default function TeamReviewsPage() {
  const [reviews, setReviews] = useState<ReviewView[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCycleId] = useState('');

  // Manager review modal
  const [reviewModal, setReviewModal] = useState(false);
  const [selectedReview, setSelectedReview] = useState<ReviewView | null>(null);
  const [questions, setQuestions] = useState<CycleQuestion[]>([]);
  const [managerRating, setManagerRating] = useState(3);
  const [managerComments, setManagerComments] = useState('');
  const [overallRating, setOverallRating] = useState(3);
  const [potential, setPotential] = useState<number | undefined>(undefined);
  const [answers, setAnswers] = useState<AnswerInput[]>([]);
  const [competencyValues, setCompetencyValues] = useState<CompetencyRatingValue[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // View modal
  const [viewModal, setViewModal] = useState(false);
  const [viewReview, setViewReview] = useState<ReviewView | null>(null);
  const [viewQuestions, setViewQuestions] = useState<CycleQuestion[]>([]);
  const [potentialDraft, setPotentialDraft] = useState<number | undefined>(undefined);
  const [savingPotential, setSavingPotential] = useState(false);

  const loadReviews = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: String(meta.limit) };
      if (filterStatus) params.status = filterStatus;
      if (filterCycleId) params.cycleId = filterCycleId;
      const res = await reviewsApi.teamReviews(params);
      setReviews(res.data.data);
      setMeta(res.data.meta as typeof meta);
    } catch {
      toast.error('Failed to load team reviews');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCycleId, meta.limit]);

  useEffect(() => {
    loadReviews(1);
  }, [loadReviews]);

  const openManagerReview = async (review: ReviewView) => {
    try {
      const [detail, qs] = await Promise.all([reviewsApi.get(review.id), reviewsApi.questions(review.id)]);
      setSelectedReview(detail.data);
      setQuestions(qs.data);
      setManagerRating(3);
      setManagerComments('');
      setOverallRating(3);
      setPotential(undefined);
      setAnswers([]);
      setCompetencyValues([]);
      setReviewModal(true);
    } catch {
      toast.error('Failed to load review details');
    }
  };

  const competencies = selectedReview?.competencyRatings ?? [];
  const formComplete =
    answersComplete(questions, 'MANAGER', answers) && competenciesComplete(competencies, competencyValues);

  const handleSubmitManagerReview = async () => {
    if (!selectedReview || !formComplete) return;
    setSubmitting(true);
    try {
      await reviewsApi.submitManager(selectedReview.id, {
        managerRating,
        managerComments: managerComments || undefined,
        overallRating,
        potentialRating: potential,
        answers: cleanAnswers(answers).length > 0 ? cleanAnswers(answers) : undefined,
        competencyRatings:
          competencies.length > 0
            ? competencyValues
                .filter((v) => typeof v.rating === 'number')
                .map((v) => ({
                  id: v.id,
                  rating: v.rating as number,
                  ...(v.comment?.trim() ? { comment: v.comment } : {}),
                }))
            : undefined,
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

  const openViewReview = async (review: ReviewView) => {
    try {
      const [detail, qs] = await Promise.all([reviewsApi.get(review.id), reviewsApi.questions(review.id)]);
      setViewReview(detail.data);
      setViewQuestions(qs.data);
      setPotentialDraft(detail.data.potentialRating ?? undefined);
      setViewModal(true);
    } catch {
      toast.error('Failed to load review details');
    }
  };

  const handleSavePotential = async () => {
    if (!viewReview || potentialDraft === undefined) return;
    setSavingPotential(true);
    try {
      const res = await reviewsApi.setPotential(viewReview.id, potentialDraft);
      setViewReview({ ...viewReview, potentialRating: res?.data?.potentialRating ?? potentialDraft });
      toast.success('Potential saved');
    } catch {
      toast.error('Failed to save potential');
    } finally {
      setSavingPotential(false);
    }
  };

  // The viewer is the reviewer (or an admin who is not the reviewee) and the cycle is still open.
  const isManagerView = !!viewReview && viewReview.relation !== 'SELF';
  const cycleActive = viewReview?.cycle.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <Users className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Team Reviews</h1>
            <p className="text-sm text-warm-500">Review your team members&apos; performance</p>
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
                        <p className="font-medium text-warm-900">{fullName(review.employee)}</p>
                        {review.employee?.department && (
                          <p className="text-xs text-warm-500">{review.employee.department.name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-warm-600">{review.employee?.designation?.name || '-'}</td>
                      <td className="px-4 py-3 text-warm-600">{review.cycle?.name || '-'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusColors[review.status] ?? 'gray'}>
                          {statusLabels[review.status] ?? review.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{renderStars(review.selfRating)}</td>
                      <td className="px-4 py-3">{renderStars(review.overallRating)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {review.status === 'SELF_REVIEW' && review.relation !== 'SELF' && review.cycle.status === 'ACTIVE' && (
                            <Button variant="primary" onClick={() => openManagerReview(review)}>
                              Review
                            </Button>
                          )}
                          {review.status !== 'PENDING' && (
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
        title={`Manager Review - ${fullName(selectedReview?.employee)}`}
        size="lg"
      >
        {selectedReview && (
          <div className="space-y-4">
            {/* Employee's Self Review */}
            <div className="bg-warm-50 p-4 rounded-lg space-y-2">
              <h4 className="text-sm font-medium text-warm-900">Employee Self Review</h4>
              <div className="flex items-center gap-2">
                <span className="text-sm text-warm-500">Self Rating:</span>
                {renderStars(selectedReview.selfRating)}
              </div>
              {selectedReview.selfComments && (
                <p className="text-sm text-warm-600">{selectedReview.selfComments}</p>
              )}
              {selectedReview.answers && (
                <AnswersReadonly questions={questions} answers={selectedReview.answers} audience="SELF" />
              )}
            </div>

            {/* Goals */}
            {selectedReview.goals && selectedReview.goals.length > 0 && (
              <div className="bg-warm-50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-warm-900 mb-2">Goals ({selectedReview.goals.length})</h4>
                <div className="space-y-2">
                  {(selectedReview.goals as Array<{ id: string; title: string; progress: number }>).map((g) => (
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

            <QuestionAnswersForm
              questions={questions}
              audience="MANAGER"
              value={answers}
              onChange={(a) => setAnswers(a)}
              disabled={submitting}
            />

            {competencies.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-warm-900 mb-2">Competencies *</h4>
                <CompetencyRatingsForm
                  competencies={competencies}
                  value={competencyValues}
                  onChange={setCompetencyValues}
                  disabled={submitting}
                />
              </div>
            )}

            <div>
              <label htmlFor="manager-comments" className="block text-sm font-medium text-warm-700 mb-1">Comments</label>
              <textarea
                id="manager-comments"
                value={managerComments}
                onChange={(e) => setManagerComments(e.target.value)}
                rows={4}
                placeholder="Provide feedback on the employee's performance..."
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            {renderStarPicker(overallRating, setOverallRating, 'Overall Rating')}

            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Potential (optional)</label>
              <RatingButtons label="Potential" value={potential} onChange={setPotential} max={3} disabled={submitting} />
              <p className="text-xs text-warm-500 mt-1">1 = low, 2 = medium, 3 = high</p>
            </div>

            {!formComplete && (
              <p className="text-xs text-amber-600">
                Answer all required questions (*) and rate every competency to submit.
              </p>
            )}
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setReviewModal(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmitManagerReview} disabled={submitting || !formComplete}>
            {submitting ? 'Submitting...' : 'Submit Manager Review'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* View Review Modal */}
      <Modal
        isOpen={viewModal}
        onClose={() => setViewModal(false)}
        title={`Review Details - ${fullName(viewReview?.employee)}`}
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
                <Badge variant={statusColors[viewReview.status] ?? 'gray'}>
                  {statusLabels[viewReview.status] ?? viewReview.status}
                </Badge>
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

            {viewReview.managerRating && (
              <div className="border-t pt-4 space-y-2">
                <h4 className="text-sm font-medium text-warm-900">Manager Review</h4>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-warm-500">Manager Rating:</span>
                  {renderStars(viewReview.managerRating)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-warm-500">Overall Rating:</span>
                  {renderStars(viewReview.overallRating)}
                </div>
                {viewReview.managerComments && (
                  <p className="text-sm text-warm-600 bg-warm-50 p-3 rounded">{viewReview.managerComments}</p>
                )}
                {viewReview.answers && (
                  <AnswersReadonly questions={viewQuestions} answers={viewReview.answers} audience="MANAGER" />
                )}
                {viewReview.competencyRatings && viewReview.competencyRatings.length > 0 && (
                  <div className="space-y-1">
                    {viewReview.competencyRatings.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-sm bg-warm-50 p-2 rounded">
                        <span>{c.name}</span>
                        <span className="text-warm-600">
                          {c.managerRating ?? '-'} / 5 (expected {c.expectedLevel})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {typeof viewReview.calibratedRating === 'number' && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-warm-900 mb-1">Calibration</h4>
                <p className="text-sm text-warm-700">
                  {`Calibrated from ${viewReview.overallRating ?? '-'} to ${viewReview.calibratedRating}: ${viewReview.calibrationReason ?? ''}`}
                </p>
              </div>
            )}

            {isManagerView && (
              <div className="border-t pt-4 space-y-2">
                <h4 className="text-sm font-medium text-warm-900">Potential</h4>
                {cycleActive ? (
                  <div className="flex items-center gap-3">
                    <RatingButtons label="Potential" value={potentialDraft} onChange={setPotentialDraft} max={3} />
                    <Button
                      variant="secondary"
                      onClick={handleSavePotential}
                      disabled={savingPotential || potentialDraft === undefined}
                    >
                      Save potential
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-warm-700">
                    {typeof viewReview.potentialRating === 'number'
                      ? `Potential: ${viewReview.potentialRating} / 3`
                      : 'Potential not set'}
                  </p>
                )}
              </div>
            )}

            {isManagerView && viewReview.cycle.peerFeedbackEnabled && (
              <div className="border-t pt-4">
                <PeerApprovals
                  reviewId={viewReview.id}
                  employeeId={viewReview.employeeId}
                  reviewerId={viewReview.reviewerId}
                  maxPeers={viewReview.cycle.maxPeers}
                  canEdit={cycleActive}
                  questions={viewQuestions}
                />
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
