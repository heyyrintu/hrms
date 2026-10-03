'use client';

import type { CompetencyRating } from '@/lib/api-performance-reviews';
import { RatingButtons } from './RatingButtons';

export interface CompetencyRatingValue { id: string; rating?: number; comment?: string }

/** True when every competency has a rating (an empty list is complete). */
export function competenciesComplete(competencies: CompetencyRating[], value: CompetencyRatingValue[]): boolean {
  return competencies.every((c) => typeof value.find((v) => v.id === c.id)?.rating === 'number');
}

interface CompetencyRatingsFormProps {
  competencies: CompetencyRating[];
  value: CompetencyRatingValue[];
  onChange: (value: CompetencyRatingValue[]) => void;
  disabled?: boolean;
}

export function CompetencyRatingsForm({ competencies, value, onChange, disabled }: CompetencyRatingsFormProps) {
  if (competencies.length === 0) return null;

  const patch = (id: string, change: Partial<CompetencyRatingValue>) => {
    const existing = value.find((v) => v.id === id);
    const next = { ...(existing ?? { id }), ...change };
    onChange(existing ? value.map((v) => (v.id === id ? next : v)) : [...value, next]);
  };

  return (
    <div className="space-y-4">
      {competencies.map((c) => {
        const current = value.find((v) => v.id === c.id);
        return (
          <div key={c.id} className="border border-warm-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-warm-900">{c.name}</p>
              <p className="text-xs text-warm-500">Expected level {c.expectedLevel}</p>
            </div>
            <RatingButtons
              label={c.name}
              value={current?.rating}
              onChange={(n) => patch(c.id, { rating: n })}
              disabled={disabled}
            />
            <input
              type="text"
              aria-label={`${c.name} comment`}
              placeholder="Comment (optional)"
              disabled={disabled}
              value={current?.comment ?? ''}
              onChange={(e) => patch(c.id, { comment: e.target.value })}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            />
          </div>
        );
      })}
    </div>
  );
}
