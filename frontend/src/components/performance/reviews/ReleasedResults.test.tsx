import React from 'react';
import { render, screen } from '@testing-library/react';
import { ReleasedResults } from './ReleasedResults';
import type { CycleQuestion, ReviewView } from '@/lib/api-performance-reviews';

const base: ReviewView = {
  id: 'r1', cycleId: 'c1', employeeId: 'e1', reviewerId: 'e2', status: 'COMPLETED', relation: 'SELF',
  released: true,
  cycle: { id: 'c1', name: 'H1', startDate: '', endDate: '', status: 'COMPLETED', peerFeedbackEnabled: true, maxPeers: 5 },
  selfRating: 4, selfComments: null, selfSubmittedAt: null,
};
const questions: CycleQuestion[] = [
  { id: 'q1', text: 'Rate impact', type: 'RATING', audience: 'MANAGER', isRequired: true, sortOrder: 1 },
];

describe('ReleasedResults', () => {
  it('shows final rating, manager comments, answers and competencies', () => {
    render(
      <ReleasedResults
        questions={questions}
        review={{
          ...base,
          finalRating: 4,
          managerComments: 'Strong year',
          answers: [{ cycleQuestionId: 'q1', audience: 'MANAGER', rating: 5, text: null }],
          competencyRatings: [{ id: 'k1', name: 'Ownership', expectedLevel: 3, managerRating: 4, comment: 'solid' }],
          peerFeedbackHiddenReason: 'TOO_FEW_RESPONSES',
        }}
      />,
    );
    expect(screen.getByText('Final rating')).toBeInTheDocument();
    expect(screen.getByTestId('final-rating')).toHaveTextContent('4 / 5');
    expect(screen.getByText('Strong year')).toBeInTheDocument();
    expect(screen.getByText('Rate impact')).toBeInTheDocument();
    expect(screen.getByText('Ownership')).toBeInTheDocument();
    expect(screen.getByText('Peer feedback is shown when at least 3 colleagues respond')).toBeInTheDocument();
  });

  it('shows anonymous peer feedback when present', () => {
    render(
      <ReleasedResults
        questions={[]}
        review={{
          ...base,
          finalRating: 3,
          peerFeedback: {
            submittedCount: 3,
            questions: [{ text: 'Collaboration', type: 'RATING', ratings: [4, 5, 3], texts: [] }],
            comments: ['Great to work with'],
          },
        }}
      />,
    );
    expect(screen.getByText('Collaboration')).toBeInTheDocument();
    expect(screen.getByText('Great to work with')).toBeInTheDocument();
    expect(screen.getByText(/3 colleagues responded/)).toBeInTheDocument();
  });

  it('never shows a rating before release', () => {
    render(
      <ReleasedResults
        questions={[]}
        review={{ ...base, released: false, finalRating: 5, peerFeedbackHiddenReason: 'NOT_RELEASED' }}
      />,
    );
    expect(screen.queryByTestId('final-rating')).not.toBeInTheDocument();
    expect(screen.getByText('Results are released when the cycle closes')).toBeInTheDocument();
  });
});
