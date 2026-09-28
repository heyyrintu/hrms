import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeaderboardTable } from './LeaderboardTable';
import type { LeaderboardRow } from '@/lib/api-recognition';

const rows: LeaderboardRow[] = [
  {
    rank: 1,
    employeeId: 'e-1',
    firstName: 'Alice',
    lastName: 'A',
    employeeCode: 'E1',
    department: 'Engineering',
    points: 50,
    count: 3,
  },
];

describe('LeaderboardTable', () => {
  it('renders the ranked rows', () => {
    render(
      <LeaderboardTable
        rows={rows}
        period="month"
        onPeriodChange={jest.fn()}
        pointsEnabled
      />,
    );

    expect(screen.getByText((_, el) => !!el?.textContent?.startsWith('Alice A'))).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('shows the count column header when points are disabled', () => {
    render(
      <LeaderboardTable rows={rows} period="month" onPeriodChange={jest.fn()} pointsEnabled={false} />,
    );

    expect(screen.getByText('Recognitions')).toBeInTheDocument();
  });

  it('calls onPeriodChange when a different period is picked', () => {
    const onPeriodChange = jest.fn();
    render(
      <LeaderboardTable rows={rows} period="month" onPeriodChange={onPeriodChange} pointsEnabled />,
    );

    fireEvent.click(screen.getByText('This quarter'));

    expect(onPeriodChange).toHaveBeenCalledWith('quarter');
  });

  it('shows an empty state with no rows', () => {
    render(<LeaderboardTable rows={[]} period="month" onPeriodChange={jest.fn()} pointsEnabled />);

    expect(screen.getByText(/No recognitions yet/)).toBeInTheDocument();
  });
});
