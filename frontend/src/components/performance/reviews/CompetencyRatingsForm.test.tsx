import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompetencyRatingsForm, competenciesComplete } from './CompetencyRatingsForm';
import type { CompetencyRating } from '@/lib/api-performance-reviews';

const competencies: CompetencyRating[] = [
  { id: 'c1', name: 'Communication', expectedLevel: 3, managerRating: null, comment: null },
  { id: 'c2', name: 'Ownership', expectedLevel: 4, managerRating: null, comment: null },
];

describe('CompetencyRatingsForm', () => {
  it('shows name and expected level for each competency', () => {
    render(<CompetencyRatingsForm competencies={competencies} value={[]} onChange={jest.fn()} />);
    expect(screen.getByText('Communication')).toBeInTheDocument();
    expect(screen.getByText('Expected level 3')).toBeInTheDocument();
    expect(screen.getByText('Ownership')).toBeInTheDocument();
  });

  it('reports a rating', () => {
    const onChange = jest.fn();
    render(<CompetencyRatingsForm competencies={competencies} value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Communication: 5' }));
    expect(onChange).toHaveBeenCalledWith([{ id: 'c1', rating: 5 }]);
  });

  it('keeps the rating when the comment changes', () => {
    const onChange = jest.fn();
    render(<CompetencyRatingsForm competencies={competencies} value={[{ id: 'c1', rating: 2 }]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Communication comment'), { target: { value: 'ok' } });
    expect(onChange).toHaveBeenCalledWith([{ id: 'c1', rating: 2, comment: 'ok' }]);
  });

  it('competenciesComplete requires every competency rated', () => {
    expect(competenciesComplete(competencies, [{ id: 'c1', rating: 3 }])).toBe(false);
    expect(competenciesComplete(competencies, [{ id: 'c1', rating: 3 }, { id: 'c2', rating: 1 }])).toBe(true);
    expect(competenciesComplete([], [])).toBe(true);
  });
});
