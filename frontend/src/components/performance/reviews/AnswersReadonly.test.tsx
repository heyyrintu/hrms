import React from 'react';
import { render, screen } from '@testing-library/react';
import { AnswersReadonly } from './AnswersReadonly';
import type { CycleQuestion, ReviewAnswer } from '@/lib/api-performance-reviews';

const questions: CycleQuestion[] = [
  { id: 'q1', text: 'Rate teamwork', type: 'RATING', audience: 'MANAGER', isRequired: true, sortOrder: 1 },
  { id: 'q2', text: 'Describe wins', type: 'TEXT', audience: 'MANAGER', isRequired: false, sortOrder: 2 },
  { id: 'q3', text: 'Self question', type: 'TEXT', audience: 'SELF', isRequired: false, sortOrder: 3 },
];
const answers: ReviewAnswer[] = [
  { cycleQuestionId: 'q1', audience: 'MANAGER', rating: 4, text: null },
  { cycleQuestionId: 'q2', audience: 'MANAGER', rating: null, text: 'Great quarter' },
  { cycleQuestionId: 'q3', audience: 'SELF', rating: null, text: 'mine' },
];

describe('AnswersReadonly', () => {
  it('shows answers for the audience with question text', () => {
    render(<AnswersReadonly questions={questions} answers={answers} audience="MANAGER" />);
    expect(screen.getByText('Rate teamwork')).toBeInTheDocument();
    expect(screen.getByText('4 / 5')).toBeInTheDocument();
    expect(screen.getByText('Great quarter')).toBeInTheDocument();
    expect(screen.queryByText('mine')).not.toBeInTheDocument();
  });

  it('renders nothing when there are no answers for the audience', () => {
    const { container } = render(<AnswersReadonly questions={questions} answers={[]} audience="MANAGER" />);
    expect(container).toBeEmptyDOMElement();
  });
});
