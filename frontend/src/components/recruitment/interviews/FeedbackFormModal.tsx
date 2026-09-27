'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  recruitmentApi,
  type FeedbackPayload,
  type Interview,
  type InterviewFeedback,
  type InterviewRecommendation,
} from '@/lib/api-recruitment';
import { RECOMMENDATION_LABELS, apiErrorMessage } from '../offers/offerFormat';

export const MAX_SCORE_ROWS = 20;
const DEFAULT_CRITERIA = ['Technical skills', 'Problem solving', 'Communication', 'Culture fit'];

interface Row {
  criterion: string;
  rating: string;
  comment: string;
}

function initialRows(existing?: InterviewFeedback | null): Row[] {
  return existing && existing.scores.length
    ? existing.scores.map((s) => ({ criterion: s.criterion, rating: String(s.rating), comment: s.comment ?? '' }))
    : DEFAULT_CRITERIA.map((c) => ({ criterion: c, rating: '3', comment: '' }));
}

const RATINGS = ['1', '2', '3', '4', '5'].map((r) => ({ value: r, label: r }));

interface Props {
  isOpen: boolean;
  onClose: () => void;
  interview: Interview;
  /** The viewer's earlier submission, to update it. */
  existing?: InterviewFeedback | null;
  onSaved: (feedback: InterviewFeedback) => void;
}

/** A panelist's scorecard: overall rating, recommendation and criterion rows. */
export function FeedbackFormModal({ isOpen, onClose, interview, existing, onSaved }: Props) {
  const [overallRating, setOverallRating] = useState(() => (existing ? String(existing.overallRating) : '3'));
  const [recommendation, setRecommendation] = useState<InterviewRecommendation>(
    () => existing?.recommendation ?? 'HIRE',
  );
  const [rows, setRows] = useState<Row[]>(() => initialRows(existing));
  const [strengths, setStrengths] = useState(() => existing?.strengths ?? '');
  const [concerns, setConcerns] = useState(() => existing?.concerns ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setOverallRating(existing ? String(existing.overallRating) : '3');
    setRecommendation(existing?.recommendation ?? 'HIRE');
    setRows(initialRows(existing));
    setStrengths(existing?.strengths ?? '');
    setConcerns(existing?.concerns ?? '');
  }, [isOpen, existing]);

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const scores = rows
      .filter((r) => r.criterion.trim())
      .map((r) => ({ criterion: r.criterion.trim(), rating: Number(r.rating), comment: r.comment.trim() || null }));
    const payload: FeedbackPayload = {
      overallRating: Number(overallRating),
      recommendation,
      scores,
      strengths: strengths.trim() || null,
      concerns: concerns.trim() || null,
    };
    setSaving(true);
    try {
      const res = await recruitmentApi.submitFeedback(interview.id, payload);
      toast.success(existing ? 'Feedback updated' : 'Feedback submitted');
      onSaved(res.data);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to submit feedback'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Scorecard · ${interview.candidate.firstName} ${interview.candidate.lastName} · ${interview.roundName}`}
      size="2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            id="feedback-overall"
            label="Overall rating (1–5)"
            options={RATINGS}
            value={overallRating}
            onChange={(e) => setOverallRating(e.target.value)}
          />
          <Select
            id="feedback-recommendation"
            label="Recommendation"
            options={(Object.keys(RECOMMENDATION_LABELS) as InterviewRecommendation[]).map((r) => ({
              value: r,
              label: RECOMMENDATION_LABELS[r],
            }))}
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value as InterviewRecommendation)}
          />
        </div>

        <div className="space-y-2">
          <p className="label">Scorecard</p>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2" data-testid="score-row">
              <div className="col-span-5">
                <Input
                  aria-label={`Criterion ${i + 1}`}
                  value={row.criterion}
                  maxLength={100}
                  onChange={(e) => updateRow(i, { criterion: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <select
                  aria-label={`Rating ${i + 1}`}
                  className="input"
                  value={row.rating}
                  onChange={(e) => updateRow(i, { rating: e.target.value })}
                >
                  {RATINGS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-4">
                <Input
                  aria-label={`Comment ${i + 1}`}
                  placeholder="Comment"
                  value={row.comment}
                  maxLength={1000}
                  onChange={(e) => updateRow(i, { comment: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove criterion ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                >
                  ×
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={rows.length >= MAX_SCORE_ROWS}
            onClick={() => setRows((rs) => [...rs, { criterion: '', rating: '3', comment: '' }])}
          >
            Add criterion
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="feedback-strengths" className="label">
              Strengths
            </label>
            <textarea
              id="feedback-strengths"
              className="input min-h-[80px]"
              maxLength={5000}
              value={strengths}
              onChange={(e) => setStrengths(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="feedback-concerns" className="label">
              Concerns
            </label>
            <textarea
              id="feedback-concerns"
              className="input min-h-[80px]"
              maxLength={5000}
              value={concerns}
              onChange={(e) => setConcerns(e.target.value)}
            />
          </div>
        </div>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {existing ? 'Update feedback' : 'Submit feedback'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
