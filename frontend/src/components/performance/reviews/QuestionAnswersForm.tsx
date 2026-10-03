'use client';

import type { AnswerInput, CycleQuestion, ReviewAudience } from '@/lib/api-performance-reviews';
import { RatingButtons } from './RatingButtons';

export function questionsFor(questions: CycleQuestion[], audience: ReviewAudience): CycleQuestion[] {
  return questions.filter((q) => q.audience === audience).sort((a, b) => a.sortOrder - b.sortOrder);
}

function isAnswered(q: CycleQuestion, a: AnswerInput | undefined): boolean {
  if (!a) return false;
  return q.type === 'RATING' ? typeof a.rating === 'number' : !!a.text?.trim();
}

/** True when every required question for the audience has an answer. */
export function answersComplete(
  questions: CycleQuestion[],
  audience: ReviewAudience,
  answers: AnswerInput[],
): boolean {
  return questionsFor(questions, audience)
    .filter((q) => q.isRequired)
    .every((q) => isAnswered(q, answers.find((a) => a.cycleQuestionId === q.id)));
}

interface QuestionAnswersFormProps {
  questions: CycleQuestion[];
  audience: ReviewAudience;
  value: AnswerInput[];
  /** Called with the full next answer list and whether all required questions are answered. */
  onChange: (answers: AnswerInput[], isComplete: boolean) => void;
  disabled?: boolean;
}

export function QuestionAnswersForm({ questions, audience, value, onChange, disabled }: QuestionAnswersFormProps) {
  const list = questionsFor(questions, audience);
  if (list.length === 0) return null;

  const update = (q: CycleQuestion, patch: { rating?: number; text?: string }) => {
    const rest = value.filter((a) => a.cycleQuestionId !== q.id);
    const next: AnswerInput = { cycleQuestionId: q.id, ...patch };
    const keep = q.type === 'RATING' ? typeof next.rating === 'number' : !!next.text?.trim();
    const answers = keep ? [...rest, next] : rest;
    onChange(answers, answersComplete(questions, audience, answers));
  };

  return (
    <div className="space-y-4">
      {list.map((q) => {
        const current = value.find((a) => a.cycleQuestionId === q.id);
        const inputId = `question-${q.id}`;
        return (
          <div key={q.id}>
            <label htmlFor={q.type === 'TEXT' ? inputId : undefined} className="block text-sm font-medium text-warm-700 mb-1">
              {q.text}
              {q.isRequired && <span className="text-red-500 ml-1">*</span>}
            </label>
            {q.type === 'RATING' ? (
              <RatingButtons
                label={q.text}
                value={current?.rating}
                onChange={(n) => update(q, { rating: n })}
                disabled={disabled}
              />
            ) : (
              <textarea
                id={inputId}
                rows={3}
                disabled={disabled}
                value={current?.text ?? ''}
                onChange={(e) => update(q, { text: e.target.value })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
