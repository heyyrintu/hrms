import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeedItemCard } from './FeedItemCard';
import type { FeedItem } from '@/lib/api-feed';

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

const baseItem: FeedItem = {
  id: 'item-1',
  type: 'BIRTHDAY',
  sourceType: 'Employee',
  sourceId: 'emp-1',
  title: 'Happy birthday, Ann!',
  body: null,
  payload: {},
  occurredAt: '2026-03-15T12:00:00Z',
  actor: null,
  subject: { id: 'emp-1', firstName: 'Ann', lastName: 'Employee' },
  reactionCounts: { LIKE: 1, CELEBRATE: 2 },
  myReactions: [],
};

describe('FeedItemCard', () => {
  it('shows the birthday icon and reaction counts', () => {
    render(<FeedItemCard item={baseItem} onReact={jest.fn()} />);

    expect(screen.getByText('Happy birthday, Ann!')).toBeInTheDocument();
    expect(screen.getByText('👍 1')).toBeInTheDocument();
    expect(screen.getByText('🎉 2')).toBeInTheDocument();
  });

  it('calls onReact with the clicked kind', () => {
    const onReact = jest.fn();
    render(<FeedItemCard item={baseItem} onReact={onReact} />);

    fireEvent.click(screen.getByText('🎉 2'));

    expect(onReact).toHaveBeenCalledWith('CELEBRATE');
  });

  it('does not render a Hide button when canHide is false', () => {
    render(<FeedItemCard item={baseItem} onReact={jest.fn()} />);

    expect(screen.queryByText('Hide')).not.toBeInTheDocument();
  });

  it('renders a Hide button and calls onHide when canHide is true', () => {
    const onHide = jest.fn();
    render(<FeedItemCard item={baseItem} canHide onReact={jest.fn()} onHide={onHide} />);

    fireEvent.click(screen.getByText('Hide'));

    expect(onHide).toHaveBeenCalled();
  });

  it('falls back to the badge icon for a recognition item', () => {
    const recognitionItem: FeedItem = {
      ...baseItem,
      type: 'RECOGNITION',
      title: 'Bob was recognised',
      payload: { badge: { name: 'Team Player', icon: '🤝' } },
    };
    render(<FeedItemCard item={recognitionItem} onReact={jest.fn()} />);

    expect(screen.getByText('🤝')).toBeInTheDocument();
  });
  describe('GOAL_COMPLETED', () => {
    const goalItem = (over: Partial<FeedItem> = {}): FeedItem => ({
      ...baseItem,
      type: 'GOAL_COMPLETED',
      sourceType: 'Goal',
      sourceId: 'g1',
      title: 'Ship v2',
      payload: { ownerType: 'EMPLOYEE', departmentName: null },
      ...over,
    });

    it('names the subject for an employee goal and shows the Target icon', () => {
      render(<FeedItemCard item={goalItem()} onReact={jest.fn()} />);

      expect(screen.getByText('Ann Employee completed a goal: Ship v2')).toBeInTheDocument();
      expect(screen.getByTestId('icon-Target')).toBeInTheDocument();
    });

    it('labels a company goal', () => {
      render(
        <FeedItemCard
          item={goalItem({ subject: null, payload: { ownerType: 'COMPANY', departmentName: null } })}
          onReact={jest.fn()}
        />,
      );

      expect(screen.getByText('Company goal completed: Ship v2')).toBeInTheDocument();
    });

    it('labels a department goal and shows the department name', () => {
      render(
        <FeedItemCard
          item={goalItem({ subject: null, payload: { ownerType: 'DEPARTMENT', departmentName: 'Engineering' } })}
          onReact={jest.fn()}
        />,
      );

      expect(screen.getByText('Department goal completed: Ship v2')).toBeInTheDocument();
      expect(screen.getByText('Engineering')).toBeInTheDocument();
    });
  });
});
