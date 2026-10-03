'use client';

import type { CycleQuestion, ReviewAnswer, ReviewAudience } from '@/lib/api-performance-reviews';
import { questionsFor } from './QuestionAnswersForm';

interface AnswersReadonlyProps {
  questions: CycleQuestion[];
  answers: ReviewAnswer[];
  audience: ReviewAudience;
}

export function AnswersReadonly({ questions, answers, audience }: AnswersReadonlyProps) {
  const rows = questionsFor(questions, audience)
    .map((q) => ({ q, a: answers.find((x) => x.cycleQuestionId === q.id && x.audience === audience) }))
    .filter((r) => r.a);
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      {rows.map(({ q, a }) => (
        <div key={q.id}>
          <p className="text-xs text-warm-500">{q.text}</p>
          {q.type === 'RATING' ? (
            <p className="text-sm font-medium text-warm-900">{a?.rating} / 5</p>
          ) : (
            <p className="text-sm text-warm-700 bg-warm-50 p-3 rounded whitespace-pre-wrap">{a?.text}</p>
          )}
        </div>
      ))}
    </div>
  );
}
