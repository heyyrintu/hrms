import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecognitionCard } from './RecognitionCard';
import type { Recognition } from '@/lib/api-recognition';

jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
      },
    },
  ),
);

const recognition: Recognition = {
  id: 'rec-1',
  message: 'Shipped the release under pressure',
  pointsPerRecipient: 10,
  createdAt: '2026-03-15T12:00:00Z',
  giver: { id: 'g-1', firstName: 'Grace', lastName: 'G' },
  badge: { id: 'b-1', name: 'Above and Beyond', icon: '🚀', points: 20, isActive: true },
  recipients: [
    { id: 'rr-1', employeeId: 'r-1', points: 10, employee: { id: 'r-1', firstName: 'Alice', lastName: 'A' } },
  ],
};

describe('RecognitionCard', () => {
  it('shows the message, badge and points', () => {
    render(<RecognitionCard recognition={recognition} />);

    expect(screen.getByText(/Shipped the release under pressure/)).toBeInTheDocument();
    expect(screen.getByText(/Above and Beyond/)).toBeInTheDocument();
    expect(screen.getByText(/10 points each/)).toBeInTheDocument();
  });

  it('does not show a delete button unless canDelete is set', () => {
    render(<RecognitionCard recognition={recognition} />);
    expect(screen.queryByLabelText('Delete recognition')).not.toBeInTheDocument();
  });

  it('calls onDelete with the recognition id', () => {
    const onDelete = jest.fn();
    render(<RecognitionCard recognition={recognition} canDelete onDelete={onDelete} />);

    fireEvent.click(screen.getByLabelText('Delete recognition'));

    expect(onDelete).toHaveBeenCalledWith('rec-1');
  });
});
