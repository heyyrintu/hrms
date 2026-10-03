'use client';

import type { CycleQuestion, ReviewView } from '@/lib/api-performance-reviews';
import { AnswersReadonly } from './AnswersReadonly';

interface ReleasedResultsProps {
  review: ReviewView;
  questions: CycleQuestion[];
}

/**
 * Results the employee sees after the cycle closes. Renders no rating at all
 * unless `review.released` is true, whatever else the response carries.
 */
export function ReleasedResults({ review, questions }: ReleasedResultsProps) {
  if (!review.released) {
    return (
      <p className="text-sm text-warm-500" data-testid="results-pending">
        Results are released when the cycle closes
      </p>
    );
  }

  const peer = review.peerFeedback;
  const showPeerSection = !!peer || !!review.peerFeedbackHiddenReason || review.cycle.peerFeedbackEnabled;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-warm-500">Final rating</p>
        <p className="text-2xl font-bold text-warm-900" data-testid="final-rating">
          {typeof review.finalRating === 'number' ? `${review.finalRating} / 5` : '-'}
        </p>
      </div>

      {review.managerComments && (
        <div>
          <h4 className="text-sm font-medium text-warm-900 mb-1">Manager comments</h4>
          <p className="text-sm text-warm-600 bg-warm-50 p-3 rounded whitespace-pre-wrap">{review.managerComments}</p>
        </div>
      )}

      {review.answers && (
        <AnswersReadonly questions={questions} answers={review.answers} audience="MANAGER" />
      )}

      {review.competencyRatings && review.competencyRatings.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-warm-900 mb-2">Competencies</h4>
          <div className="space-y-2">
            {review.competencyRatings.map((c) => (
              <div key={c.id} className="bg-warm-50 p-3 rounded">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-sm text-warm-600">
                    {c.managerRating ?? '-'} / 5 (expected {c.expectedLevel})
                  </span>
                </div>
                {c.comment && <p className="text-xs text-warm-500 mt-1">{c.comment}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {showPeerSection && (
        <div>
          <h4 className="text-sm font-medium text-warm-900 mb-2">Peer feedback</h4>
          {peer ? (
            <div className="space-y-3">
              <p className="text-xs text-warm-500">{peer.submittedCount} colleagues responded (anonymous)</p>
              {peer.questions.map((q) => (
                <div key={q.text} className="bg-warm-50 p-3 rounded">
                  <p className="text-sm font-medium">{q.text}</p>
                  {q.type === 'RATING' ? (
                    <p className="text-sm text-warm-600">
                      Ratings: {q.ratings.join(', ')}
                      {q.ratings.length > 0 &&
                        ` (average ${(q.ratings.reduce((s, n) => s + n, 0) / q.ratings.length).toFixed(1)})`}
                    </p>
                  ) : (
                    <ul className="list-disc ml-5 text-sm text-warm-600">
                      {q.texts.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  )}
                </div>
              ))}
              {peer.comments.length > 0 && (
                <ul className="list-disc ml-5 text-sm text-warm-600">
                  {peer.comments.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
            </div>
          ) : review.peerFeedbackHiddenReason === 'NOT_RELEASED' ? (
            <p className="text-sm text-warm-500">Results are released when the cycle closes</p>
          ) : (
            <p className="text-sm text-warm-500">Peer feedback is shown when at least 3 colleagues respond</p>
          )}
        </div>
      )}
    </div>
  );
}
