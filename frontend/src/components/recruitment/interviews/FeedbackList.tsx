'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { recruitmentApi, type InterviewFeedbackList } from '@/lib/api-recruitment';
import { RECOMMENDATION_LABELS, RECOMMENDATION_VARIANTS, formatDateTime } from '../offers/offerFormat';

interface Props {
  interviewId: string;
  /** Bump to reload (e.g. after the viewer submitted). */
  reloadKey?: number;
}

/**
 * Feedback on one interview, as the server allows the viewer to see it: a
 * panelist who has not submitted yet gets `visible: false` and no items.
 */
export function FeedbackList({ interviewId, reloadKey = 0 }: Props) {
  const [data, setData] = useState<InterviewFeedbackList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await recruitmentApi.getFeedback(interviewId);
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [interviewId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (loading) return <p className="text-sm text-warm-500">Loading feedback…</p>;
  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-600">
        Could not load feedback.
        <Button size="sm" variant="secondary" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }
  if (!data?.visible) {
    return (
      <p className="text-sm text-warm-500">
        Submit your own scorecard to see the rest of the panel&apos;s feedback.
      </p>
    );
  }
  if (data.items.length === 0) return <p className="text-sm text-warm-500">No feedback yet.</p>;

  return (
    <ul className="space-y-3">
      {data.items.map((fb) => (
        <li key={fb.id} className="rounded-lg border border-warm-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-warm-900">
              {fb.interviewer.firstName} {fb.interviewer.lastName}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{fb.overallRating}/5</span>
              <Badge variant={RECOMMENDATION_VARIANTS[fb.recommendation]}>
                {RECOMMENDATION_LABELS[fb.recommendation]}
              </Badge>
            </div>
          </div>
          {fb.scores.length > 0 && (
            <table className="mt-2 w-full text-left">
              <tbody>
                {fb.scores.map((s, i) => (
                  <tr key={i} className="border-t border-warm-100">
                    <td className="py-1 pr-2 text-warm-700">{s.criterion}</td>
                    <td className="py-1 pr-2 font-medium">{s.rating}/5</td>
                    <td className="py-1 text-warm-500">{s.comment ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {fb.strengths && (
            <p className="mt-2 whitespace-pre-wrap text-warm-700">
              <span className="font-medium">Strengths: </span>
              {fb.strengths}
            </p>
          )}
          {fb.concerns && (
            <p className="mt-1 whitespace-pre-wrap text-warm-700">
              <span className="font-medium">Concerns: </span>
              {fb.concerns}
            </p>
          )}
          <p className="mt-1 text-xs text-warm-400">{formatDateTime(fb.submittedAt)}</p>
        </li>
      ))}
    </ul>
  );
}
