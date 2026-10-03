import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionAnswersForm } from './QuestionAnswersForm';
import type { CycleQuestion } from '@/lib/api-performance-reviews';

const questions: CycleQuestion[] = [
  { id: 'q1', text: 'Rate teamwork', type: 'RATING', audience: 'SELF', isRequired: true, sortOrder: 1 },
  { id: 'q2', text: 'Describe wins', type: 'TEXT', audience: 'SELF', isRequired: false, sortOrder: 2 },
  { id: 'q3', text: 'Manager only', type: 'TEXT', audience: 'MANAGER', isRequired: true, sortOrder: 3 },
];

describe('QuestionAnswersForm', () => {
  it('renders only questions for the audience and marks required ones', () => {
    render(<QuestionAnswersForm questions={questions} audience="SELF" value={[]} onChange={jest.fn()} />);
    expect(screen.getByText('Rate teamwork')).toBeInTheDocument();
    expect(screen.getByText('Describe wins')).toBeInTheDocument();
    expect(screen.queryByText('Manager only')).not.toBeInTheDocument();
    expect(screen.getAllByText('*')).toHaveLength(1);
  });

  it('reports a rating answer and complete once required is answered', () => {
    const onChange = jest.fn();
    render(<QuestionAnswersForm questions={questions} audience="SELF" value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rate teamwork: 4' }));
    expect(onChange).toHaveBeenCalledWith([{ cycleQuestionId: 'q1', rating: 4 }], true);
  });

  it('reports a text answer and incomplete when required rating missing', () => {
    const onChange = jest.fn();
    render(<QuestionAnswersForm questions={questions} audience="SELF" value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Describe wins'), { target: { value: 'Shipped' } });
    expect(onChange).toHaveBeenCalledWith([{ cycleQuestionId: 'q2', text: 'Shipped' }], false);
  });

  it('drops a text answer that is cleared', () => {
    const onChange = jest.fn();
    render(
      <QuestionAnswersForm
        questions={questions}
        audience="SELF"
        value={[{ cycleQuestionId: 'q1', rating: 3 }, { cycleQuestionId: 'q2', text: 'x' }]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Describe wins'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith([{ cycleQuestionId: 'q1', rating: 3 }], true);
  });
});
